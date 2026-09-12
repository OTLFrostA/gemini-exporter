#!/usr/bin/env python3
"""
scripts/visual_agent/cdp_operator.py
------------------------------------
A clean, purely physical peripheral operator for Visual AI Agents.
- Zero DOM manipulation / zero cheating
- NO device emulation letterboxing (clears device metrics override)
- NO active tab spawning (prevents focus stealing)
"""

import sys
import os
import time
import json
import base64
import argparse
import urllib.request
import re
import shutil
import zipfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))
from scripts.cdp_client import CDPConnection, get_tabs, ensure_extension_loaded, get_extension_id, get_browser_ws_url, CDP_DEFAULT_PORT, is_gemini_url


def get_options_connection(port=CDP_DEFAULT_PORT, repo_path=None):
    repo_path = os.path.abspath(repo_path or os.path.join(os.path.dirname(__file__), "../.."))
    eid = get_extension_id(port)
    if not eid:
        eid = ensure_extension_loaded(port, repo_path=repo_path)
    if not eid:
        raise RuntimeError("Extension ID not found on Chrome.")

    options_url = f"chrome-extension://{eid}/src/ui/options/options.html"
    tabs = get_tabs(port)
    tab = next((t for t in tabs if t.get("type") == "page" and options_url in t.get("url", "")), None)

    if not tab:
        # 避免使用 json/new 抢占 macOS 窗口焦点，尝试在空白标签或非 Gemini 页面导航
        non_gemini = next((t for t in tabs if t.get("type") == "page" and not is_gemini_url(t.get("url", "")) and "tally.so" not in t.get("url", "")), None)
        if non_gemini:
            cdp = CDPConnection(non_gemini["webSocketDebuggerUrl"])
            cdp.call("Page.navigate", {"url": f"{options_url}?welcome=1"})
            cdp.close()
            time.sleep(1.0)
            tab = non_gemini
        else:
            new_url = f"http://127.0.0.1:{port}/json/new?{options_url}?welcome=1"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                tab = json.loads(r.read().decode("utf-8"))
            time.sleep(1.0)

    cdp = CDPConnection(tab["webSocketDebuggerUrl"])
    # 彻底清除 DeviceMetricsOverride，杜绝黑边与分辨率缩放畸变
    try:
        cdp.call("Emulation.clearDeviceMetricsOverride")
    except Exception:
        pass

    return cdp, tab, eid


def cmd_reinstall_and_open(port=CDP_DEFAULT_PORT, repo_path=None):
    repo_path = os.path.abspath(repo_path or os.path.join(os.path.dirname(__file__), "../.."))
    browser_ws = get_browser_ws_url(port)
    if browser_ws:
        b_cdp = CDPConnection(browser_ws)
        eid = ensure_extension_loaded(port, repo_path=repo_path)
        if eid:
            try:
                b_cdp.call("Extensions.uninstall", {"id": eid})
                time.sleep(1.0)
            except Exception:
                pass
        res = b_cdp.call("Extensions.loadUnpacked", {"path": repo_path})
        new_eid = res.get("result", {}).get("id")
        b_cdp.close()
    else:
        new_eid = ensure_extension_loaded(port, repo_path=repo_path)

    welcome_url = f"chrome-extension://{new_eid}/src/ui/options/options.html?welcome=1"

    # 等待 onInstalled 自然创建 options 页面，或就地导航已有页面，绝不新建激活 tab
    time.sleep(1.5)
    tabs = get_tabs(port)
    opt_tab = next((t for t in tabs if t.get("type") == "page" and f"chrome-extension://{new_eid}" in t.get("url", "") and "options.html" in t.get("url", "")), None)

    if not opt_tab:
        # 寻找可复用的非 Gemini 标签页静默导航
        reuse_tab = next((t for t in tabs if t.get("type") == "page" and not is_gemini_url(t.get("url", ""))), None)
        if reuse_tab:
            cdp = CDPConnection(reuse_tab["webSocketDebuggerUrl"])
            cdp.call("Page.navigate", {"url": welcome_url})
            cdp.close()
            opt_tab = reuse_tab
        else:
            new_url = f"http://127.0.0.1:{port}/json/new?{welcome_url}"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                opt_tab = json.loads(r.read().decode("utf-8"))

    # 清除一切黑边与缩放
    cdp = CDPConnection(opt_tab["webSocketDebuggerUrl"])
    try:
        cdp.call("Emulation.clearDeviceMetricsOverride")
    except Exception:
        pass
    bounds = cdp.eval("({ width: window.innerWidth, height: window.innerHeight })") or {"width": 1280, "height": 800}
    cdp.close()

    print(json.dumps({
        "status": "ready",
        "extension_id": new_eid,
        "viewport": [bounds.get("width", 1280), bounds.get("height", 800)],
        "url": welcome_url
    }))


def cmd_screenshot(name="screen", output_dir=None, port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    output_dir = output_dir or os.path.join(repo_path, "tests", "output", "visual_audit")
    os.makedirs(output_dir, exist_ok=True)

    cdp, tab, _ = get_options_connection(port=port, repo_path=repo_path)
    bounds = cdp.eval("({ width: window.innerWidth, height: window.innerHeight })") or {"width": 1280, "height": 800}
    res = cdp.call("Page.captureScreenshot", {"format": "png"})
    cdp.close()

    b64_data = res.get("result", {}).get("data", "")
    filename = f"{name}.png" if not name.endswith(".png") else name
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "wb") as f:
        f.write(base64.b64decode(b64_data))

    print(json.dumps({
        "status": "captured",
        "name": name,
        "filepath": filepath,
        "size_bytes": os.path.getsize(filepath),
        "viewport": [bounds.get("width", 1280), bounds.get("height", 800)]
    }))


def cmd_click(x: float, y: float, port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    cdp, tab, _ = get_options_connection(port=port, repo_path=repo_path)
    bounds = cdp.eval("({ width: window.innerWidth, height: window.innerHeight })") or {"width": 1280, "height": 800}
    w, h = bounds.get("width", 1280), bounds.get("height", 800)

    px_x = int(x * w) if x <= 1.0 else int(x)
    px_y = int(y * h) if y <= 1.0 else int(y)

    cdp.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": px_x, "y": px_y})
    time.sleep(0.06)
    cdp.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": px_x, "y": px_y, "button": "left", "clickCount": 1})
    time.sleep(0.06)
    cdp.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": px_x, "y": px_y, "button": "left", "clickCount": 1})
    time.sleep(0.4)
    cdp.close()

    print(json.dumps({
        "status": "clicked",
        "coordinates": {"x": px_x, "y": px_y},
        "viewport": [w, h]
    }))


def cmd_type(text: str, port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    cdp, tab, _ = get_options_connection(port=port, repo_path=repo_path)
    for ch in text:
        cdp.call("Input.dispatchKeyEvent", {"type": "char", "text": ch})
        time.sleep(0.03)
    cdp.close()
    print(json.dumps({"status": "typed", "text": text}))


def cmd_scroll(delta_y: int, x: float = 800, y: float = 400, port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    cdp, tab, _ = get_options_connection(port=port, repo_path=repo_path)
    bounds = cdp.eval("({ width: window.innerWidth, height: window.innerHeight })") or {"width": 1280, "height": 800}
    w, h = bounds.get("width", 1280), bounds.get("height", 800)
    px_x = int(x * w) if x <= 1.0 else int(x)
    px_y = int(y * h) if y <= 1.0 else int(y)
    cdp.call("Input.dispatchMouseEvent", {
        "type": "mouseWheel",
        "x": px_x,
        "y": px_y,
        "deltaX": 0,
        "deltaY": int(delta_y)
    })
    time.sleep(0.4)
    cdp.close()
    print(json.dumps({"status": "scrolled", "deltaY": delta_y, "at": [px_x, px_y]}))


def cmd_clear_input(port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    cdp, tab, _ = get_options_connection(port=port, repo_path=repo_path)
    # Cmd+A / Ctrl+A then Backspace
    modifier = 4  # Command key on macOS
    cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 65, "key": "a", "code": "KeyA", "modifiers": modifier})
    cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 65, "key": "a", "code": "KeyA", "modifiers": modifier})
    time.sleep(0.05)
    cdp.call("Input.dispatchKeyEvent", {"type": "rawKeyDown", "windowsVirtualKeyCode": 8, "key": "Backspace", "code": "Backspace"})
    cdp.call("Input.dispatchKeyEvent", {"type": "keyUp", "windowsVirtualKeyCode": 8, "key": "Backspace", "code": "Backspace"})
    time.sleep(0.2)
    cdp.close()
    print(json.dumps({"status": "cleared"}))


def cmd_import_takeout(zip_path=None, port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    zip_path = os.path.abspath(zip_path or os.path.join(repo_path, "tests", "fixtures", "gemini_takeout_clean.zip"))
    if not os.path.isfile(zip_path):
        print(json.dumps({"status": "failed", "error": f"Fixture not found: {zip_path}"}))
        return False

    cdp, tab, _ = get_options_connection(port=port, repo_path=repo_path)
    with open(zip_path, "rb") as tf:
        zip_b64 = base64.b64encode(tf.read()).decode("ascii")

    res = cdp.eval(f"""
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
    """, await_promise=True)
    time.sleep(1.0)
    cdp.close()
    print(json.dumps({"status": "takeout_imported", "file": os.path.basename(zip_path), "result": res}))
    return True


def get_gemini_connection(port=CDP_DEFAULT_PORT):
    tabs = get_tabs(port)
    tab = next((t for t in tabs if is_gemini_url(t.get("url", ""))), None)
    if not tab:
        raise RuntimeError(f"No active Gemini tab found on Chrome (port {port}).")
    return CDPConnection(tab["webSocketDebuggerUrl"]), tab


def cmd_live_chat(prompt: str, port=CDP_DEFAULT_PORT):
    from scripts.framework.actions import CDPActions
    cdp, tab = get_gemini_connection(port=port)
    try:
        chat_title = CDPActions.get_current_chat_title(cdp)
        print(f"Sending live chat turn on Gemini tab (current: {chat_title})...", file=sys.stderr)
        turn_res = CDPActions.send_gemini_turn(cdp, {"user": prompt}, max_wait=180)
        time.sleep(1.5)
        print(json.dumps({"status": "sent", "chat_title": chat_title, "turn": turn_res}))
    finally:
        cdp.close()


def cmd_live_delete(port=CDP_DEFAULT_PORT):
    from scripts.framework.actions import CDPActions
    cdp, tab = get_gemini_connection(port=port)
    try:
        chat_id = CDPActions.get_current_chat_title(cdp) or "current"
        success = CDPActions.delete_conversation_via_web(cdp, chat_id)
        time.sleep(1.5)
        print(json.dumps({"status": "deleted" if success else "delete_failed", "chat_id": chat_id}))
    finally:
        cdp.close()


def cmd_assert_export(output_dir=None, min_conversations=4, port=CDP_DEFAULT_PORT):
    repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    output_dir = output_dir or os.path.join(repo_path, "tests", "output", "visual_audit")
    sys_downloads = os.path.expanduser("~/Downloads")
    
    downloaded_zip = None
    start_time = time.time()
    for _ in range(45):
        for d in [output_dir, sys_downloads]:
            if os.path.isdir(d):
                for f in os.listdir(d):
                    if re.match(r"(?i)gemini_export_.*\.zip$", f):
                        fp = os.path.join(d, f)
                        if os.path.getmtime(fp) >= start_time - 60:
                            dest = os.path.join(output_dir, f)
                            if os.path.abspath(fp) != os.path.abspath(dest):
                                shutil.copy2(fp, dest)
                                downloaded_zip = dest
                            else:
                                downloaded_zip = fp
                            break
            if downloaded_zip:
                break
        if downloaded_zip:
            break
        time.sleep(1.0)

    if not downloaded_zip:
        print(json.dumps({"status": "failed", "error": "No export ZIP found within timeout"}))
        return False

    extract_dir = os.path.join(output_dir, "extracted_export")
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir, ignore_errors=True)
    os.makedirs(extract_dir, exist_ok=True)

    with zipfile.ZipFile(downloaded_zip, "r") as zf:
        zf.extractall(extract_dir)

    from tests.helpers.export_spec_asserter import ExportSpecificationAsserter
    asserter = ExportSpecificationAsserter(extract_dir)
    from scripts.test_visual_agent import DESIGNATED_HISTORICAL_CHATS
    spec_ok = asserter.run_all_assertions(min_conversations=min_conversations, expected_golden_chats=DESIGNATED_HISTORICAL_CHATS)

    print(json.dumps({
        "status": "passed" if spec_ok else "failed",
        "zip": downloaded_zip,
        "extract_dir": extract_dir,
        "spec_ok": spec_ok
    }))
    return spec_ok


def main():
    parser = argparse.ArgumentParser(description="CDP Physical Operator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("reinstall", help="Reinstall extension and open clean welcome page")

    snap_parser = subparsers.add_parser("screenshot", help="Capture current viewport screenshot")
    snap_parser.add_argument("name", nargs="?", default="screen", help="Screenshot filename name")

    click_parser = subparsers.add_parser("click", help="Dispatch physical mouse click to (x, y)")
    click_parser.add_argument("x", type=float, help="X coordinate (pixels or normalized 0.0-1.0)")
    click_parser.add_argument("y", type=float, help="Y coordinate (pixels or normalized 0.0-1.0)")

    type_parser = subparsers.add_parser("type", help="Dispatch keyboard typing")
    type_parser.add_argument("text", help="Text to type")

    subparsers.add_parser("clear_input", help="Select all and clear active input")

    scroll_parser = subparsers.add_parser("scroll", help="Dispatch mouse wheel scrolling")
    scroll_parser.add_argument("delta_y", type=int, help="Scroll vertical delta (e.g. 300 for down, -300 for up)")
    scroll_parser.add_argument("--x", type=float, default=800, help="X coordinate for scroll center")
    scroll_parser.add_argument("--y", type=float, default=400, help="Y coordinate for scroll center")

    takeout_parser = subparsers.add_parser("import_takeout", help="Import Google Takeout ZIP fixture")
    takeout_parser.add_argument("zip_path", nargs="?", default=None, help="Path to Takeout ZIP fixture")

    live_chat_parser = subparsers.add_parser("live_chat", help="Send live turn on background Gemini tab")
    live_chat_parser.add_argument("prompt", help="Prompt text to send")

    subparsers.add_parser("live_delete", help="Delete active conversation on background Gemini tab")

    export_parser = subparsers.add_parser("assert_export", help="Wait for exported ZIP, extract, and assert golden specs")
    export_parser.add_argument("--output-dir", default=None, help="Output directory")
    export_parser.add_argument("--min-convs", type=int, default=4, help="Minimum conversations expected")

    args = parser.parse_args()

    if args.command == "reinstall":
        cmd_reinstall_and_open()
    elif args.command == "screenshot":
        cmd_screenshot(name=args.name)
    elif args.command == "click":
        cmd_click(args.x, args.y)
    elif args.command == "type":
        cmd_type(args.text)
    elif args.command == "clear_input":
        cmd_clear_input()
    elif args.command == "scroll":
        cmd_scroll(args.delta_y, x=args.x, y=args.y)
    elif args.command == "import_takeout":
        cmd_import_takeout(args.zip_path)
    elif args.command == "live_chat":
        cmd_live_chat(args.prompt)
    elif args.command == "live_delete":
        cmd_live_delete()
    elif args.command == "assert_export":
        cmd_assert_export(args.output_dir, min_conversations=args.min_convs)


if __name__ == "__main__":
    main()
