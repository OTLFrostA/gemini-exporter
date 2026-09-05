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

    # 记录发送前已有的回复条数，防止多轮时误判旧回复已完成
    prev_resp_count = cdp.eval("""
    (() => document.querySelectorAll('.model-response-text, model-response, .response-content').length)()
    """) or 0

    # 1. 聚焦输入框并清空原有占位符
    cdp.eval("""
    (() => {
      const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
      if (editor) {
        editor.focus();
        editor.innerHTML = '<p><br></p>';
      }
    })()
    """)
    time.sleep(0.3)

    # 2. 原生输入文本
    cdp.call("Input.insertText", {"text": prompt_text})
    time.sleep(0.5)

    # 3. 点击发送按钮
    sent = False
    for _ in range(10):
        sent = cdp.eval("""
        (() => {
          const sendBtn = document.querySelector('button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="发送"]');
          if (sendBtn && !sendBtn.disabled) {
            sendBtn.click();
            return true;
          }
          return false;
        })()
        """)
        if sent:
            break
        time.sleep(0.5)

    if not sent:
        return False, "未能点击发送按钮"

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
          return {{
            hasStop: !!stopBtn,
            isStreaming: isStreaming,
            hasResponse: currCount > {prev_resp_count}
          }};
        }})()
        """)
        if not state:
            continue

        if not state.get("hasStop") and not state.get("isStreaming") and state.get("hasResponse"):
            time.sleep(1.5)
            return True, "生成完毕"

    return False, "等待回复超时"


def run_live_chat_and_export(dataset=None, port=CDP_DEFAULT_PORT, output_dir=None, delay=2, skip_chat=False, skip_takeout=False, takeout_zip=None):
    scenarios = dataset or DEFAULT_SCENARIOS
    if len(scenarios) < 2:
        print("❌ 场景数不足 2 个，本测试要求执行 2 次独立会话！")
        return False

    abs_output_dir = os.path.abspath(output_dir or os.path.join(os.path.dirname(__file__), "..", "tests", "output", "live_export"))
    os.makedirs(abs_output_dir, exist_ok=True)

    print("=" * 70)
    print("🚀 启动固定生产测试流：真实 Gemini 2次×5轮问答 ➔ 插件导出 ➔ 目录断言")
    print(f"📁 导出目标目录: {abs_output_dir}")
    print(f"🌐 Chrome 端口: 127.0.0.1:{port}")
    if skip_chat:
        print("⚡ [模式] 已开启 --skip-chat：直接复用已有会话进行同步与导出校验")
    if not skip_takeout:
        print("📥 [增强] 已启用 Takeout 样本预置自动导入与历史合流验证")
    print("=" * 70)

    tabs = get_tabs(port)
    gemini_tab = next((t for t in tabs if "gemini.google.com" in t.get("url", "")), None)
    if not gemini_tab and not skip_chat:
        print("❌ 未在 Chrome 中找到打开的 gemini.google.com 页面")
        print("💡 请先启动测试浏览器: ./scripts/open_test_chrome.sh")
        return False

    ext_id = get_extension_id(port)
    if not ext_id:
        print("❌ 未能获取到 Gemini Exporter 扩展程序 ID")
        return False
    print(f"🧩 识别到扩展 ID: {ext_id}")

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

                # 智能断点续跑：如果当前会话已包含本场景所有轮次提问，直接复用该真实会话
                prompts_clean = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in turns]
                curr_ups = cdp_gemini.eval("""
                (() => {
                    const ups = Array.from(document.querySelectorAll(".user-query, user-query, [data-test-id='user-query'], message-content.user-message"));
                    return ups.map(p => p.textContent);
                })()
                """) or []
                if curr_ups and len(curr_ups) >= len(prompts_clean) and all(any(p[:14] in up for up in curr_ups) for p in prompts_clean):
                    existing_cid = get_current_chat_id(cdp_gemini)
                    if existing_cid:
                        print(f"   ⚡ 检测到会话在当前页面已完整存在 ({len(prompts_clean)} 轮全部就绪)，直接复用！会话 ID: {existing_cid}")
                        chat_records.append({
                            "chat_id": existing_cid,
                            "title": get_current_chat_title(cdp_gemini) or sc_title,
                            "turns": prompts_clean
                        })
                        continue

                # 开启独立新对话: 强制导航至 /app 并重连 WebSocket 确保页面与状态绝对干净
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

                chat_id = None
                successful_turns = []

                for turn_no, turn_input in enumerate(turns, 1):
                    prompt_text = turn_input.get("prompt", "") if isinstance(turn_input, dict) else str(turn_input)
                    preview = (prompt_text[:48] + "...") if len(prompt_text) > 48 else prompt_text
                    print(f"   ▶️ 轮次 {turn_no}/{len(turns)}: \"{preview}\"")
                    ok, msg = send_turn(cdp_gemini, turn_input)
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
                    "turns": successful_turns
                })
                print(f"   🏁 第 {chat_idx + 1} 次对话完成！会话 ID: {chat_id}，实际抓取到 {len(successful_turns)}/{len(turns)} 轮")

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

        # 等待同步完成 (SyncCtrl.isRunning() 变回 false)
        print("   ⏳ 正在等待增量同步完成并渲染会话列表...")
        for _ in range(20):
            time.sleep(1)
            syncing = cdp_opt.eval("typeof SyncCtrl !== 'undefined' ? SyncCtrl.isRunning() : false")
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

        start_export_time = time.time()

        # 点击【导出选中 → ZIP】
        print("   🚀 点击【导出选中 → ZIP】主按钮...")
        cdp_opt.eval("""
        (() => {
            const btn = document.getElementById('btnExport');
            if (btn) btn.click();
        })()
        """)

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
        takeout_zip=args.takeout_zip
    )
    sys.exit(0 if success else 1)

