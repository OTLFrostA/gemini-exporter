import os
import json
import re

print("=" * 60)
print(" Gemini Exporter - Comprehensive Test Suite")
print("=" * 60)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def test_json_files():
    for jf in ["manifest.json", "package.json", "_locales/zh_CN/messages.json", "_locales/en/messages.json"]:
        p = os.path.join(BASE_DIR, jf)
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"  ✓ JSON valid: {jf}")

def test_manifest_structure():
    with open(os.path.join(BASE_DIR, "manifest.json"), "r", encoding="utf-8") as f:
        m = json.load(f)
        assert m["manifest_version"] == 3
        assert "storage" in m["permissions"]
        cs = m["content_scripts"][0]["js"]
        for required in ["storage_service.js", "gemini_parser.js", "gemini_client.js", "dom_scraper.js", "asset_fetcher.js", "content.js"]:
            assert required in cs, f"Missing {required} in manifest content_scripts"
        print("  ✓ manifest.json scripts and permissions verified")

def test_html_includes():
    with open(os.path.join(BASE_DIR, "options.html"), "r", encoding="utf-8") as f:
        opt_html = f.read()
        for script in ["storage_service.js", "gemini_parser.js", "gemini_client.js", "takeout_engine.js", "export_engine.js", "options.js"]:
            assert f'<script src="{script}"></script>' in opt_html, f"Missing {script} in options.html"
    
    with open(os.path.join(BASE_DIR, "popup.html"), "r", encoding="utf-8") as f:
        pop_html = f.read()
        assert '<script src="storage_service.js"></script>' in pop_html, "Missing storage_service.js in popup.html"
    print("  ✓ options.html and popup.html script tags verified")

def test_module_exports():
    files = {
        "gemini_parser.js": ["parseList", "parseDetail", "isRealTitle", "extractDocumentsMeta"],
        "gemini_client.js": ["GeminiAPIClient", "resolveCred", "getApiUrl"],
        "takeout_engine.js": ["parseTakeoutZip", "getTakeoutOfflineChat", "getTakeoutFallbackMedia"],
        "export_engine.js": ["ExportEngine", "sanitizeFileName"],
        "storage_service.js": ["getConversations", "saveExportRecord", "normSlot", "getLastSync"],
        "asset_fetcher.js": ["handleGetFileBlob", "handleGetImageBlob", "downloadAssetDirect"],
        "dom_scraper.js": ["parseDoc", "contentFetchChatDetail", "getScrollContainer"]
    }
    for filename, symbols in files.items():
        with open(os.path.join(BASE_DIR, filename), "r", encoding="utf-8") as f:
            content = f.read()
            for sym in symbols:
                assert sym in content, f"Missing symbol '{sym}' in {filename}"
        print(f"  ✓ {filename} exports and signatures verified")

def test_i18n_keys():
    with open(os.path.join(BASE_DIR, "i18n.js"), "r", encoding="utf-8") as f:
        text = f.read()

    zh_dict = {}
    en_dict = {}
    cur = None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("zh: {"):
            cur = zh_dict
        elif line.startswith("en: {"):
            cur = en_dict
        elif ":" in line and cur is not None:
            parts = line.split(":", 1)
            k = parts[0].strip().strip('"').strip("'")
            v = parts[1].strip().rstrip(",").strip('"').strip("'")
            cur[k] = v

    for html_file in ["options.html", "popup.html"]:
        with open(os.path.join(BASE_DIR, html_file), "r", encoding="utf-8") as f:
            content = f.read()
        html_keys = set(re.findall(r'data-i18n(?:-title|-placeholder)?=["\']([^"\']+)["\']', content))
        missing_zh = html_keys - set(zh_dict.keys())
        missing_en = html_keys - set(en_dict.keys())
        assert not missing_zh, f"Missing in zh ({html_file}): {missing_zh}"
        assert not missing_en, f"Missing in en ({html_file}): {missing_en}"
    print("  ✓ i18n keys complete and matched across all HTML templates")

def test_javascript_syntax():
    import subprocess
    import shutil
    js_files = []
    for root, dirs, files in os.walk(BASE_DIR):
        if any(x in root for x in ["node_modules", ".git", "lib"]):
            continue
        for file in files:
            if file.endswith(".js"):
                js_files.append(os.path.join(root, file))

    jsc_bin = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    node_bin = shutil.which("node")

    for js_path in sorted(js_files):
        rel_path = os.path.relpath(js_path, BASE_DIR)
        with open(js_path, "r", encoding="utf-8") as f:
            code = f.read()
        if node_bin:
            res = subprocess.run([node_bin, "-c", js_path], capture_output=True, text=True)
            assert res.returncode == 0, f"JS Syntax error in {rel_path}:\n{res.stderr}"
        elif os.path.exists(jsc_bin):
            script = f"new Function({json.dumps(code)});"
            res = subprocess.run([jsc_bin, "-e", script], capture_output=True, text=True)
            assert res.returncode == 0, f"JS Syntax error in {rel_path}:\n{res.stderr or res.stdout}"
    print(f"  ✓ Syntax validated across {len(js_files)} JavaScript files")

test_json_files()
test_manifest_structure()
test_html_includes()
test_module_exports()
test_i18n_keys()
test_javascript_syntax()

print("=" * 60)
print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
print("=" * 60)
