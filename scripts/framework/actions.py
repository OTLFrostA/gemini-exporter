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

from scripts.framework.pipeline import (
    SerialActionExecutor,
    AssertIdleAction,
    StagePromptAction,
    SingleClickSendAction,
    AwaitStreamSettledAction,
    HumanCooldownAction
)

_SHARED_PIPELINE_EXECUTOR = SerialActionExecutor()


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
        """全自动验证 options.html 新手向导交互流程与状态持久化"""
        print("   🧭 正在定位 options.html 标签页...")
        start_time = time.time()
        options_tab = None
        base_options_part = f"chrome-extension://{ext_id}/src/ui/options/options.html"

        while time.time() - start_time < timeout:
            tabs = get_tabs(port)
            options_tab = next((t for t in tabs if base_options_part in t.get("url", "")), None)
            if options_tab:
                break
            time.sleep(0.5)

        if not options_tab:
            new_url = f"http://127.0.0.1:{port}/json/new?{base_options_part}"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                options_tab = json.loads(r.read().decode("utf-8"))

        cdp = CDPConnection(options_tab["webSocketDebuggerUrl"])
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
        """从当前页面 URL、网络流式状态、扩展 Hook 属性或侧边栏提取正在进行的对话 ID"""
        raw_id = cdp.eval("""
        (() => {
            // 1. 从 URL pathname 提取
            const path = window.location.pathname || "";
            const parts = path.split("/app/");
            if (parts.length > 1) {
                const cid = parts[1].split("?")[0].trim();
                if (cid && cid.length >= 8) return cid;
            }
            // 2. 从 DOM 显式属性提取
            const el = document.querySelector('[data-conversation-id], [data-chat-id]');
            if (el) {
                const attrId = el.getAttribute('data-conversation-id') || el.getAttribute('data-chat-id');
                if (attrId && attrId.length >= 8) return attrId.trim();
            }
            // 3. 从扩展流式网络监听器捕获的会话 ID 提取
            if (window.__testStreamState && window.__testStreamState.convId && window.__testStreamState.convId.length >= 8) {
                return window.__testStreamState.convId;
            }
            if (window.__geminiActiveStreamConvId && window.__geminiActiveStreamConvId.length >= 8) {
                return window.__geminiActiveStreamConvId;
            }
            // 4. 若页面上已存在对话气泡，则侧边栏首项即为当次会话
            const hasBubbles = document.querySelectorAll('user-query, model-response').length > 0;
            if (hasBubbles) {
                const activeA = document.querySelector('gem-nav-list-item.selected a, a.is-active[href*="/app/"], [aria-current="page"][href*="/app/"]');
                if (activeA) {
                    const ap = (activeA.getAttribute('href') || '').split('/app/');
                    if (ap.length > 1 && ap[1].length >= 8) return ap[1].split('?')[0].trim();
                }
                const firstA = document.querySelector('gem-nav-list-item a[href^="/app/"], nav a[href^="/app/"], a[href^="/app/"]');
                if (firstA) {
                    const fp = (firstA.getAttribute('href') || '').split('/app/');
                    if (fp.length > 1 && fp[1].length >= 8) return fp[1].split('?')[0].trim();
                }
            }
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
        """向 Gemini 聚焦输入框、粘贴 Prompt、单次物理点击并以单飞串行流水线权威等待流式生成落地"""
        if isinstance(turn_input, dict):
            prompt_text = turn_input.get("prompt", "")
        else:
            prompt_text = str(turn_input)

        is_image_gen = any(kw in prompt_text for kw in ["生成图片", "生成一张图片", "画一张", "generate an image", "create an image"])
        if is_image_gen:
            max_wait = max(max_wait, 240)

        # 0. 模式硬门禁：强制确保为 3.8 Flash + Extended thinking (不存在则抛致命异常中止测试)
        CDPActions.ensure_model_and_thinking(cdp, target_model="3.8 Flash", target_thinking=True, force_menu_check=False)

        # 1. 安装流式网络监听器并重置轮次状态
        turn_start_time = time.time()
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

        # 2. 组装并调度原子流水线 (绝对串行单飞，杜绝并发发帖与疯狂重试)
        pipeline = [
            AssertIdleAction(max_wait=45),
            StagePromptAction(prompt_text),
            SingleClickSendAction(),
            AwaitStreamSettledAction(timeout=max_wait, require_image=is_image_gen, turn_start_time=turn_start_time)
        ]

        result = _SHARED_PIPELINE_EXECUTOR.run_pipeline(None, cdp, pipeline)
        if result.success:
            return True, f"流式生成权威落地 (单飞执行器完成, 耗时 {result.duration:.1f}s)"
        return False, f"发帖流水线熔断: {result.error}"

    @staticmethod
    def click_new_chat(cdp) -> bool:
        """开启新对话 (优先通过 CDP 原生 Page.navigate 导航至 /app，保障物理清空残留气泡)"""
        try:
            cdp.call("Page.navigate", {"url": "https://gemini.google.com/app"})
            time.sleep(2.0)
            return True
        except Exception:
            pass
        res = cdp.eval("""
        (() => {
            const newBtn = document.querySelector('a.side-nav-sparkle-button, a[href="/app"], [aria-label*="New chat"], [aria-label*="新会话"], [data-test-id="new-chat-button"]');
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
    def search_workbench(cdp_opt, query: str, timeout: float = 3.0) -> int:
        """在 Options 工作台搜索框输入检索内容并等待过滤生效，返回过滤后可见条目数"""
        cdp_opt.eval(f"""
        (() => {{
            const input = document.getElementById('chatSearchInput') || document.getElementById('search');
            if (!input) return -1;
            input.focus();
            input.value = {json.dumps(query)};
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
        }})()
        """)
        # 轮询等待列表过滤生效（optionsInit 包含 100ms 防抖及重绘周期）
        start = time.time()
        total_items = cdp_opt.eval("""
        (() => {
            const s = window.ConversationsStore || (typeof ConversationsStore !== 'undefined' ? ConversationsStore : null);
            return s ? s.getConversations().length : document.querySelectorAll('#list .item').length;
        })()
        """) or 0

        while time.time() - start < timeout:
            visible_count = cdp_opt.eval("document.querySelectorAll('#list .item').length") or 0
            if total_items > 1:
                if query and visible_count < total_items:
                    return visible_count
                elif not query and visible_count >= total_items:
                    return visible_count
            else:
                return visible_count
            time.sleep(0.05)

        return cdp_opt.eval("document.querySelectorAll('#list .item').length") or 0

    @staticmethod
    def clear_search_workbench(cdp_opt, timeout: float = 3.0) -> int:
        """清空 Options 工作台搜索框并等待完整列表恢复，返回恢复后的列表总数"""
        cdp_opt.eval("""
        (() => {
            const input = document.getElementById('chatSearchInput') || document.getElementById('search');
            if (!input) return -1;
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        })()
        """)
        # 轮询等待搜索防抖及全量列表恢复
        start = time.time()
        target_total = cdp_opt.eval("""
        (() => {
            const s = window.ConversationsStore || (typeof ConversationsStore !== 'undefined' ? ConversationsStore : null);
            return s ? s.getConversations().length : 0;
        })()
        """) or 0

        while time.time() - start < timeout:
            visible_count = cdp_opt.eval("document.querySelectorAll('#list .item').length") or 0
            if target_total > 0 and visible_count >= target_total:
                return visible_count
            time.sleep(0.05)

        return cdp_opt.eval("document.querySelectorAll('#list .item').length") or 0

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
