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
    def ensure_model_and_thinking(cdp, target_model: str = "3.8 Flash", target_thinking: bool = True, force_menu_check: bool = False) -> bool:
        """
        严格校验并锁定 Gemini 模型与思考模式。
        如果 target_model="3.8 Flash"，严格检查菜单中是否存在 3.8 Flash 选项。
        如果 target_thinking=True，严格检查菜单中是否存在 Extended thinking (深度思考) 选项。
        若任一能力在当前账号/界面中不存在，立即主动抛出致命异常中断测试，绝不隐式降级或盲跑。
        """
        try:
            cdp.call("Page.bringToFront")
        except Exception:
            pass

        for pass_idx in range(3):
            status = cdp.eval("""
            (() => {
                const btn = document.querySelector('[data-test-id="bard-mode-menu-button"], button.input-area-switch');
                if (!btn) return null;
                const text = (btn.textContent || '').trim();
                const label = (btn.getAttribute('aria-label') || '').trim();
                return { text, label, disabled: !!btn.disabled };
            })()
            """)
            if not status:
                time.sleep(0.5)
                continue

            full_desc = f"{status.get('label', '')} {status.get('text', '')}".lower()
            is_lite = "flash-lite" in full_desc or "lite" in full_desc
            has_model = ("flash" in full_desc and not is_lite) if "flash" in target_model.lower() else (target_model.lower() in full_desc)
            has_thinking = ("extended" in full_desc or "thinking" in full_desc) if target_thinking else True

            # 如果不强制打开菜单，且当前按钮已显示目标模式，则直接通过
            if has_model and has_thinking and not force_menu_check:
                return True

            # 点击展开模式选择菜单以进行物理菜单项门禁校验与切换
            opened = cdp.eval("""
            (() => {
                const btn = document.querySelector('[data-test-id="bard-mode-menu-button"], button.input-area-switch');
                if (btn && !btn.disabled) {
                    btn.click();
                    return true;
                }
                return false;
            })()
            """)
            if not opened:
                time.sleep(0.5)
                continue

            time.sleep(0.5)

            # 抓取菜单项并执行硬门禁断言
            menu_info = cdp.eval("""
            (() => {
                const menu = document.querySelector('gem-menu[data-test-id="gem-mode-menu"], [role="menu"]');
                if (!menu) return null;
                const items = Array.from(menu.querySelectorAll('gem-menu-item, [role="menuitem"], [role="menuitemcheckbox"]'));
                return items.map(el => ({
                    text: (el.textContent || '').trim().replace(/\\s+/g, ' '),
                    isSelected: el.classList.contains('selected') || el.getAttribute('aria-checked') === 'true'
                }));
            })()
            """)

            if not menu_info:
                cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                raise RuntimeError("❌【测试安全门禁拦截】无法打开 Gemini 模型切换菜单，测试已主动终止！")

            # 检查目标选项是否存在 (Fail-Fast 门禁)
            if "3.8" in target_model.lower() and "flash" in target_model.lower():
                has_target_model_opt = any(
                    ("3.8" in it["text"].lower() and "flash" in it["text"].lower() and "lite" not in it["text"].lower())
                    for it in menu_info
                )
                target_model_label = "3.8 Flash"
            elif "flash" in target_model.lower():
                has_target_model_opt = any(
                    ("flash" in it["text"].lower() and "lite" not in it["text"].lower())
                    for it in menu_info
                )
                target_model_label = "Flash"
            else:
                has_target_model_opt = any(target_model.lower() in it["text"].lower() for it in menu_info)
                target_model_label = target_model

            has_thinking_opt = any(
                ("extended" in it["text"].lower() and "thinking" in it["text"].lower())
                for it in menu_info
            )

            missing = []
            if not has_target_model_opt:
                missing.append(f"{target_model_label} 模型选项")
            if target_thinking and not has_thinking_opt:
                missing.append("Extended thinking (深度思考) 选项")

            if missing:
                cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                avail = [it["text"] for it in menu_info]
                err_msg = f"❌【测试安全门禁拦截】当前 Gemini 页面中缺失必要能力: {' 和 '.join(missing)}！当前可用菜单项: {avail}。测试已被强制熔断终止，杜绝盲跑或使用非预期模型。"
                print(f"\n🛑 {err_msg}\n")
                raise RuntimeError(err_msg)

            # 检查是否已全部处于选中状态
            is_flash_selected = any(
                ("3.8" in it["text"].lower() and "flash" in it["text"].lower() and "lite" not in it["text"].lower() and it["isSelected"])
                for it in menu_info
            )
            is_thinking_selected = any(
                ("extended" in it["text"].lower() and "thinking" in it["text"].lower() and it["isSelected"])
                for it in menu_info
            )

            if is_flash_selected and is_thinking_selected:
                # 两者均已激活，平稳关闭菜单
                cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                time.sleep(0.3)
                return True

            # 若未选中，点击切换至目标模型与思考模式
            if not is_flash_selected:
                cdp.eval("""
                (() => {
                    const menu = document.querySelector('gem-menu[data-test-id="gem-mode-menu"], [role="menu"]');
                    if (!menu) return;
                    const items = Array.from(menu.querySelectorAll('gem-menu-item, [role="menuitem"], [role="menuitemcheckbox"]'));
                    for (const el of items) {
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t.includes('3.8 flash') || (t.includes('3.8') && t.includes('flash'))) {
                            el.click();
                            return;
                        }
                    }
                })()
                """)
                time.sleep(0.5)

            if not is_thinking_selected:
                # 重新检查菜单是否仍开启，若关闭则重新打开
                still_open = cdp.eval("!!document.querySelector('gem-menu[data-test-id=\"gem-mode-menu\"], [role=\"menu\"]')")
                if not still_open:
                    cdp.eval("""
                    (() => {
                        const btn = document.querySelector('[data-test-id="bard-mode-menu-button"], button.input-area-switch');
                        if (btn) btn.click();
                    })()
                    """)
                    time.sleep(0.5)

                cdp.eval("""
                (() => {
                    const menu = document.querySelector('gem-menu[data-test-id="gem-mode-menu"], [role="menu"]');
                    if (!menu) return;
                    const items = Array.from(menu.querySelectorAll('gem-menu-item, [role="menuitem"], [role="menuitemcheckbox"]'));
                    for (const el of items) {
                        const t = (el.textContent || '').trim().toLowerCase();
                        if (t.includes('extended thinking') || (t.includes('extended') && t.includes('thinking'))) {
                            el.click();
                            return;
                        }
                    }
                })()
                """)
                time.sleep(0.5)

            # 确保关闭浮层
            cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
            cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
            time.sleep(0.4)
            # 完成一次物理校验和切换后，force_menu_check 视为完成
            force_menu_check = False

        final_status = cdp.eval("""
        (() => {
            const btn = document.querySelector('[data-test-id="bard-mode-menu-button"], button.input-area-switch');
            return btn ? ((btn.getAttribute('aria-label') || '') + ' ' + (btn.textContent || '')).toLowerCase() : '';
        })()
        """) or ""
        if "flash" in final_status and ("extended" in final_status or "thinking" in final_status):
            return True

        raise RuntimeError(f"❌【测试安全门禁拦截】无法将模型切换至 3.8 Flash + Extended thinking！当前状态: '{final_status}'。测试已被主动终止。")

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

        # 0. 确保标签页处于前台激活状态
        try:
            cdp.call("Page.bringToFront")
        except Exception:
            pass

        # 0.5. 模式硬门禁：强制确保为 3.8 Flash + Extended thinking (不存在则抛致命异常中止测试)
        CDPActions.ensure_model_and_thinking(cdp, target_model="3.8 Flash", target_thinking=True, force_menu_check=False)

        # 1. 确保 Gemini 处于空闲状态 (严禁在上一次生成未结束时并发发帖)
        is_still_busy = True
        for _ in range(45):
            busy = cdp.eval("""
            (() => {
                const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
                const isStreaming = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"], spark-progress');
                return !!(stopBtn && stopBtn.offsetWidth > 0) || isStreaming;
            })()
            """)
            if not busy:
                is_still_busy = False
                break
            time.sleep(1.0)

        if is_still_busy:
            return False, "Gemini 界面处于忙碌状态（前序流式生成尚未结束），禁止并发注入新提问"

        prev_model_info = cdp.eval("""
        (() => {
            const allModels = Array.from(document.querySelectorAll('message-content.model-response-text, model-response, .model-response-text, structured-content-container.model-response-text'));
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

        # 2. 安装流式网络监听器并重置轮次状态
        turn_start_time = time.time()
        turn_start_ms = int(turn_start_time * 1000)
        cdp.eval("""
        (() => {
            window.__testStreamState = {
                started: false,
                completed: false,
                convId: null,
                startedAt: 0,
                completedAt: 0
            };
            if (!window.__testStreamListenerAttached) {
                window.addEventListener('message', (e) => {
                    if (!e.data || typeof e.data !== 'object') return;
                    if (e.data.type === 'GEMINI_STREAM_GENERATE_START') {
                        window.__testStreamState.started = true;
                        window.__testStreamState.startedAt = Date.now();
                        if (e.data.payload && e.data.payload.id) {
                            window.__testStreamState.convId = e.data.payload.id;
                        }
                    } else if (e.data.type === 'GEMINI_STREAM_GENERATE_COMPLETE') {
                        window.__testStreamState.completed = true;
                        window.__testStreamState.completedAt = Date.now();
                        if (e.data.payload && e.data.payload.id) {
                            window.__testStreamState.convId = e.data.payload.id;
                        }
                    }
                });
                window.__testStreamListenerAttached = true;
            }
        })()
        """)

        # 3. 聚焦输入框并彻底清空 Quill 编辑器模型 (防止文字追加双重叠加)
        cdp.eval("""
        (() => {
          const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
          if (editor) {
            editor.focus();
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(editor);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('delete', false, null);
            if (editor.textContent.trim().length > 0) {
              editor.innerHTML = '<p><br></p>';
              editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
            }
            editor.dispatchEvent(new Event('input', { bubbles: true }));
          }
        })()
        """)
        time.sleep(0.3)

        # 4. 原生插入文本并分发事件
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

        # 5. 点击发送按钮并严格防范 Stop 按钮误触（坚决杜绝二次物理点击与回车注入）
        sent = False
        for attempt in range(12):
            status = cdp.eval(f"""
            (() => {{
              const currUserCount = document.querySelectorAll('.user-query, user-query, [data-test-id="user-query"], message-content.user-message').length;
              const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
              const isStopActive = !!(stopBtn && stopBtn.offsetWidth > 0);
              const streamState = window.__testStreamState || {{}};
              const isNetStreaming = !!window.__geminiIsStreaming || streamState.started;

              // 如果已出现 Stop 按钮，或网络层已触发 STREAM_START，或用户提问节点已增加，即确认发送成功！
              if (currUserCount > {prev_user_count} || isStopActive || isNetStreaming) {{
                return {{ sent: true, userCount: currUserCount, isStop: isStopActive }};
              }}

              // 严格排他性寻找真正的发送按钮（坚决排除 .stop 及含 Stop 语义的按钮）
              const sendBtn = document.querySelector('button[aria-label="Send message"], gem-icon-button.send-button.submit button, button[aria-label*="发送"]');
              let coords = null;
              if (sendBtn && !sendBtn.closest('.stop')) {{
                const label = (sendBtn.getAttribute('aria-label') || '').toLowerCase();
                if (!label.includes('stop') && !label.includes('停止')) {{
                  const r = sendBtn.getBoundingClientRect();
                  if (r.width > 0 && r.height > 0) {{
                    coords = {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
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
                # 单次物理点击
                cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": cx, "y": cy})
                cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": cx, "y": cy, "button": "left", "clickCount": 1})
                cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": cx, "y": cy, "button": "left", "clickCount": 1})

                # 点击后等待，确认流式开始即刻退出循环，绝对不点第二次
                for _ in range(10):
                    time.sleep(0.3)
                    check = cdp.eval(f"""
                    (() => {{
                      const currUserCount = document.querySelectorAll('.user-query, user-query, [data-test-id="user-query"], message-content.user-message').length;
                      const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
                      const isStopActive = !!(stopBtn && stopBtn.offsetWidth > 0);
                      const streamState = window.__testStreamState || {{}};
                      return currUserCount > {prev_user_count} || isStopActive || !!window.__geminiIsStreaming || streamState.started;
                    }})()
                    """)
                    if check:
                        sent = True
                        break
                if sent:
                    break

            time.sleep(0.5)

        if not sent:
            return False, "未能成功派发消息（发送按钮未响应或未进入流式生成）"

        # 6. 等待流式生成完全结束 (以网络拦截为核心，UI 与 DOM 为辅助)
        start_wait = time.time()
        last_seen_len = 0
        stable_count = 0
        while time.time() - start_wait < max_wait:
            time.sleep(0.8)
            elapsed = time.time() - start_wait
            state = cdp.eval(f"""
            (() => {{
              const stopBtn = document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"], .send-button.stop');
              const hasStop = !!(stopBtn && stopBtn.offsetWidth > 0);
              const sendBtn = document.querySelector('button[aria-label*="Send"]:not(.stop), gem-icon-button.send-button:not(.stop)');
              const hasSend = !!(sendBtn && sendBtn.offsetWidth > 0 && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true');
              const editor = document.querySelector('rich-textarea div.ql-editor') || document.querySelector('div[contenteditable="true"]');
              const isEditorReady = !!(editor && (editor.getAttribute('contenteditable') === 'true' || editor.offsetWidth > 0));
              const isStreamingDOM = !!document.querySelector('.streaming-text, .loading-dots, [data-is-streaming="true"], spark-progress');

              const streamState = window.__testStreamState || {{}};
              const lastCompleteTime = window.__geminiLastStreamComplete || 0;
              const netCompleted = !!streamState.completed || (lastCompleteTime >= {turn_start_ms});

              const allModels = Array.from(document.querySelectorAll('message-content.model-response-text, model-response, .model-response-text, structured-content-container.model-response-text'));
              const currCount = allModels.length;
              const lastModel = currCount > 0 ? allModels[currCount - 1] : null;
              const lastLen = lastModel ? (lastModel.textContent || '').trim().length : 0;
              const lastText = lastModel ? (lastModel.textContent || '').trim() : '';
              const hasImages = lastModel ? (lastModel.querySelectorAll('img[src*="blob:"], img[src*="googleusercontent"], .image-container, img').length > 0) : false;
              const retryBtn = document.querySelector('button[aria-label*="Retry"], button[aria-label*="重试"]');
              const toastEl = document.querySelector('toast-content, .toast, .error-message, [role="alert"]');

              return {{
                hasStop,
                hasSend,
                isEditorReady,
                isStreamingDOM,
                netCompleted,
                currCount,
                lastLen,
                lastTextSnippet: lastText.slice(0, 80),
                hasImages,
                hasRetry: !!retryBtn,
                toast: toastEl ? toastEl.textContent.trim() : null
              }};
            }})()
            """)
            if not state:
                continue

            if state.get("hasRetry"):
                cdp.eval("const b = document.querySelector('button[aria-label*=\"Retry\"], button[aria-label*=\"重试\"]'); if (b) b.click();")
                time.sleep(1.5)
                continue

            has_stop = state.get("hasStop", False)
            has_send = state.get("hasSend", False)
            is_editor_ready = state.get("isEditorReady", False)
            is_stream_dom = state.get("isStreamingDOM", False)
            net_completed = state.get("netCompleted", False)
            curr_count = state.get("currCount", 0)
            last_len = state.get("lastLen", 0)
            has_images = state.get("hasImages", False)
            snippet = state.get("lastTextSnippet", "")

            # 校验是否被意外掐死
            if "you stopped this response" in snippet.lower() or "你已停止此回复" in snippet:
                return False, "检测到回复被异常中断 (You stopped this response)"

            # 条件 1：网络层确知 Stream 完成 + Stop 按钮消失 + UI 恢复就绪
            if net_completed and not has_stop and (has_send or is_editor_ready) and not is_stream_dom:
                if is_image_gen:
                    if has_images or elapsed > 30:
                        time.sleep(1.0)
                        return True, f"生图回复完成 (网络拦截确认, 耗时 {elapsed:.1f}s, 检测到图片实体)"
                else:
                    time.sleep(0.5)
                    return True, f"流式回复完成 (网络拦截确认, 耗时 {elapsed:.1f}s, 字符数: {last_len})"

            # 条件 2 (兜底容错)：如果网络 hook 因偶发未捕获，但 Stop 消失且有新回复且文本稳定
            if not has_stop and (has_send or is_editor_ready) and not is_stream_dom and curr_count > prev_resp_count:
                if last_len == last_seen_len and last_len > 10:
                    stable_count += 1
                    if stable_count >= 4:
                        time.sleep(0.5)
                        return True, f"生成完毕 (DOM 稳定兜底确认, 耗时 {elapsed:.1f}s, 字符数: {last_len})"
                else:
                    last_seen_len = last_len
                    stable_count = 0

            # 异常卡死判断
            if elapsed > 30 and not has_stop and not is_stream_dom and curr_count == prev_resp_count and state.get("toast"):
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
        # 触发悬停使三点菜单显示
        rect = cdp_gemini.eval(f"""
        (() => {{
            const a = document.querySelector('gem-nav-list-item a[href*="{chat_id}"]') || document.querySelector('nav a[href*="{chat_id}"]') || document.querySelector('a[href*="{chat_id}"]');
            if (!a) return null;
            const item = a.closest('gem-nav-list-item') || a.parentElement;
            item.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
            item.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
            const r = item.getBoundingClientRect();
            return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
        }})()
        """)
        if rect:
            try:
                cdp_gemini.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": rect["x"], "y": rect["y"]})
            except Exception:
                pass
            time.sleep(0.3)

        click_opts = cdp_gemini.eval(f"""
        (() => {{
            const a = document.querySelector('gem-nav-list-item a[href*="{chat_id}"]') || document.querySelector('nav a[href*="{chat_id}"]') || document.querySelector('a[href*="{chat_id}"]');
            if (!a) return 'link_not_found';
            const item = a.closest('gem-nav-list-item') || a.parentElement;
            let btn = item.querySelector('button[aria-label*="More options"], button[aria-label*="更多选项"]');
            if (!btn) {{
                const allBtns = Array.from(item.querySelectorAll('button'));
                btn = allBtns.find(b => {{
                    const l = (b.getAttribute('aria-label') || '').toLowerCase();
                    return l.includes('more') || l.includes('option') || l.includes('更多');
                }});
            }}
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
