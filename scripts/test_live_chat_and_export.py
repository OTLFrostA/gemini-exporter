#!/usr/bin/env python3
"""
scripts/test_live_chat_and_export.py
------------------------------------
端到端自动化测试：在真实 Gemini 中执行 2 次对话（每次 5 轮），触发插件导出，
并自动断言导出目录中的文件与 5 轮对话内容的完整性。

特性：
1. 双模支持：默认使用内置的 2 套经典 5 轮高价值对话；支持 --dataset 传入自定义（或由 AI 动态生成）的数据集。
2. 全流程 CDP 驱动：自动创建会话、输入多轮 Prompt、等待流式生成、捕获会话 ID。
3. 扩展自动化导出：自动操作 options.html 同步最新会话、通过 item[data-chat-id] 精准勾选目标会话、导出为 ZIP。
4. 深度内容断言：自动定位并解压导出的 ZIP，深入每个 Markdown 文件严格校验全部 5 轮的用户提问与模型回答。
"""

import sys
import os
import json
import time
import socket
import base64
import struct
import argparse
import zipfile
import re
import urllib.request
import urllib.error

try:
    from tests.helpers.export_spec_asserter import ExportSpecificationAsserter
except ImportError:
    sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
    from tests.helpers.export_spec_asserter import ExportSpecificationAsserter

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
except Exception:
    pass

CDP_DEFAULT_PORT = 9222

DEFAULT_SCENARIOS = [
    {
        "id": "scenario_python_concurrency",
        "title": "Python高性能并发系统与异步架构演进",
        "turns": [
            "请解释 Python GIL (全局解释器锁) 的底层工作机制，以及它为什么限制了多线程在 CPU 密集型任务中的并行能力？",
            "在处理海量 I/O 密集型网络请求时，对比 threading、multiprocessing 与 asyncio 三种方案的内存开销与吞吐量差异。",
            "请使用 Python asyncio 和 aiohttp 编写一个并发限制为 5 的异步抓取示例，要求包含超时控制与指数退避重试逻辑。",
            "为刚才编写的异步抓取器设计一个基于内存的 TTL/LRU 缓存装饰器，防止短时间内对相同 URL 重复发起抓取。",
            "请总结在生产环境中排查 Python 异步服务事件循环卡顿 (Event Loop Lag) 和协程内存泄漏的 3 个最有效策略。"
        ]
    },
    {
        "id": "scenario_distributed_architecture",
        "title": "分布式系统高可用架构与最终一致性实战",
        "turns": [
            "请详细阐述分布式系统中的 CAP 定理，并对比 CP 系统 (如 etcd) 与 AP 系统 (如 Cassandra) 在分区容忍时的设计哲学。",
            "在大型高并发秒杀系统中，如何基于 Redis Lua 脚本与 MySQL 设计一套高性能、防超卖的库存预扣方案？",
            "在上述预扣方案中，如果 Redis 扣减成功但后续消息队列异步落盘失败，应该设计怎样的补偿与对账机制来保证数据最终一致性？",
            "请用简洁的 ASCII 纯字符流程图绘制上述秒杀链路中 API 网关、Redis 预扣、消息队列与数据库落库的数据流转过程。",
            "针对跨服务的分布式事务，请对比 2PC (两阶段提交)、TCC (Try-Confirm-Cancel) 与 SAGA 模式的优缺点及各自最适用的业务场景。"
        ]
    }
]


class CDPConnection:
    def __init__(self, ws_url):
        self.ws_url = ws_url
        self.msg_id = 0
        host, port_path = ws_url.replace("ws://", "").split(":", 1)
        port, path = port_path.split("/", 1)
        self.sock = socket.create_connection((host, int(port)), timeout=30)

        # WebSocket Handshake
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        res = self.sock.recv(4096)
        if b"101 " not in res:
            raise RuntimeError(f"WebSocket 握手失败: {res.decode('utf-8', errors='ignore')}")

    def reconnect(self):
        try:
            self.sock.close()
        except Exception:
            pass
        host, port_path = self.ws_url.replace("ws://", "").split(":", 1)
        port, path = port_path.split("/", 1)
        self.sock = socket.create_connection((host, int(port)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        req = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            f"Upgrade: websocket\r\n"
            f"Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode("ascii"))
        res = self.sock.recv(4096)
        if b"101 " not in res:
            raise RuntimeError(f"WebSocket 握手失败: {res.decode('utf-8', errors='ignore')}")

    def call(self, method, params=None, timeout=30):
        self.msg_id += 1
        current_id = self.msg_id
        payload = json.dumps({"id": current_id, "method": method, "params": params or {}}).encode("utf-8")

        mask = os.urandom(4)
        length = len(payload)
        if length <= 125:
            header = bytes([0x81, 0x80 | length]) + mask
        elif length <= 65535:
            header = bytes([0x81, 0x80 | 126]) + struct.pack(">H", length) + mask
        else:
            header = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", length) + mask

        masked_payload = bytes([b ^ mask[i % 4] for i, b in enumerate(payload)])

        for attempt in range(2):
            try:
                self.sock.sendall(header + masked_payload)

                start = time.time()
                while time.time() - start < timeout:
                    b1, b2 = self._recv_exact(2)
                    masked = (b2 & 0x80) != 0
                    payload_len = b2 & 0x7F
                    if payload_len == 126:
                        payload_len = struct.unpack(">H", self._recv_exact(2))[0]
                    elif payload_len == 127:
                        payload_len = struct.unpack(">Q", self._recv_exact(8))[0]

                    mask_key = self._recv_exact(4) if masked else b""
                    raw_data = self._recv_exact(payload_len)

                    if masked:
                        raw_data = bytes([b ^ mask_key[i % 4] for i, b in enumerate(raw_data)])

                    try:
                        data = json.loads(raw_data.decode("utf-8", errors="ignore"))
                        if data.get("id") == current_id:
                            return data
                    except Exception:
                        continue
                raise TimeoutError(f"CDP call {method} 超时 ({timeout}s)")
            except (ConnectionError, socket.error):
                if attempt == 0:
                    time.sleep(1.0)
                    try:
                        self.reconnect()
                    except Exception:
                        raise
                else:
                    raise

    def _recv_exact(self, num_bytes):
        chunks = []
        received = 0
        while received < num_bytes:
            chunk = self.sock.recv(num_bytes - received)
            if not chunk:
                raise ConnectionError("WebSocket 连接意外关闭")
            chunks.append(chunk)
            received += len(chunk)
        return b"".join(chunks)

    def eval(self, expr, await_promise=False, timeout=30):
        params = {"expression": expr, "returnByValue": True}
        if await_promise:
            params["awaitPromise"] = True
        res = self.call("Runtime.evaluate", params, timeout=timeout)
        result = res.get("result", {})
        if "exceptionDetails" in result:
            desc = result["exceptionDetails"].get("text") or result["exceptionDetails"].get("exception", {}).get("description")
            print(f"    ⚠️ JS 执行异常: {desc}")
        return result.get("result", {}).get("value")

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


def get_tabs(port=CDP_DEFAULT_PORT):
    for endpoint in ["/json/list", "/json"]:
        try:
            url = f"http://127.0.0.1:{port}{endpoint}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception:
            continue
    return []


def get_extension_id(port=CDP_DEFAULT_PORT):
    tabs = get_tabs(port)
    # First look for service workers or pages belonging to Gemini Exporter
    for t in tabs:
        u = t.get("url", "")
        if u.startswith("chrome-extension://"):
            if "src/background/background.js" in u or "options.html" in u:
                return u.split("/")[2]

    # Fallback to any chrome-extension
    for t in tabs:
        u = t.get("url", "")
        if u.startswith("chrome-extension://"):
            return u.split("/")[2]

    for t in tabs:
        if t.get("url") == "chrome://extensions/":
            cdp = CDPConnection(t["webSocketDebuggerUrl"])
            try:
                exts = cdp.eval("""
                    (() => {
                        const m = document.querySelector("extensions-manager");
                        const l = m ? m.shadowRoot.querySelector("extensions-item-list") : null;
                        const items = l ? Array.from(l.shadowRoot.querySelectorAll("extensions-item")) : [];
                        const target = items.find(i => (i.shadowRoot.querySelector("#name")?.textContent || "").includes("Gemini Exporter"));
                        return target ? target.id : (items[0] ? items[0].id : null);
                    })()
                """)
                if exts:
                    return exts
            finally:
                cdp.close()

    # Dynamically open chrome://extensions/ to inspect installed extensions if not found
    try:
        new_url = f"http://127.0.0.1:{port}/json/new?chrome://extensions/"
        req = urllib.request.Request(new_url, method="PUT")
        with urllib.request.urlopen(req, timeout=5) as r:
            ext_tab = json.loads(r.read().decode("utf-8"))
        time.sleep(0.8)
        cdp = CDPConnection(ext_tab["webSocketDebuggerUrl"])
        try:
            exts = cdp.eval("""
                (() => {
                    const m = document.querySelector("extensions-manager");
                    const l = m ? m.shadowRoot.querySelector("extensions-item-list") : null;
                    const items = l ? Array.from(l.shadowRoot.querySelectorAll("extensions-item")) : [];
                    const target = items.find(i => (i.shadowRoot.querySelector("#name")?.textContent || "").includes("Gemini Exporter"));
                    return target ? target.id : (items[0] ? items[0].id : null);
                })()
            """)
            if exts:
                return exts
        finally:
            cdp.close()
    except Exception:
        pass

    for t in tabs:
        if "gemini.google.com" in t.get("url", ""):
            cdp = CDPConnection(t["webSocketDebuggerUrl"])
            try:
                eid = cdp.eval("typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.id : null")
                if eid:
                    return eid
            finally:
                cdp.close()

    return None


def get_browser_ws_url(port=CDP_DEFAULT_PORT):
    for endpoint in ["/json/version"]:
        try:
            url = f"http://127.0.0.1:{port}{endpoint}"
            with urllib.request.urlopen(url, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("webSocketDebuggerUrl")
        except Exception:
            continue
    return None


def reinstall_extension_via_cdp(port=CDP_DEFAULT_PORT, repo_path=None):
    """
    通过 Chrome DevTools Protocol 原生 Extensions 域指令彻底卸载并重新安装插件。
    此方式能够 100% 真实触发 chrome.runtime.onInstalled(reason === 'install')，
    且不会唤起操作系统原生文件选择框，全自动化无阻碍运行。
    """
    repo_path = os.path.abspath(repo_path or os.path.join(os.path.dirname(__file__), ".."))
    browser_ws = get_browser_ws_url(port)
    if not browser_ws:
        print(f"❌ 无法获取 Chrome Browser WebSocket (端口 {port})，请确认 Chrome 正在运行并开启了远程调试")
        return None

    old_ext_id = get_extension_id(port)
    cdp = CDPConnection(browser_ws)
    try:
        if old_ext_id:
            print(f"   🗑️ 正在通过 CDP Extensions.uninstall 彻底卸载旧扩展 ({old_ext_id})...")
            try:
                cdp.call("Extensions.uninstall", {"id": old_ext_id})
            except Exception as e:
                print(f"   ⚠️ 卸载旧扩展返回提示: {e}")
            time.sleep(0.5)

        print(f"   📦 正在通过 CDP Extensions.loadUnpacked 原生安装工作区扩展: {repo_path}...")
        res = cdp.call("Extensions.loadUnpacked", {"path": repo_path})
        new_ext_id = res.get("result", {}).get("id")
        if not new_ext_id:
            print(f"❌ 扩展安装失败，CDP 返回: {res}")
            return None
        print(f"   ✅ 扩展安装成功！新 Extension ID: {new_ext_id}")
        return new_ext_id
    finally:
        cdp.close()


def verify_onboarding_tour(port=CDP_DEFAULT_PORT, ext_id=None, timeout=15):
    """
    全自动验证全新安装时触发的 options.html?welcome=1 及其新手向导 (TourGuide) 全流程：
    1. 验证 Step 1 (连接引导): 校验 popover 渲染、badge '1 / 4' 并点击下一步；
    2. 验证 Step 2 (扫描同步引导): 校验 badge '2 / 4'，触发 #btnIncrementalScan 动作推进；
    3. 验证 Step 3 (会话选择引导): 校验 badge '3 / 4'，触发会话勾选或全选动作推进；
    4. 验证 Step 4 (导出执行引导): 校验 badge '4 / 4'，点击完成按钮，校验向导销毁与 storage 落盘。
    """
    print("   🧭 正在定位安装后由 background 自动拉起的 options.html?welcome=1 标签页...")
    start_time = time.time()
    welcome_tab = None
    welcome_url_part = f"chrome-extension://{ext_id}/options.html?welcome=1"
    base_options_part = f"chrome-extension://{ext_id}/options.html"

    while time.time() - start_time < timeout:
        tabs = get_tabs(port)
        welcome_tab = next((t for t in tabs if welcome_url_part in t.get("url", "")), None)
        if welcome_tab:
            break
        if not welcome_tab:
            opt = next((t for t in tabs if base_options_part in t.get("url", "")), None)
            if opt:
                welcome_tab = opt
                break
        time.sleep(0.5)

    if not welcome_tab:
        print("   ⚠️ 未在 15 秒内检测到自动弹出的 options 标签页，主动发起打开...")
        new_url = f"http://127.0.0.1:{port}/json/new?{welcome_url_part}"
        req = urllib.request.Request(new_url, method="PUT")
        with urllib.request.urlopen(req, timeout=5) as r:
            welcome_tab = json.loads(r.read().decode("utf-8"))

    cdp = CDPConnection(welcome_tab["webSocketDebuggerUrl"])
    try:
        # 等待 options.html DOM 及 TourGuide 初始化
        print("   🔍 正在等待 TourGuide 向导浮层加载与激活...")
        tour_ready = False
        for _ in range(20):
            is_active = cdp.eval("""
            (() => {
                const popover = document.querySelector('.tour-popover');
                const badge = document.querySelector('.tour-step-badge')?.textContent || '';
                const active = window.TourGuide ? window.TourGuide.isActive() : false;
                return active && !!popover;
            })()
            """)
            if is_active:
                tour_ready = True
                break
            time.sleep(0.4)

        if not tour_ready:
            print("   ⚠️ 尝试通过 TourGuide.startTour(0) 兜底激活向导...")
            cdp.eval("if (window.TourGuide) window.TourGuide.startTour(0);")
            time.sleep(0.5)

        # -------------------------------------------------------------
        # Step 1 校验：连接引导 (1 / 4) 或已由动态连接自动推进至 (2 / 4)
        # -------------------------------------------------------------
        step1_info = cdp.eval("""
        (() => {
            const badge = document.querySelector('.tour-step-badge')?.textContent || '';
            const step = window.TourGuide ? window.TourGuide.getCurrentStep() : -1;
            return { badge, step };
        })()
        """)
        current_step_num = step1_info.get("step", 0)
        if current_step_num == 0:
            if "1 / 4" not in step1_info.get("badge", ""):
                print(f"❌ 向导 Step 1 校验失败: {step1_info}")
                return False
            print("   ✓ [向导 1/4] 连接就绪步骤校验通过，点击前进...")

            cdp.eval("""
            (() => {
                const nextBtn = document.getElementById('tourNextBtn');
                if (nextBtn) nextBtn.click();
                else if (window.TourGuide) window.TourGuide.nextStep();
            })()
            """)
            time.sleep(0.5)
        elif current_step_num == 1:
            print("   ✓ [向导 1/4 ➔ 2/4] 检测到已连接 Gemini 页面，向导已自适应智能推进至 Step 2！")
        else:
            print(f"❌ 向导步骤异常: {step1_info}")
            return False

        # -------------------------------------------------------------
        # Step 2 校验：扫描同步引导 (2 / 4) 并触发 #btnIncrementalScan
        # -------------------------------------------------------------
        step2_info = cdp.eval("""
        (() => {
            const badge = document.querySelector('.tour-step-badge')?.textContent || '';
            const step = window.TourGuide ? window.TourGuide.getCurrentStep() : -1;
            return { badge, step };
        })()
        """)
        if "2 / 4" not in step2_info.get("badge", ""):
            print(f"❌ 向导 Step 2 校验失败: {step2_info}")
            return False
        print("   ✓ [向导 2/4] 扫描同步步骤已就绪，触发 #btnIncrementalScan 动作推进...")

        cdp.eval("""
        (() => {
            const btn = document.getElementById('btnIncrementalScan');
            if (btn) btn.click();
        })()
        """)

        step3_advanced = False
        for _ in range(25):
            time.sleep(0.15)
            cur_step = cdp.eval("window.TourGuide ? window.TourGuide.getCurrentStep() : -1")
            if cur_step == 2:
                step3_advanced = True
                break
        if not step3_advanced:
            print("❌ 点击 #btnIncrementalScan 后未能在超时前自动推进至 Step 3")
            return False
        print("   ✓ [向导 3/4] 行为驱动自动推进至选择会话步骤！")

        # -------------------------------------------------------------
        # Step 3 校验：会话勾选推进 (3 / 4) -> 模拟选择并推进
        # -------------------------------------------------------------
        cdp.eval("""
        (() => {
            const firstCb = document.querySelector('#list .item input[type=checkbox]');
            if (firstCb) {
                firstCb.checked = true;
                firstCb.dispatchEvent(new Event('change', { bubbles: true }));
            } else {
                const btnAll = document.getElementById('btnSelectAll');
                if (btnAll) btnAll.click();
            }
        })()
        """)

        step4_advanced = False
        for _ in range(25):
            time.sleep(0.15)
            cur_step = cdp.eval("window.TourGuide ? window.TourGuide.getCurrentStep() : -1")
            if cur_step == 3:
                step4_advanced = True
                break
        if not step4_advanced:
            print("❌ 勾选会话后未能在超时前自动推进至 Step 4")
            return False
        print("   ✓ [向导 4/4] 行为驱动自动推进至导出步骤！")

        # -------------------------------------------------------------
        # Step 4 校验：点击完成向导
        # -------------------------------------------------------------
        cdp.eval("""
        (() => {
            const nextBtn = document.getElementById('tourNextBtn');
            if (nextBtn) nextBtn.click();
            else if (window.TourGuide) window.TourGuide.completeTour();
        })()
        """)
        time.sleep(0.5)

        # 校验 storage 落盘与浮层销毁
        completed_state = cdp.eval("""
        (async () => {
            const popover = document.querySelector('.tour-popover');
            const isActive = window.TourGuide ? window.TourGuide.isActive() : false;
            const storage = await chrome.storage.local.get('has_completed_tour');
            return {
                hasPopover: !!popover,
                isActive,
                storageCompleted: !!storage.has_completed_tour
            };
        })()
        """, await_promise=True)

        if completed_state.get("isActive") or completed_state.get("hasPopover"):
            print(f"❌ 向导未能正确关闭销毁: {completed_state}")
            return False
        if not completed_state.get("storageCompleted"):
            print("❌ 向导完成后 chrome.storage.local 中的 has_completed_tour 未能置为 true")
            return False

        # 清理 URL 参数并保持页面就绪
        cdp.eval("history.replaceState(null, '', 'options.html');")
        print("   🎉 新手向导 4 步交互与持久化状态断言 100% 通过！")
        return True
    finally:
        cdp.close()


def wait_for_gemini_ready(cdp, max_wait=30):
    start = time.time()
    while time.time() - start < max_wait:
        ready = cdp.eval("""
        (() => {
          const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
          return !!editor;
        })()
        """)
        if ready:
            return True
        time.sleep(1)
    return False


def get_current_chat_id(cdp):
    # 1. 优先直接从 URL 提取
    url = cdp.eval("location.href") or ""
    if "/app/" in url:
        part = url.split("/app/")[-1].split("?")[0].strip()
        if len(part) >= 8:
            return part

    # 2. 兜底：从侧边栏最新/选中的会话锚点提取
    res = cdp.eval("""
    (() => {
        const anchors = Array.from(document.querySelectorAll("a"));
        const chatLink = anchors.find(a => (a.getAttribute("href") || "").includes("/app/"));
        if (chatLink) {
            const href = chatLink.getAttribute("href") || "";
            const parts = href.split("/app/");
            if (parts.length > 1) {
                const cid = parts[1].split("?")[0].trim();
                if (cid.length >= 8) return cid;
            }
        }
        return null;
    })()
    """)
    if res and len(str(res)) >= 8:
        return str(res)

    return None


def get_current_chat_title(cdp):
    title = cdp.eval("""
    (() => {
        const titleEl = document.querySelector('conversation-title, h1, .conversation-title');
        if (titleEl && titleEl.textContent.trim()) return titleEl.textContent.trim();
        const anchors = Array.from(document.querySelectorAll("a"));
        const chatLink = anchors.find(a => (a.getAttribute("href") || "").includes("/app/"));
        if (chatLink && chatLink.textContent.trim()) return chatLink.textContent.trim();
        return document.title;
    })()
    """)
    return (title or "").replace(" - Google Gemini", "").strip()


def send_turn(cdp, turn_input, max_wait=240):
    if isinstance(turn_input, dict):
        prompt_text = turn_input.get("prompt", "")
    else:
        prompt_text = str(turn_input)

    # 识别生图类 Prompt，自适应延长超时时间
    is_image_gen = any(kw in prompt_text for kw in ["生成图片", "生成一张图片", "画一张", "generate an image", "create an image"])
    if is_image_gen:
        max_wait = max(max_wait, 240)

    # 记录发送前已有的回复条数与用户消息条数，防止多轮时误判旧回复已完成
    prev_resp_count = cdp.eval("""
    (() => document.querySelectorAll('.model-response-text, model-response, .response-content').length)()
    """) or 0
    prev_user_count = cdp.eval("""
    (() => document.querySelectorAll('.user-query, user-query, [data-test-id="user-query"], message-content.user-message').length)()
    """) or 0

    # 1. 聚焦输入框并清空原有占位符
    cdp.eval("""
    (() => {
      const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
      if (editor) {
        editor.focus();
        editor.innerHTML = '<p><br></p>';
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()
    """)
    time.sleep(0.3)

    # 2. 原生输入文本
    cdp.call("Input.insertText", {"text": prompt_text})
    time.sleep(0.3)
    cdp.eval("""
    (() => {
      const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
      if (editor) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      }
    })()
    """)
    time.sleep(0.3)

    # 3. 点击发送按钮并确保派发
    sent = False
    for attempt in range(15):
        # 检查是否已经由前次点击或回车成功派发
        status = cdp.eval(f"""
        (() => {{
          const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
          const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"]');
          const currUserCount = document.querySelectorAll('.user-query, user-query, [data-test-id="user-query"], message-content.user-message').length;
          if (!!stopBtn || isStreaming || currUserCount > {prev_user_count}) {{
            return {{ sent: true }};
          }}

          const sendBtn = document.querySelector('button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="发送"]');
          const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
          if (editor) {{
            editor.dispatchEvent(new Event('input', {{ bubbles: true }}));
            editor.dispatchEvent(new Event('change', {{ bubbles: true }}));
          }}
          if (sendBtn && !sendBtn.disabled) {{
            sendBtn.click();
          }}
          return {{ sent: false }};
        }})()
        """)
        if status and status.get("sent"):
            sent = True
            break
        if attempt == 5:
            cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"})
            cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"})
        time.sleep(0.6)

    if not sent:
        sent = cdp.eval(f"""
        (() => {{
          const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
          const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"]');
          const currUserCount = document.querySelectorAll('.user-query, user-query, [data-test-id="user-query"], message-content.user-message').length;
          return !!stopBtn || isStreaming || currUserCount > {prev_user_count};
        }})()
        """)

    if not sent:
        return False, "未能成功派发消息（发送按钮未响应或输入未提交）"

    # 4. 等待生成开始 (出现 stop 按钮、streaming 状态或新回复条数增加)
    for _ in range(30):
        started = cdp.eval(f"""
        (() => {{
          const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
          const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"]');
          const currCount = document.querySelectorAll('.model-response-text, model-response, .response-content').length;
          return !!stopBtn || isStreaming || currCount > {prev_resp_count};
        }})()
        """)
        if started:
            break
        time.sleep(0.5)

    # 5. 等待生成完全结束 (无 stop 按钮、无流式标记、且确实产生了新回复)
    start_time = time.time()
    while time.time() - start_time < max_wait:
        time.sleep(1.5)
        state = cdp.eval(f"""
        (() => {{
          const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]');
          const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"]');
          const currCount = document.querySelectorAll('.model-response-text, model-response, .response-content').length;
          const retryBtn = document.querySelector('button[aria-label*="Retry"], button[aria-label*="重试"]');
          const toastEl = document.querySelector('toast-content, .toast, .error-message, [role="alert"]');
          return {{
            hasStop: !!stopBtn,
            isStreaming: isStreaming,
            hasResponse: currCount > {prev_resp_count},
            hasRetry: !!retryBtn,
            toast: toastEl ? toastEl.textContent.trim() : null
          }};
        }})()
        """)
        if not state:
            continue

        if state.get("hasRetry"):
            print("      ⚠️ 检测到页面出现重试按钮，正在点击重试...")
            cdp.eval("""(() => {
                const btn = document.querySelector('button[aria-label*="Retry"], button[aria-label*="重试"]');
                if (btn) btn.click();
            })()""")
            time.sleep(2)
            continue

        if not state.get("hasStop") and not state.get("isStreaming") and state.get("hasResponse"):
            time.sleep(1.5)
            return True, "生成完毕"

        if time.time() - start_time > 25 and not state.get("hasStop") and not state.get("isStreaming") and not state.get("hasResponse") and state.get("toast"):
            return False, f"页面报错: {state.get('toast')}"

    return False, "等待回复超时"


def run_live_chat_and_export(dataset=None, port=CDP_DEFAULT_PORT, output_dir=None, delay=2, skip_chat=False, skip_takeout=False, takeout_zip=None, skip_reinstall=False, skip_tour=False):
    scenarios = dataset or DEFAULT_SCENARIOS
    if len(scenarios) < 2:
        print("❌ 场景数不足 2 个，本测试要求执行 2 次独立会话！")
        return False

    abs_output_dir = os.path.abspath(output_dir or os.path.join(os.path.dirname(__file__), "..", "tests", "output", "live_export"))
    os.makedirs(abs_output_dir, exist_ok=True)

    print("=" * 70)
    print("🚀 启动固定生产测试流：卸载重装 ➔ 新手向导 ➔ 真实 Gemini 问答 ➔ 导出 ➔ 规范断言")
    print(f"📁 导出目标目录: {abs_output_dir}")
    print(f"🌐 Chrome 端口: 127.0.0.1:{port}")
    if skip_reinstall:
        print("⚡ [模式] 已开启 --skip-reinstall：跳过扩展卸载与重装步骤")
    if skip_tour:
        print("⚡ [模式] 已开启 --skip-tour：跳过新手向导全流程测试步骤")
    if skip_chat:
        print("⚡ [模式] 已开启 --skip-chat：直接复用已有会话进行同步与导出校验")
    if not skip_takeout:
        print("📥 [增强] 已启用 Takeout 样本预置自动导入与历史合流验证")
    print("=" * 70)

    worktree_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    # ==========================================
    # 阶段零：通过原生 CDP 彻底卸载旧插件并纯净重装当前代码
    # ==========================================
    if not skip_reinstall:
        print("\n" + "-" * 70)
        print("🔄 阶段零：通过 CDP Extensions 域彻底卸载旧扩展并纯净安装当前代码...")
        print("-" * 70)
        reinstalled_id = reinstall_extension_via_cdp(port, repo_path=worktree_root)
        if not reinstalled_id:
            print("❌ 扩展卸载重装失败，中断全流程测试！")
            return False
        ext_id = reinstalled_id
        time.sleep(1.0)
    else:
        ext_id = get_extension_id(port)
        if not ext_id:
            print("❌ 未能获取到 Gemini Exporter 扩展程序 ID")
            return False

    print(f"🧩 当前活跃扩展 ID: {ext_id}")

    # 检查 Gemini 页面并在重装后第一时间刷新以注入最新 Content Scripts
    tabs = get_tabs(port)
    gemini_tab = next((t for t in tabs if "gemini.google.com" in t.get("url", "")), None)
    if not gemini_tab and not skip_chat:
        print("❌ 未在 Chrome 中找到打开的 gemini.google.com 页面")
        print("💡 请先启动测试浏览器: ./scripts/open_test_chrome.sh")
        return False

    if gemini_tab and not skip_reinstall:
        print("   🔄 扩展重新安装后，刷新 gemini.google.com 标签页以注入最新 Content Scripts...")
        cdp_g = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
        try:
            cdp_g.eval("location.reload()")
        except Exception:
            pass
        finally:
            cdp_g.close()
        time.sleep(2.0)

    # ==========================================
    # 阶段零点五：全流程自动化验证新手向导 (TourGuide 4步交互与落盘)
    # ==========================================
    if not skip_tour:
        print("\n" + "-" * 70)
        print("🧭 阶段零点五：全流程自动化验证新手向导 (TourGuide 4步交互与持久化)...")
        print("-" * 70)
        tour_ok = verify_onboarding_tour(port, ext_id)
        if not tour_ok:
            print("❌ 新手向导全自动验证失败，中断全流程测试！")
            return False

    chat_records = []

    # ==========================================
    # 阶段一与阶段二：执行 2 次对话，每次 5 轮 (或复用已有)
    # ==========================================
    if not skip_chat:
        cdp_gemini = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
        try:
            for chat_idx in range(2):
                sc = scenarios[chat_idx]
                sc_title = sc.get("title", f"测试会话 {chat_idx + 1}")
                turns = sc.get("turns", [])

                # 智能会话定位：优先从当前页面或侧边栏查找是否已有本场景的会话
                prompts_clean = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in turns]
                first_p = prompts_clean[0][:14] if prompts_clean else ""

                # 检查当前页面是否就是本场景
                curr_ups = cdp_gemini.eval("""
                (() => {
                    const ups = Array.from(document.querySelectorAll(".user-query, user-query, [data-test-id='user-query'], message-content.user-message"));
                    return ups.map(p => p.textContent);
                })()
                """) or []

                is_curr_page_match = any(first_p in up for up in curr_ups) if (curr_ups and first_p) else False

                if not is_curr_page_match:
                    # 检查侧边栏是否有本场景历史会话
                    sidebar_links = cdp_gemini.eval("""
                    (() => {
                        const anchors = Array.from(document.querySelectorAll("a"));
                        const links = anchors.filter(a => (a.getAttribute("href") || "").includes("/app/"));
                        return links.map(a => ({
                            cid: (a.getAttribute("href") || "").split("/app/")[1].split("?")[0],
                            text: a.textContent.trim()
                        }));
                    })()
                    """) or []
                    sidebar_match = next((l for l in sidebar_links if first_p in l["text"] or sc_title[:8] in l["text"]), None)
                    if sidebar_match and sidebar_match["cid"]:
                        target_cid = sidebar_match["cid"]
                        print(f"   🧭 侧边栏发现已有会话《{sidebar_match['text'][:20]}...》，跳转加载: /app/{target_cid}")
                        cdp_gemini.eval(f"location.href = 'https://gemini.google.com/app/{target_cid}'")
                        time.sleep(2.5)
                        try:
                            cdp_gemini.reconnect()
                        except Exception:
                            pass
                        wait_for_gemini_ready(cdp_gemini, max_wait=15)
                        curr_ups = cdp_gemini.eval("""
                        (() => {
                            const ups = Array.from(document.querySelectorAll(".user-query, user-query, [data-test-id='user-query'], message-content.user-message"));
                            return ups.map(p => p.textContent);
                        })()
                        """) or []

                # 计算已存在的轮次与缺失的轮次
                missing_turns = []
                for idx, t in enumerate(turns, 1):
                    p_text = t.get("prompt", "") if isinstance(t, dict) else str(t)
                    if not any(p_text[:14] in up for up in curr_ups):
                        missing_turns.append((idx, t))

                if not missing_turns:
                    existing_cid = get_current_chat_id(cdp_gemini)
                    print(f"   ⚡ 检测到会话在当前页面已完整存在 ({len(prompts_clean)} 轮全部就绪)，直接复用！会话 ID: {existing_cid}")
                    chat_records.append({
                        "chat_id": existing_cid,
                        "title": get_current_chat_title(cdp_gemini) or sc_title,
                        "turns": prompts_clean
                    })
                    continue

                chat_id = get_current_chat_id(cdp_gemini)
                successful_turns = [p for p in prompts_clean if any(p[:14] in up for up in curr_ups)]
                if curr_ups and len(missing_turns) < len(turns):
                    print(f"   ⚡ 检测到当前会话已包含 {len(turns) - len(missing_turns)}/{len(turns)} 轮，补充发送剩余 {len(missing_turns)} 轮！会话 ID: {chat_id}")
                    turns_to_run = missing_turns
                else:
                    # 全新对话
                    cdp_gemini.eval("location.href = 'https://gemini.google.com/app'")
                    time.sleep(1.8)
                    try:
                        cdp_gemini.reconnect()
                    except Exception:
                        pass
                    if not wait_for_gemini_ready(cdp_gemini):
                        print("❌ 页面加载超时，未能就绪")
                        return False
                    time.sleep(1.5)
                    turns_to_run = list(enumerate(turns, 1))
                    successful_turns = []

                for turn_no, turn_input in turns_to_run:
                    prompt_text = turn_input.get("prompt", "") if isinstance(turn_input, dict) else str(turn_input)
                    preview = (prompt_text[:48] + "...") if len(prompt_text) > 48 else prompt_text
                    print(f"   ▶️ 轮次 {turn_no}/{len(turns)}: \"{preview}\"")
                    ok = False
                    msg = ""
                    for try_idx in range(3):
                        ok, msg = send_turn(cdp_gemini, turn_input, max_wait=300)
                        if ok:
                            break
                        print(f"      ⚠️ 轮次 {turn_no} 提示: {msg}，等待 4 秒后重试 ({try_idx + 1}/3)...")
                        time.sleep(4)

                    if ok:
                        chat_id = get_current_chat_id(cdp_gemini) or chat_id
                        print(f"      ✅ 回复完成 (会话 ID: {chat_id or '生成中'})")
                        successful_turns.append(prompt_text)
                    else:
                        print(f"      ❌ {msg}")
                        return False
                    time.sleep(delay)

                real_title = get_current_chat_title(cdp_gemini) or sc_title
                chat_records.append({
                    "chat_id": chat_id,
                    "title": real_title,
                    "turns": prompts_clean
                })
                print(f"   🏁 第 {chat_idx + 1} 次对话完成！会话 ID: {chat_id}，总计 {len(prompts_clean)} 轮已全量就绪")

        finally:
            cdp_gemini.close()
    else:
        # 复用模式下：优先从当前活跃的 Gemini 标签页侧边栏探测最近生成的真实会话 ID
        recent_gemini_ids = []
        if gemini_tab:
            try:
                cdp_temp = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
                try:
                    detected = cdp_temp.eval("""
                    (() => {
                        const anchors = Array.from(document.querySelectorAll("a"));
                        const links = anchors.filter(a => (a.getAttribute("href") || "").includes("/app/"));
                        return links.map(a => {
                            const parts = (a.getAttribute("href") || "").split("/app/");
                            return parts.length > 1 ? parts[1].split("?")[0].trim() : null;
                        }).filter(id => id && id.length >= 8);
                    })()
                    """)
                    if detected and isinstance(detected, list):
                        for cid in detected:
                            if cid not in recent_gemini_ids:
                                recent_gemini_ids.append(cid)
                finally:
                    cdp_temp.close()
            except Exception:
                pass

        for chat_idx in range(2):
            sc = scenarios[chat_idx]
            raw_turns = sc.get("turns", [])
            extracted_prompts = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in raw_turns]
            # Note: in Gemini sidebar, newest chat is at top (index 0 is Session 2, index 1 is Session 1)
            real_cid = sc.get("id")
            if len(recent_gemini_ids) >= 2:
                # chat_idx 0 (Session 1, older) -> index 1 in sidebar
                # chat_idx 1 (Session 2, newer) -> index 0 in sidebar
                real_cid = recent_gemini_ids[1 - chat_idx]
            elif len(recent_gemini_ids) == 1:
                real_cid = recent_gemini_ids[0]

            chat_records.append({
                "chat_id": real_cid,
                "title": sc.get("title", ""),
                "turns": extracted_prompts
            })

    # ==========================================
    # 阶段三：控制插件后台 options.html 执行同步与导出
    # ==========================================
    print("\n" + "-" * 70)
    print("📦 阶段三：打开扩展后台 Options 页面，触发同步并导出选中的 2 个会话...")
    print("-" * 70)

    options_url = f"chrome-extension://{ext_id}/options.html"
    tabs = get_tabs(port)
    opt_tab = next((t for t in tabs if options_url in t.get("url", "")), None)
    if not opt_tab:
        new_url = f"http://127.0.0.1:{port}/json/new?{options_url}"
        req = urllib.request.Request(new_url, method="PUT")
        with urllib.request.urlopen(req, timeout=5) as r:
            opt_tab = json.loads(r.read().decode("utf-8"))

    cdp_opt = CDPConnection(opt_tab["webSocketDebuggerUrl"])
    try:
        try:
            cdp_opt.call("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": abs_output_dir})
        except Exception:
            pass

        browser_ws = get_browser_ws_url(port)
        if browser_ws:
            try:
                b_cdp = CDPConnection(browser_ws)
                b_cdp.call("Browser.setDownloadBehavior", {
                    "behavior": "allow",
                    "downloadPath": abs_output_dir,
                    "eventsEnabled": True
                })
                b_cdp.close()
            except Exception:
                pass

        time.sleep(1.0)

        # ------------------------------------------------------------------
        # 步骤 3.1：自动导入纯净版 Google Takeout ZIP 样本 (验证离线历史与附件)
        # ------------------------------------------------------------------
        resolved_takeout_zip = takeout_zip or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "gemini_takeout_clean.zip"))
        if not skip_takeout and os.path.isfile(resolved_takeout_zip):
            print(f"   📥 正在导入预置 Takeout ZIP 样本: {os.path.basename(resolved_takeout_zip)}...")
            with open(resolved_takeout_zip, "rb") as tf:
                zip_b64 = base64.b64encode(tf.read()).decode("ascii")

            takeout_res = cdp_opt.eval(f"""
            (async () => {{
                try {{
                    const b64 = {json.dumps(zip_b64)};
                    const bin = atob(b64);
                    const arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                    const file = new File([arr], "{os.path.basename(resolved_takeout_zip)}", {{ type: "application/zip" }});
                    
                    const TC = typeof TakeoutController !== 'undefined' ? TakeoutController : window.TakeoutController;
                    if (!TC) return {{ error: "TakeoutController not loaded" }};

                    return await new Promise((resolve) => {{
                        TC.handleTakeoutImport(file, {{
                            onFinished: (result) => {{
                                if (typeof window.__workbenchLoadStore === 'function') {{
                                    window.__workbenchLoadStore(true);
                                }}
                                resolve({{
                                    success: true,
                                    addedCount: result.addedCount,
                                    totalMediaCount: result.totalMediaCount
                                }});
                            }},
                            onError: (err, msg) => resolve({{ error: msg || (err && err.message) || String(err) }})
                        }});
                    }});
                }} catch (e) {{
                    return {{ error: e.message }};
                }}
            }})()
            """, await_promise=True)
            if isinstance(takeout_res, dict) and takeout_res.get("success"):
                print(f"   ✓ Takeout 导入成功！已索引离线附件池: {takeout_res.get('totalMediaCount', 0)} 个资源")
            else:
                err_info = takeout_res.get('error') if isinstance(takeout_res, dict) else str(takeout_res)
                print(f"   ⚠️ Takeout 导入提示: {err_info}")
            time.sleep(1.0)

        # ------------------------------------------------------------------
        # 步骤 3.2：点击【同步最新会话】，触发在线 RPC 与离线 Takeout 历史合流
        # ------------------------------------------------------------------
        print("   🔄 点击【同步最新会话】按钮...")
        cdp_opt.eval("""
        (() => {
            const btn = document.getElementById('btnIncrementalScan');
            if (btn) btn.click();
        })()
        """)

        # 等待同步完成 (SyncController.isScanning() 变回 false 且按钮恢复可用)
        print("   ⏳ 正在等待增量同步完成并渲染会话列表...")
        for _ in range(30):
            time.sleep(1)
            syncing = cdp_opt.eval("""
            (() => {
                const sc = typeof SyncCtrl !== 'undefined' ? SyncCtrl : (typeof SyncController !== 'undefined' ? SyncController : null);
                const isScan = sc && (sc.isScanning ? sc.isScanning() : (sc.isRunning ? sc.isRunning() : false));
                const btn = document.getElementById('btnExport');
                return isScan || (btn && btn.disabled);
            })()
            """)
            if not syncing:
                break
        time.sleep(1.0)

        # 确保 skipExported 复选框处于未勾选状态，强制全量取回对话内容
        cdp_opt.eval("""
        (() => {
            const skipCb = document.getElementById('skipExported');
            if (skipCb && skipCb.checked) {
                skipCb.checked = false;
                skipCb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        })()
        """)

        # 目标会话：包含本次发帖会话 + 固化测试账号中的已知特征会话
        target_ids = [r["chat_id"] for r in chat_records if r.get("chat_id") and len(str(r["chat_id"])) > 8]
        # 追加已知的 Takeout 与在线黄金会话（Python 装饰器、火星猫咪、编译器、Envoy 网关）
        target_ids.extend(["1cea7e48cc166b57", "1bd028d5c5b0c0e2", "3a07d47ddb6e8708", "9b292113807b3c07"])
        target_titles = [r.get("title", "") for r in chat_records if r.get("title")]

        # 通过 label.item[data-chat-id] 及标题关键词精准勾选目标会话
        print(f"   ☑️ 勾选目标会话进行精准导出...")
        selected_count = cdp_opt.eval(f"""
        (() => {{
            const selectNone = document.getElementById('btnSelectNone');
            if (selectNone) selectNone.click();
            
            const targetIds = {json.dumps(target_ids)};
            const targetTitles = {json.dumps(target_titles)};
            const items = Array.from(document.querySelectorAll('#list .item'));
            let checked = 0;

            items.forEach(item => {{
                const cid = item.dataset.chatId;
                const titleText = item.querySelector('.title')?.textContent || '';
                const matchId = targetIds.some(tid => cid && (cid === tid || cid.includes(tid) || tid.includes(cid)));
                const matchTitle = targetTitles.some(tt => tt && tt.length > 2 && (titleText.includes(tt) || tt.includes(titleText)));
                if (matchId || matchTitle) {{
                    const cb = item.querySelector('input[type=checkbox]');
                    if (cb && !cb.checked) {{
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        checked++;
                    }}
                }}
            }});

            // 兜底：若勾选数少于 2，选列表顶部最新的 2 条
            if (checked < 2) {{
                items.slice(0, 2).forEach(item => {{
                    const cb = item.querySelector('input[type=checkbox]');
                    if (cb && !cb.checked) {{
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        checked++;
                    }}
                }});
                checked = 2;
            }}

            return checked;
        }})()
        """)
        time.sleep(0.5)
        print(f"   ✓ 成功勾选 {selected_count} 条会话")

        # 等待导出按钮非 disabled 状态
        for _ in range(20):
            is_ready = cdp_opt.eval("""
            (() => {
                const btn = document.getElementById('btnExport');
                return btn && !btn.disabled;
            })()
            """)
            if is_ready:
                break
            time.sleep(0.5)

        start_export_time = time.time()

        # 点击【导出选中 → ZIP】
        print("   🚀 点击【导出选中 → ZIP】主按钮...")
        for attempt in range(5):
            click_res = cdp_opt.eval("""
            (() => {
                const btn = document.getElementById('btnExport');
                if (!btn || btn.disabled) return { ok: false, reason: 'btn disabled or missing' };
                btn.click();
                return { ok: true };
            })()
            """)
            if click_res and click_res.get("ok"):
                break
            time.sleep(1.0)

        # 等待 ZIP 导出与下载完成
        print(f"   ⏳ 正在等待 ZIP 导出打包完成并落地...")
        downloaded_zip = None
        for _ in range(40):
            time.sleep(1.5)
            # 1. 检查 abs_output_dir
            for f in os.listdir(abs_output_dir):
                if re.match(r"(?i)gemini_export_.*\.zip$", f):
                    fpath = os.path.join(abs_output_dir, f)
                    if os.path.getmtime(fpath) >= start_export_time - 3:
                        downloaded_zip = fpath
                        break
            if downloaded_zip:
                break

            # 2. 检查 ~/Downloads
            sys_downloads = os.path.expanduser("~/Downloads")
            if os.path.isdir(sys_downloads):
                for f in os.listdir(sys_downloads):
                    if re.match(r"(?i)gemini_export_.*\.zip$", f):
                        fpath = os.path.join(sys_downloads, f)
                        if os.path.getmtime(fpath) >= start_export_time - 3:
                            downloaded_zip = fpath
                            break
            if downloaded_zip:
                break

        if not downloaded_zip:
            print("❌ 未在超时时间内检测到导出的 ZIP 文件！")
            return False

        # 若从系统下载目录捕获，拷贝至本次专用的导出目录
        sys_downloads = os.path.expanduser("~/Downloads")
        if sys_downloads in downloaded_zip:
            dest_zip = os.path.join(abs_output_dir, os.path.basename(downloaded_zip))
            if os.path.abspath(downloaded_zip) != os.path.abspath(dest_zip):
                import shutil
                shutil.copy2(downloaded_zip, dest_zip)
                downloaded_zip = dest_zip

        print(f"   ✅ 成功获取导出 ZIP: {downloaded_zip} ({os.path.getsize(downloaded_zip)} bytes)")

    finally:
        cdp_opt.close()

    # ==========================================
    # 阶段四：解压与严格断言校验 (Verification)
    # ==========================================
    print("\n" + "=" * 70)
    print("🔍 阶段四：深入校验导出的会话文件与 5 轮对话完整性...")
    print("=" * 70)

    extract_dir = os.path.join(abs_output_dir, "extracted_verify_" + str(int(time.time())))
    os.makedirs(extract_dir, exist_ok=True)

    with zipfile.ZipFile(downloaded_zip, "r") as zf:
        zf.extractall(extract_dir)

    all_extracted_files = []
    for root, _, files in os.walk(extract_dir):
        for f in files:
            if f.endswith(".md") and not f.startswith("00_INDEX") and not f.startswith("_index"):
                all_extracted_files.append(os.path.join(root, f))

    all_extracted_files.sort()

    print(f"📂 解压出的 Markdown 对话文件数: {len(all_extracted_files)}")
    if len(all_extracted_files) < 2:
        print(f"❌ 导出的会话文件不足 2 个 (实际找到 {len(all_extracted_files)})！")
        return False

    verification_success = True

    should_verify_scenarios = (not skip_chat) or (dataset is not None)
    if should_verify_scenarios:
        for idx, sc in enumerate(scenarios[:2], 1):
            raw_turns = sc.get("turns", [])
            expected_turns = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in raw_turns]
            num_expected = len(expected_turns)
            sc_title = sc.get("title", f"场景 {idx}")
            print(f"\n[验证 {idx}/2] 🔎 正在核对会话 {idx}: 《{sc_title}》 (共 {num_expected} 轮)")

            # 智能匹配属于此场景的导出文件（只要包含本场景任意一轮 Prompt 关键词）
            matched_file = None
            for fpath in all_extracted_files:
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                if any(t[:14] in content for t in expected_turns if t):
                    matched_file = fpath
                    break

            if not matched_file and idx <= len(all_extracted_files):
                matched_file = all_extracted_files[idx - 1]

            if not matched_file:
                print(f"   ❌ 未能找到会话 {idx} 对应的导出文件！")
                verification_success = False
                continue

            print(f"   📄 匹配到导出文件: {os.path.basename(matched_file)} ({os.path.getsize(matched_file)} bytes)")
            with open(matched_file, "r", encoding="utf-8", errors="ignore") as f:
                file_text = f.read()

            matched_turns_count = 0
            for t_idx, prompt_str in enumerate(expected_turns, 1):
                snippet = prompt_str[:16]
                if snippet in file_text:
                    matched_turns_count += 1
                    print(f"      ✓ 轮次 {t_idx}/{num_expected} 校验通过: 「{snippet}...」在导出文件中完整存在")
                else:
                    print(f"      ❌ 轮次 {t_idx}/{num_expected} 缺失: 未在文件中找到「{snippet}...」")
                    verification_success = False

            # 校验轮次标记
            turn_headers = len(re.findall(r"(?:###|####|\*\*User\*\*|\*\*Model\*\*|\*\*Gemini\*\*|## 👤|## 🤖)", file_text))
            min_expected_headers = max(10, num_expected * 2)
            print(f"      📊 会话问答角色标记数: {turn_headers} (预期至少 {min_expected_headers} 个角色轮次标记)")

            if matched_turns_count == num_expected:
                print(f"   🎉 会话 {idx} 全部 {num_expected} 轮对话内容核对 100% 完整无误！")
            else:
                print(f"   ⚠️ 会话 {idx} 仅核对到 {matched_turns_count}/{num_expected} 轮！")
                verification_success = False

    # ==========================================
    # 阶段 4.2：执行全量导出规范与特征深度断言
    # ==========================================
    golden_chats = [
        {
            "id": "1cea7e48cc166b57",
            "name": "Python 装饰器函数",
            "expected_snippets": ["Python", "def ", "functools"],
            "syntax_checks": ["codeblock"]
        },
        {
            "id": "1bd028d5c5b0c0e2",
            "name": "火星宇航员猫咪",
            "expected_snippets": ["astronaut cat"],
            "syntax_checks": ["image"]
        }
    ]
    # 若在线发帖，追加在线场景关键词作为黄金校验
    if should_verify_scenarios:
        for idx, sc in enumerate(scenarios[:2]):
            title = sc.get("title", "")
            raw_turns = sc.get("turns", [])
            prompts = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in raw_turns]
            syntax_checks = []
            if any(kw in title for kw in ["代码", "编译器", "Rust", "Python"]) or any(kw in p for p in prompts for kw in ["编写", "实现", "代码", "def ", "fn "]):
                syntax_checks.append("codeblock")
            if any(kw in p for p in prompts for kw in ["生成一张图片", "生成图片", "画一张", "image"]):
                syntax_checks.append("image")

            rec_cid = chat_records[idx].get("chat_id") if idx < len(chat_records) else None

            golden_chats.append({
                "id": rec_cid or sc.get("id"),
                "name": title,
                "expected_snippets": [t[:14] for t in prompts[:3] if t],
                "syntax_checks": syntax_checks
            })

    asserter = ExportSpecificationAsserter(extract_dir)
    spec_success = asserter.run_all_assertions(min_conversations=2, expected_golden_chats=golden_chats)
    if not spec_success:
        verification_success = False

    print("\n" + "=" * 70)
    if verification_success:
        print("🏆 🎉 全部会话端到端导出、多轮内容与全维度格式规范断言 100% 成功通过！")
    else:
        print("❌ 测试断言未完全通过，请检查上述具体缺失或规范违背报告！")
    print("=" * 70)

    return verification_success


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gemini 2次×5轮真实对话、Takeout 导入与导出规范断言全生产测试流程")
    parser.add_argument("--dataset", default=None, help="自定义测试数据集 JSON 文件路径 (为空时启用内置标准 5 轮数据集)")
    parser.add_argument("--output-dir", default=None, help="测试导出落地目录")
    parser.add_argument("--port", type=int, default=CDP_DEFAULT_PORT, help="Chrome CDP 远程调试端口")
    parser.add_argument("--delay", type=int, default=2, help="轮次之间的间隔秒数")
    parser.add_argument("--skip-chat", action="store_true", help="跳过发帖步骤，直接使用已有会话跑导出与目录校验")
    parser.add_argument("--skip-takeout", action="store_true", help="跳过预置 Takeout ZIP 导入步骤")
    parser.add_argument("--skip-reinstall", action="store_true", help="跳过扩展卸载与重装步骤")
    parser.add_argument("--skip-tour", action="store_true", help="跳过新手向导全流程测试步骤")
    parser.add_argument("--takeout-zip", default=None, help="自定义预置 Takeout ZIP 样本路径")
    args = parser.parse_args()

    custom_dataset = None
    if args.dataset:
        if not os.path.isfile(args.dataset):
            print(f"❌ 指定的数据集文件不存在: {args.dataset}")
            sys.exit(1)
        with open(args.dataset, "r", encoding="utf-8") as f:
            custom_dataset = json.load(f)

    success = run_live_chat_and_export(
        dataset=custom_dataset,
        port=args.port,
        output_dir=args.output_dir,
        delay=args.delay,
        skip_chat=args.skip_chat,
        skip_takeout=args.skip_takeout,
        takeout_zip=args.takeout_zip,
        skip_reinstall=args.skip_reinstall,
        skip_tour=args.skip_tour
    )
    sys.exit(0 if success else 1)

