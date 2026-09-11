#!/usr/bin/env python3
"""
scripts/cleanup_orphan_test_chats.py
------------------------------------
一键清理 Gemini 网页端侧边栏中历史残留的测试孤儿会话。
根据测试题材特征（赛博枯山水、发帖按钮测试、新对话测试等）进行匹配，
通过 CDP 原生触发三点菜单 -> 删除 -> 确认物理清除，恢复纯净状态。
"""

import sys
import os
import time
import json

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.cdp_client import CDPConnection, get_tabs, is_gemini_url

TEST_TITLE_KEYWORDS = [
    "赛博",
    "cyberpunk",
    "zen garden",
    "枯山水",
    "发帖按钮与交互实现",
    "新对话状态测试",
    "瞬态会话",
    "测试发帖"
]


def cleanup_orphan_chats(port=9222):
    tabs = get_tabs(port)
    gemini_tab = next((t for t in tabs if is_gemini_url(t.get("url", ""))), None)
    if not gemini_tab:
        print("❌ 未在 127.0.0.1:9222 中找到 gemini.google.com 页面！")
        return 0

    cdp = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
    try:
        try:
            cdp.call("Page.bringToFront")
        except Exception:
            pass

        print("🔍 正在扫描 Gemini 侧边栏中的测试残留会话...")
        deleted_count = 0

        while True:
            # 获取当前侧边栏中匹配的孤儿测试会话
            candidates = cdp.eval(f"""
            (() => {{
                const keywords = {json.dumps(TEST_TITLE_KEYWORDS)};
                const items = Array.from(document.querySelectorAll('gem-nav-list-item[data-test-id="conversation"]'));
                const matched = [];
                for (const item of items) {{
                    const a = item.querySelector('a[href*="/app/"]');
                    if (!a) continue;
                    const href = a.getAttribute('href') || '';
                    const m = href.match(/\\/app\\/([a-f0-9]+)/);
                    const cid = m ? m[1] : null;
                    const text = (a.textContent || '').trim().toLowerCase();
                    const isTest = keywords.some(kw => text.includes(kw.toLowerCase()));
                    if (isTest && cid) {{
                        matched.push({{ id: cid, title: (a.textContent || '').trim().replace(/\\s+/g, ' ') }});
                    }}
                }}
                return matched;
            }})()
            """) or []

            if not candidates:
                break

            target = candidates[0]
            cid = target["id"]
            title = target["title"]
            print(f"   🗑️ 正在删除孤儿会话: [{cid}] '{title}'...")

            # 1. 触发鼠标悬停以唤出更多选项三点按钮
            rect = cdp.eval(f"""
            (() => {{
                const a = document.querySelector('gem-nav-list-item a[href*="{cid}"]') || document.querySelector('nav a[href*="{cid}"]');
                if (!a) return null;
                const item = a.closest('gem-nav-list-item') || a.parentElement;
                item.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
                item.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
                const r = item.getBoundingClientRect();
                return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
            }})()
            """)

            if rect:
                cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": rect["x"], "y": rect["y"]})
                time.sleep(0.3)

            # 点击三点菜单
            opened = cdp.eval(f"""
            (() => {{
                const a = document.querySelector('gem-nav-list-item a[href*="{cid}"]') || document.querySelector('nav a[href*="{cid}"]');
                if (!a) return false;
                const item = a.closest('gem-nav-list-item') || a.parentElement;
                let btn = item.querySelector('button[aria-label*="More options"], button[aria-label*="更多选项"]');
                if (!btn) {{
                    const allBtns = Array.from(item.querySelectorAll('button'));
                    btn = allBtns.find(b => {{
                        const l = (b.getAttribute('aria-label') || '').toLowerCase();
                        return l.includes('more') || l.includes('option') || l.includes('更多');
                    }});
                }}
                if (btn) {{
                    btn.click();
                    return true;
                }}
                return false;
            }})()
            """)

            if not opened:
                print(f"      ⚠️ 未能定位三点菜单按钮，跳过 [{cid}]")
                break

            time.sleep(0.6)

            # 2. 点击菜单中的“删除”
            clicked_del = cdp.eval("""
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

            if not clicked_del:
                cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                print(f"      ⚠️ 未能点击菜单中的删除项，跳过 [{cid}]")
                break

            time.sleep(0.8)

            # 3. 确认弹窗删除
            confirmed = cdp.eval("""
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

            if confirmed:
                deleted_count += 1
                print(f"      ✓ 已成功物理删除 [{cid}]")
            else:
                cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 27, "key": "Escape", "code": "Escape"})
                print(f"      ⚠️ 未能点击确认删除弹窗，跳过 [{cid}]")

            time.sleep(1.5)

        print(f"\n✨ 清理完毕！共物理删除 {deleted_count} 个测试孤儿会话。")
        return deleted_count
    finally:
        cdp.close()


if __name__ == "__main__":
    cleanup_orphan_chats()
