# scripts/framework/actions.py
"""
Reusable CDP Action Primitives for Gemini Exporter Test Automation.
Encapsulates real web interactions (typing, clicking, waiting for streams, searching, importing, deleting).
"""

import os
import re
import time
import json
import base64
import urllib.request
from typing import Tuple, Optional, Dict, Any, List

import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
try:
    from scripts.cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url
except ImportError:
    from cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url


class CDPActions:
    @staticmethod
    def reinstall_extension(port: int = 9222, repo_path: Optional[str] = None) -> Optional[str]:
        """通过 CDP Extensions 域指令彻底卸载并纯净重新安装插件"""
        repo_path = os.path.abspath(repo_path or os.path.join(os.path.dirname(__file__), "..", ".."))
        browser_ws = get_browser_ws_url(port)
        if not browser_ws:
            print(f"❌ 无法获取 Chrome Browser WebSocket (端口 {port})")
            return None

        old_ext_id = get_extension_id(port)
        cdp = CDPConnection(browser_ws)
        try:
            if old_ext_id:
                print(f"   🗑️ 正在通过 CDP Extensions.uninstall 卸载旧扩展 ({old_ext_id})...")
                try:
                    cdp.call("Extensions.uninstall", {"id": old_ext_id})
                except Exception as e:
                    print(f"   ⚠️ 卸载旧扩展提示: {e}")
                time.sleep(0.5)

            print(f"   📦 正在通过 CDP Extensions.loadUnpacked 安装扩展: {repo_path}...")
            res = cdp.call("Extensions.loadUnpacked", {"path": repo_path})
            new_ext_id = res.get("result", {}).get("id")
            if not new_ext_id:
                print(f"❌ 扩展安装失败，CDP 返回: {res}")
                return None
            print(f"   ✅ 扩展安装成功！新 Extension ID: {new_ext_id}")
            return new_ext_id
        finally:
            cdp.close()

    @staticmethod
    def verify_onboarding_tour(port: int = 9222, ext_id: Optional[str] = None, timeout: int = 15) -> bool:
        """全自动验证 options.html?welcome=1 新手向导交互流程与状态持久化"""
        print("   🧭 正在定位 options.html?welcome=1 标签页...")
        start_time = time.time()
        welcome_tab = None
        welcome_url_part = f"chrome-extension://{ext_id}/src/ui/options/options.html?welcome=1"
        base_options_part = f"chrome-extension://{ext_id}/src/ui/options/options.html"

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
            new_url = f"http://127.0.0.1:{port}/json/new?{welcome_url_part}"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                welcome_tab = json.loads(r.read().decode("utf-8"))

        cdp = CDPConnection(welcome_tab["webSocketDebuggerUrl"])
        try:
            tour_ready = False
            for _ in range(20):
                is_active = cdp.eval("""
                (() => {
                    const popover = document.querySelector('.tour-popover');
                    const active = window.TourGuide ? window.TourGuide.isActive() : false;
                    return active && !!popover;
                })()
                """)
                if is_active:
                    tour_ready = True
                    break
                time.sleep(0.4)

            if not tour_ready:
                cdp.eval("if (window.TourGuide) window.TourGuide.startTour(0);")
                time.sleep(0.5)

            # Step 1
            step1_info = cdp.eval("""
            (() => {
                const badge = document.querySelector('.tour-step-badge')?.textContent || '';
                const step = window.TourGuide ? window.TourGuide.getCurrentStep() : -1;
                return { badge, step };
            })()
            """) or {}
            current_step_num = step1_info.get("step", 0)
            if current_step_num == 0:
                cdp.eval("""
                (() => {
                    const nextBtn = document.getElementById('tourNextBtn');
                    if (nextBtn) nextBtn.click();
                    else if (window.TourGuide) window.TourGuide.nextStep();
                })()
                """)
                time.sleep(0.5)

            # Step 2: 触发 #btnIncrementalScan
            cdp.eval("""
            (() => {
                const btn = document.getElementById('btnIncrementalScan');
                if (btn) btn.click();
            })()
            """)
            time.sleep(0.8)

            # Step 3: 会话勾选推进
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
            time.sleep(0.8)

            # Step 4: 导出步骤 -> 推进至完成
            for _ in range(15):
                time.sleep(0.3)
                is_active = cdp.eval("window.TourGuide ? window.TourGuide.isActive() : false")
                if not is_active:
                    break
                cur_step = cdp.eval("window.TourGuide ? window.TourGuide.getCurrentStep() : -1")
                total_steps = cdp.eval("window.TourGuide && window.TourGuide.STEPS ? window.TourGuide.STEPS.length : 6")
                if cur_step >= total_steps - 1:
                    cdp.eval("""
                    (() => {
                        const nextBtn = document.getElementById('tourNextBtn');
                        if (nextBtn) nextBtn.click();
                        else if (window.TourGuide) window.TourGuide.finishTour();
                    })()
                    """)
                    time.sleep(0.5)
                    break
                else:
                    cdp.eval("""
                    (() => {
                        const nextBtn = document.getElementById('tourNextBtn');
                        if (nextBtn) nextBtn.click();
                        else if (window.TourGuide) window.TourGuide.nextStep();
                    })()
                    """)

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
            """, await_promise=True) or {}

            if completed_state.get("isActive") or completed_state.get("hasPopover"):
                return False
            if not completed_state.get("storageCompleted"):
                return False

            cdp.eval("history.replaceState(null, '', 'options.html');")
            return True
        finally:
            cdp.close()

    @staticmethod
    def wait_for_gemini_ready(cdp, max_wait: int = 30) -> bool:
        """等待 Gemini 页面输入框及核心 DOM 就绪"""
        start = time.time()
        while time.time() - start < max_wait:
            ready = cdp.eval("""
            (() => {
                const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
                return !!(editor && document.body);
            })()
            """)
            if ready:
                return True
            time.sleep(0.5)
        return False

    @staticmethod
    def get_current_chat_id(cdp) -> Optional[str]:
        """从当前页面 URL 或 DOM 属性提取正在进行的对话 ID"""
        raw_id = cdp.eval("""
        (() => {
            const path = window.location.pathname || "";
            const parts = path.split("/app/");
            if (parts.length > 1) {
                const cid = parts[1].split("?")[0].trim();
                if (cid && cid.length >= 8) return cid;
            }
            const el = document.querySelector('[data-conversation-id], [data-chat-id]');
            if (el) return el.getAttribute('data-conversation-id') || el.getAttribute('data-chat-id');
            return null;
        })()
        """)
        return str(raw_id).strip() if raw_id else None

    @staticmethod
    def get_current_chat_title(cdp) -> Optional[str]:
        """从当前 Gemini 页面提取权威对话标题"""
        title = cdp.eval("""
        (() => {
            const explicit = document.querySelector('.conversation-title, [data-test-id="conversation-title"]');
            if (explicit && explicit.textContent.trim()) return explicit.textContent.trim();
            const heading = document.querySelector('h1');
            if (heading && heading.textContent.trim() && !heading.textContent.includes('Gemini')) return heading.textContent.trim();
            const docTitle = document.title || "";
            const cleaned = docTitle.replace(/ - Gemini$| - Google Gemini$|^Gemini - /i, '').trim();
            if (cleaned && cleaned !== 'Gemini') return cleaned;
            return null;
        })()
        """)
        return str(title).strip() if title else None

    @staticmethod
    def send_gemini_turn(cdp, turn_input: Any, max_wait: int = 300) -> Tuple[bool, str]:
        """向 Gemini 聚焦输入框、粘贴 Prompt、点击发送并完整等待流式生成稳定完成"""
        if isinstance(turn_input, dict):
            prompt_text = turn_input.get("prompt", "")
        else:
            prompt_text = str(turn_input)

        is_image_gen = any(kw in prompt_text for kw in ["生成图片", "生成一张图片", "画一张", "generate an image", "create an image"])
        if is_image_gen:
            max_wait = max(max_wait, 240)

        # 0. 确保 Gemini 处于空闲状态
        for _ in range(45):
            busy = cdp.eval("""
            (() => {
                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
                const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"], spark-progress');
                return !!(stopBtn && stopBtn.offsetWidth > 0) || isStreaming;
            })()
            """)
            if not busy:
                break
            time.sleep(1.0)

        prev_model_info = cdp.eval("""
        (() => {
            const allModels = Array.from(document.querySelectorAll('message-content.model-response-text, model-response, .model-response-text'));
            return {
                count: allModels.length,
                lastLen: allModels.length ? (allModels[allModels.length - 1].textContent || '').trim().length : 0
            };
        })()
        """) or {"count": 0, "lastLen": 0}
        prev_resp_count = prev_model_info.get("count", 0)
        prev_last_len = prev_model_info.get("lastLen", 0)

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

        # 2. 原生插入文本并分发事件
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

        # 3. 点击发送按钮并验证派发
        sent = False
        for attempt in range(12):
            status = cdp.eval(f"""
            (() => {{
              const currUserCount = document.querySelectorAll('.user-query, user-query, [data-test-id="user-query"], message-content.user-message').length;
              if (currUserCount > {prev_user_count}) {{
                return {{ sent: true, userCount: currUserCount }};
              }}

              const sendBtn = document.querySelector('button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="Submit"], button[aria-label*="发送"], button[aria-label*="提交"], [aria-label="Send message"], .send-button button, gem-icon-button.send-button button, gem-icon-button.send-button');
              let coords = null;
              if (sendBtn) {{
                const isDisabled = sendBtn.disabled || sendBtn.getAttribute('aria-disabled') === 'true';
                if (!isDisabled) {{
                  const r = sendBtn.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {{
                    coords = {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
                  }}
                  sendBtn.click();
                  if (sendBtn.parentElement && (sendBtn.parentElement.tagName === 'GEM-ICON-BUTTON' || sendBtn.parentElement.classList.contains('send-button'))) {{
                    sendBtn.parentElement.click();
                  }}
                }}
              }}
              return {{ sent: false, userCount: currUserCount, coords: coords }};
            }})()
            """)
            if status and status.get("sent"):
                sent = True
                break
            if status and status.get("coords"):
                cx = status["coords"]["x"]
                cy = status["coords"]["y"]
                cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": cx, "y": cy})
                cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": cx, "y": cy, "button": "left", "clickCount": 1})
                cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": cx, "y": cy, "button": "left", "clickCount": 1})
            if attempt in [2, 5, 8]:
                cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"})
                cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 13, "unmodifiedText": "\r", "text": "\r"})
            time.sleep(0.5)

        if not sent:
            return False, "未能成功派发消息（输入未提交到对话流）"

        # 4. 等待生成开始
        for _ in range(30):
            started = cdp.eval(f"""
            (() => {{
              const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
              const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"], spark-progress');
              const currCount = document.querySelectorAll('.model-response-text, model-response, .response-content').length;
              return !!stopBtn || isStreaming || currCount > {prev_resp_count};
            }})()
            """)
            if started:
                break
            time.sleep(0.5)

        # 5. 等待生成稳定结束
        start_time = time.time()
        last_seen_len = 0
        stable_count = 0
        loop_idx = 0
        while time.time() - start_time < max_wait:
            time.sleep(1.2)
            loop_idx += 1
            elapsed = time.time() - start_time
            state = cdp.eval(f"""
            (() => {{
              const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
              const isStopActive = !!(stopBtn && stopBtn.offsetWidth > 0);
              const sendBtn = document.querySelector('button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="Submit"], button[aria-label*="发送"], button[aria-label*="提交"], gem-icon-button.send-button:not(.stop)');
              const isSendReady = !!(sendBtn && sendBtn.offsetWidth > 0 && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true');
              const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
              const isEditorReady = !!(editor && (editor.getAttribute('contenteditable') === 'true' || editor.offsetWidth > 0));
              const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"], spark-progress');
              const allModels = Array.from(document.querySelectorAll('message-content.model-response-text, model-response, .model-response-text, structured-content-container.model-response-text'));
              const currCount = allModels.length;
              const retryBtn = document.querySelector('button[aria-label*="Retry"], button[aria-label*="重试"]');
              const toastEl = document.querySelector('toast-content, .toast, .error-message, [role="alert"]');
              const lastModel = currCount > 0 ? allModels[currCount - 1] : null;
              const lastLen = lastModel ? (lastModel.textContent || '').trim().length : 0;
              const hasImages = lastModel ? (lastModel.querySelectorAll('img[src*="blob:"], img[src*="googleusercontent"], .image-container, img').length > 0) : false;
              return {{
                hasStop: isStopActive,
                hasSend: isSendReady,
                isEditorReady: isEditorReady,
                isStreaming: isStreaming,
                currCount: currCount,
                hasImages: hasImages,
                hasResponse: currCount > {prev_resp_count} || (currCount === {prev_resp_count} && (lastLen > {prev_last_len} + 30 || hasImages)),
                hasRetry: !!retryBtn,
                toast: toastEl ? toastEl.textContent.trim() : null,
                lastLen: lastLen
              }};
            }})()
            """)
            if not state:
                continue

            if state.get("hasRetry"):
                cdp.eval("""(() => { const btn = document.querySelector('button[aria-label*="Retry"], button[aria-label*="重试"]'); if (btn) btn.click(); })()""")
                time.sleep(2)
                continue

            last_len = state.get("lastLen", 0)
            has_resp = state.get("hasResponse", False)
            has_images = state.get("hasImages", False)
            is_stream = state.get("isStreaming", False)
            has_stop = state.get("hasStop", False)
            has_send = state.get("hasSend", False)
            is_editor_ready = state.get("isEditorReady", False)
            ready_for_next = has_send or is_editor_ready

            if has_resp and not is_stream and not has_stop and ready_for_next:
                if has_images and last_len < 20:
                    stable_count += 1
                    if stable_count >= 2:
                        time.sleep(1.0)
                        return True, f"生图生成完毕 (耗时 {elapsed:.1f}s, 检测到图片实体)"
                elif last_len == last_seen_len:
                    stable_count += 1
                    if stable_count >= 2:
                        time.sleep(1.0)
                        return True, f"生成完毕 (耗时 {elapsed:.1f}s, 尾部长度: {last_len})"
                else:
                    last_seen_len = last_len
                    stable_count = 0
            elif has_resp and not is_stream and last_len == last_seen_len and last_seen_len > 30:
                stable_count += 1
                if stable_count >= 6:
                    time.sleep(1.0)
                    return True, f"生成完毕 (文本稳定 {stable_count} 次, 耗时 {elapsed:.1f}s, 尾部长度: {last_len})"
            else:
                if last_len != last_seen_len:
                    last_seen_len = last_len
                    stable_count = 0

            if elapsed > 25 and not has_stop and not is_stream and not has_resp and state.get("toast"):
                return False, f"页面报错: {state.get('toast')}"

        return False, f"流式回复超时未完全稳定 (耗时 {max_wait}s)"

    @staticmethod
    def click_new_chat(cdp) -> bool:
        """点击开启新对话"""
        res = cdp.eval("""
        (() => {
            const newBtn = document.querySelector('a[href="/app"], [aria-label*="New chat"], [aria-label*="新会话"], [data-test-id="new-chat-button"]');
            if (newBtn) {
                newBtn.click();
                return true;
            }
            window.location.href = 'https://gemini.google.com/app';
            return true;
        })()
        """)
        time.sleep(2.0)
        return bool(res)

    @staticmethod
    def delete_conversation_via_web(cdp_gemini, chat_id: str) -> bool:
        """在 Gemini 网页端侧边栏执行真实会话删除链路"""
        click_opts = cdp_gemini.eval(f"""
        (() => {{
            const a = document.querySelector('a[href*="{chat_id}"]');
            if (!a) return 'link_not_found';
            const btn = a.parentElement.querySelector('button[aria-label^="More options"], button[aria-label*="更多选项"]');
            if (!btn) return 'btn_not_found';
            btn.click();
            return 'options_clicked';
        }})()
        """)
        if click_opts != 'options_clicked':
            return False
        time.sleep(0.6)

        del_click = cdp_gemini.eval("""
        (() => {
            const delBtn = document.querySelector('button[data-test-id="delete-button"], [role="menuitem"][data-test-id*="delete"], [role="menuitem"]:has(.delete-icon)');
            if (delBtn) {
                delBtn.click();
                return true;
            }
            const items = Array.from(document.querySelectorAll('[role="menuitem"], button'));
            const match = items.find(b => {
                const t = b.textContent.trim().toLowerCase();
                return t.includes('delete') || t.includes('删除');
            });
            if (match) {
                match.click();
                return true;
            }
            return false;
        })()
        """)
        if not del_click:
            return False
        time.sleep(0.8)

        confirm_click = cdp_gemini.eval("""
        (() => {
            const dialog = document.querySelector('mat-dialog-container, [role="dialog"], .mat-mdc-dialog-container');
            if (!dialog) return false;
            const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(b => {
                const txt = b.innerText.trim().toLowerCase();
                return txt === 'delete' || txt === '删除';
            });
            if (confirmBtn) {
                confirmBtn.click();
                return true;
            }
            return false;
        })()
        """)
        time.sleep(2.0)
        return bool(confirm_click)

    @staticmethod
    def search_workbench(cdp_opt, query: str) -> int:
        """在 Options 工作台搜索框输入检索内容并触发过滤，返回过滤后可见条目数"""
        return cdp_opt.eval(f"""
        (() => {{
            const input = document.getElementById('chatSearchInput') || document.getElementById('search');
            if (!input) return -1;
            input.focus();
            input.value = {json.dumps(query)};
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
            const visible = Array.from(document.querySelectorAll('#list .item')).filter(el => el.style.display !== 'none');
            return visible.length;
        }})()
        """) or 0

    @staticmethod
    def clear_search_workbench(cdp_opt) -> int:
        """清空 Options 工作台搜索框，返回恢复后的列表总数"""
        return cdp_opt.eval("""
        (() => {
            const input = document.getElementById('chatSearchInput') || document.getElementById('search');
            if (!input) return -1;
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            const visible = Array.from(document.querySelectorAll('#list .item')).filter(el => el.style.display !== 'none');
            return visible.length;
        })()
        """) or 0

    @staticmethod
    def select_workbench_item(cdp_opt, chat_id: str, checked: bool = True) -> bool:
        """精准操作指定 chatId 卡片的复选框勾选状态"""
        return bool(cdp_opt.eval(f"""
        (() => {{
            const item = document.querySelector('#list .item[data-chat-id="{chat_id}"], #list .item[data-chat-id="c_{chat_id}"]');
            if (!item) return false;
            const cb = item.querySelector('input[type=checkbox]');
            if (!cb) return false;
            if (cb.checked !== {str(checked).lower()}) {{
                cb.checked = {str(checked).lower()};
                cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            return true;
        }})()
        """))

    @staticmethod
    def toggle_select_all(cdp_opt) -> int:
        """点击全选按钮，返回勾选后的复选框总数"""
        return cdp_opt.eval("""
        (() => {
            const btn = document.getElementById('btnSelectAll');
            if (btn) btn.click();
            return document.querySelectorAll('#list input[type=checkbox]:checked').length;
        })()
        """) or 0

    @staticmethod
    def toggle_select_none(cdp_opt) -> int:
        """点击取消全选按钮，返回勾选后的复选框总数"""
        return cdp_opt.eval("""
        (() => {
            const btn = document.getElementById('btnSelectNone');
            if (btn) btn.click();
            return document.querySelectorAll('#list input[type=checkbox]:checked').length;
        })()
        """) or 0

    @staticmethod
    def switch_workbench_language(cdp_opt, lang: str = "en") -> str:
        """切换 Options 工作台语言 (en / zh)，等待异步本地化就绪并返回全选按钮文案"""
        btn_id = 'labelLangEn' if lang == 'en' else 'labelLangZh'
        expected_part = 'all' if lang == 'en' else '全选'
        return cdp_opt.eval(f"""
        (async () => {{
            const label = document.getElementById('{btn_id}');
            if (label) label.click();
            for (let i = 0; i < 20; i++) {{
                const btnAll = document.getElementById('btnSelectAll');
                const txt = btnAll ? btnAll.textContent.trim() : '';
                if (txt.toLowerCase().includes('{expected_part}')) {{
                    return txt;
                }}
                await new Promise(r => setTimeout(r, 100));
            }}
            const btnAll = document.getElementById('btnSelectAll');
            return btnAll ? btnAll.textContent.trim() : '';
        }})()
        """, await_promise=True) or ''

    @staticmethod
    def import_takeout_zip(cdp_opt, zip_path: str) -> Dict[str, Any]:
        """向工作台导入预置 Takeout ZIP 样本"""
        if not os.path.isfile(zip_path):
            return {"success": False, "error": f"File not found: {zip_path}"}

        with open(zip_path, "rb") as tf:
            zip_b64 = base64.b64encode(tf.read()).decode("ascii")

        return cdp_opt.eval(f"""
        (async () => {{
            try {{
                const b64 = {json.dumps(zip_b64)};
                const bin = atob(b64);
                const arr = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                const file = new File([arr], "{os.path.basename(zip_path)}", {{ type: "application/zip" }});
                
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
        """, await_promise=True) or {}

    @staticmethod
    def trigger_deep_scan(cdp_opt, max_wait: int = 90) -> bool:
        """触发【全量拉取历史】(btnDeepScan) 并等待分页同步完成"""
        cdp_opt.eval("""
        (() => {
            const btn = document.getElementById('btnDeepScan');
            if (btn) btn.click();
        })()
        """)
        start = time.time()
        while time.time() - start < max_wait:
            time.sleep(1.0)
            state = cdp_opt.eval("""
            (() => {
                const sc = typeof SyncCtrl !== 'undefined' ? SyncCtrl : (typeof SyncController !== 'undefined' ? SyncController : null);
                const isScan = sc && (sc.isScanning ? sc.isScanning() : (sc.isRunning ? sc.isRunning() : false));
                const btn = document.getElementById('btnExport');
                return { isScan: isScan || (btn && btn.disabled) };
            })()
            """)
            if not state or not state.get("isScan"):
                return True
        return False

    @staticmethod
    def trigger_export_zip(cdp_opt, output_dir: str, max_wait: int = 60) -> Optional[str]:
        """确保启用 includeZip 并点击导出，监控下载并返回落盘的 ZIP 路径"""
        cdp_opt.eval("""
        (() => {
            const skipCb = document.getElementById('skipExported');
            if (skipCb && skipCb.checked) {
                skipCb.checked = false;
                skipCb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const zipCb = document.getElementById('includeZip');
            if (zipCb && !zipCb.checked) {
                zipCb.checked = true;
                zipCb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const btn = document.getElementById('btnExport');
            if (btn && !btn.disabled) btn.click();
        })()
        """)
        start_time = time.time()
        downloaded_zip = None

        while time.time() - start_time < max_wait:
            time.sleep(1.5)
            if os.path.isdir(output_dir):
                for f in os.listdir(output_dir):
                    if re.match(r"(?i)gemini_export_.*\.zip$", f):
                        fp = os.path.join(output_dir, f)
                        if os.path.getmtime(fp) >= start_time - 3:
                            downloaded_zip = fp
                            break
            if downloaded_zip:
                break

            sys_dl = os.path.expanduser("~/Downloads")
            if os.path.isdir(sys_dl):
                for f in os.listdir(sys_dl):
                    if re.match(r"(?i)gemini_export_.*\.zip$", f):
                        fp = os.path.join(sys_dl, f)
                        if os.path.getmtime(fp) >= start_time - 3:
                            downloaded_zip = fp
                            break
            if downloaded_zip:
                break

        if downloaded_zip and os.path.expanduser("~/Downloads") in downloaded_zip:
            dest_zip = os.path.join(output_dir, os.path.basename(downloaded_zip))
            if os.path.abspath(downloaded_zip) != os.path.abspath(dest_zip):
                import shutil
                shutil.copy2(downloaded_zip, dest_zip)
                downloaded_zip = dest_zip

        return downloaded_zip
