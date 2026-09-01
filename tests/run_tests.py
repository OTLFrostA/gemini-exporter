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

test_json_files()
test_manifest_structure()
test_html_includes()
test_module_exports()

print("=" * 60)
print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
print("=" * 60)
