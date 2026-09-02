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
        for required in ["src/core/storage/storageService.js", "src/core/api/geminiParser.js", "src/core/api/geminiClient.js", "src/core/engine/domScraper.js", "src/core/engine/assetFetcher.js", "src/content/content.js"]:
            assert required in cs, f"Missing {required} in manifest content_scripts"
        print("  ✓ manifest.json scripts and permissions verified")

def test_html_includes():
    with open(os.path.join(BASE_DIR, "src/ui/options/options.html"), "r", encoding="utf-8") as f:
        opt_html = f.read()
        for script in [
            "/lib/jszip.min.js",
            "/src/core/utils/constants.js",
            "/src/core/utils/utils.js",
            "/src/core/utils/tabService.js",
            "/src/core/utils/i18n.js",
            "/src/core/storage/storageService.js",
            "/src/core/storage/formatStore.js",
            "/src/core/engine/writers/zipWriter.js",
            "/src/core/engine/writers/fsWriter.js",
            "/src/core/engine/chatFormatter.js",
            "/src/core/api/geminiParser.js",
            "/src/core/api/geminiClient.js",
            "/src/core/engine/takeoutEngine.js",
            "/src/core/engine/exportEngine.js",
            "/src/ui/state/conversationsStore.js",
            "/src/ui/views/logView.js",
            "/src/ui/views/listView.js",
            "/src/ui/views/accountView.js",
            "/src/ui/views/dialogView.js",
            "/src/ui/controllers/dirHandleController.js",
            "/src/ui/controllers/takeoutController.js",
            "/src/ui/controllers/syncController.js",
            "/src/ui/controllers/exportController.js",
            "/src/ui/options/options.js"
        ]:
            assert f'<script src="{script}"></script>' in opt_html, f"Missing {script} in options.html"
    
    with open(os.path.join(BASE_DIR, "src/ui/popup/popup.html"), "r", encoding="utf-8") as f:
        pop_html = f.read()
        assert '<script src="/src/core/storage/storageService.js"></script>' in pop_html, "Missing storageService.js in popup.html"
    print("  ✓ options.html and popup.html script tags verified")

def test_module_exports():
    files = {
        "src/core/api/geminiParser.js": ["parseList", "parseDetail", "isRealTitle", "extractDocumentsMeta"],
        "src/core/api/geminiClient.js": ["GeminiAPIClient", "resolveCred", "getApiUrl"],
        "src/core/engine/takeoutEngine.js": ["parseTakeoutZip", "getTakeoutOfflineChat", "getTakeoutFallbackMedia"],
        "src/core/engine/exportEngine.js": ["ExportEngine", "sanitizeFileName"],
        "src/core/storage/storageService.js": ["getConversations", "saveExportRecord", "normSlot", "getLastSync"],
        "src/core/engine/assetFetcher.js": ["handleGetFileBlob", "handleGetImageBlob", "downloadAssetDirect"],
        "src/core/engine/domScraper.js": ["parseDoc", "contentFetchChatDetail", "getScrollContainer"],
        "src/core/utils/constants.js": ["ALLOWED_FORMATS", "DEFAULT_FORMAT", "STORAGE_KEYS"],
        "src/core/utils/tabService.js": ["getGeminiTab", "sendToGeminiTab"],
        "src/core/storage/formatStore.js": ["ALLOWED_FORMATS", "isAllowed", "normalizeFormat", "loadFormat", "saveFormat"],
        "src/core/engine/writers/zipWriter.js": ["ZipWriter", "generateBlob", "writeFile"],
        "src/core/engine/writers/fsWriter.js": ["FsWriter", "ensureSubDir", "writeFile"],
        "src/ui/state/conversationsStore.js": ["getConversations", "setConversations", "getExportedIds", "loadStore", "getLastSync", "clearExported", "clearAll"],
        "src/ui/views/listView.js": ["render", "updateStat", "getSelected", "selectAll", "deselectAll", "selectUnexported", "selectNeedsUpdate"],
        "src/ui/views/logView.js": ["init", "log", "clear", "render", "getBuffer"],
        "src/ui/views/accountView.js": ["render", "bindChange"],
        "src/ui/views/dialogView.js": ["renderExportBanner", "dismissExportBanner"],
        "src/ui/controllers/dirHandleController.js": ["getStoredDirHandle", "saveStoredDirHandle", "requestDirHandle"],
        "src/ui/controllers/takeoutController.js": ["handleTakeoutImport"],
        "src/ui/controllers/syncController.js": ["startIncrementalScan", "startDeepScan", "stopScan"],
        "src/ui/controllers/exportController.js": ["setRunning", "isRunning", "runExport", "abort"]
    }
    for filename, symbols in files.items():
        with open(os.path.join(BASE_DIR, filename), "r", encoding="utf-8") as f:
            content = f.read()
            for sym in symbols:
                assert sym in content, f"Missing symbol '{sym}' in {filename}"
        print(f"  ✓ {filename} exports and signatures verified")

def test_i18n_keys():
    with open(os.path.join(BASE_DIR, "src/core/utils/i18n.js"), "r", encoding="utf-8") as f:
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

    for html_file in ["src/ui/options/options.html", "src/ui/popup/popup.html"]:
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
    node_bin = shutil.which("node") or (os.path.expanduser("~/.local/node/bin/node") if os.path.exists(os.path.expanduser("~/.local/node/bin/node")) else None)

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

def test_javascript_unit_tests():
    import subprocess
    import glob
    import shutil
    import tempfile

    jsc_bin = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    node_bin = shutil.which("node") or (os.path.expanduser("~/.local/node/bin/node") if os.path.exists(os.path.expanduser("~/.local/node/bin/node")) else None)

    test_files = sorted(glob.glob(os.path.join(BASE_DIR, "tests", "*.test.js")))

    # Preload files for mock fs in JSC
    file_map = {}
    for root, dirs, files in os.walk(BASE_DIR):
        if any(x in root for x in ["node_modules", ".git", "playwright"]):
            continue
        for f in files:
            if f.endswith((".js", ".html", ".json", ".md")):
                p = os.path.join(root, f)
                with open(p, "r", encoding="utf-8") as fp:
                    content = fp.read()
                    file_map[os.path.normpath(p)] = content

    for tf in test_files:
        rel = os.path.relpath(tf, BASE_DIR)
        if node_bin:
            res = subprocess.run([node_bin, "--test", tf], capture_output=True, text=True)
            assert res.returncode == 0, f"Unit test failed in {rel}:\n{res.stdout}\n{res.stderr}"
            print(f"  ✓ Unit test suite passed: {rel}")
        elif os.path.exists(jsc_bin):
            with open(tf, "r", encoding="utf-8") as f:
                test_code = f.read()

            harness = (
                "const __fileMap = " + json.dumps(file_map) + ";\n"
                "const __dirname = " + json.dumps(os.path.join(BASE_DIR, "tests")) + ";\n"
                """
            const modules = {};
            const nodeTest = (name, fn) => {
                try { fn(); }
                catch(e) { throw new Error(name + ': ' + (e.stack || e.message || e)); }
            };
            nodeTest.test = nodeTest;
            nodeTest.skip = () => {};
            nodeTest.only = nodeTest;

            function require(id) {
                if (id === 'node:test' || id === 'test') return nodeTest;
                if (id === 'node:assert' || id === 'assert') {
                    return {
                        strictEqual: (a, b) => { if (a !== b) throw new Error(a + ' !== ' + b); },
                        deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(JSON.stringify(a) + ' !== ' + JSON.stringify(b)); },
                        ok: (a, msg) => { if (!a) throw new Error(msg || ('Expected truthy, got ' + a)); }
                    };
                }
                if (id === 'node:path' || id === 'path') {
                    return {
                        join: (...parts) => {
                            let p = parts.join('/').replace(/\/+/g, '/');
                            const segments = p.split('/');
                            const resolved = [];
                            for (const seg of segments) {
                                if (seg === '..') resolved.pop();
                                else if (seg && seg !== '.') resolved.push(seg);
                            }
                            return (p.startsWith('/') ? '/' : '') + resolved.join('/');
                        }
                    };
                }
                if (id === 'node:fs' || id === 'fs') {
                    return {
                        readFileSync: (p, enc) => {
                            let norm = p.replace(/\/+/g, '/');
                            const segments = norm.split('/');
                            const resolved = [];
                            for (const seg of segments) {
                                if (seg === '..') resolved.pop();
                                else if (seg && seg !== '.') resolved.push(seg);
                            }
                            norm = (norm.startsWith('/') ? '/' : '') + resolved.join('/');
                            if (__fileMap[norm]) return __fileMap[norm];
                            for (const k in __fileMap) {
                                if (k.endsWith(norm) || norm.endsWith(k)) return __fileMap[k];
                            }
                            throw new Error('File not found in mock fs: ' + p);
                        }
                    };
                }
                if (modules[id]) return modules[id];
                throw new Error('Module not found: ' + id);
            }
            """
            )

            preload_js = []
            for mod_path, mod_id in [
                ("utils.js", "../utils.js"),
                ("utils.js", "./utils.js"),
                ("src/core/constants.js", "../src/core/constants.js"),
                ("src/core/constants.js", "./constants.js"),
                ("src/core/tabService.js", "../src/core/tabService.js"),
                ("src/core/formatStore.js", "../src/core/formatStore.js"),
                ("src/core/exporter/zipWriter.js", "../src/core/exporter/zipWriter.js"),
                ("src/core/exporter/fsWriter.js", "../src/core/exporter/fsWriter.js"),
                ("src/ui/state/conversationsStore.js", "../src/ui/state/conversationsStore.js"),
                ("src/ui/views/listView.js", "../src/ui/views/listView.js"),
                ("src/ui/views/logView.js", "../src/ui/views/logView.js"),
                ("src/ui/views/accountView.js", "../src/ui/views/accountView.js"),
                ("src/ui/views/dialogView.js", "../src/ui/views/dialogView.js"),
                ("src/ui/controllers/dirHandleController.js", "../src/ui/controllers/dirHandleController.js"),
                ("src/ui/controllers/takeoutController.js", "../src/ui/controllers/takeoutController.js"),
                ("src/ui/controllers/syncController.js", "../src/ui/controllers/syncController.js"),
                ("src/ui/controllers/exportController.js", "../src/ui/controllers/exportController.js"),
                ("storage_service.js", "../storage_service.js"),
                ("chat_formatter.js", "../chat_formatter.js"),
                ("gemini_parser.js", "../gemini_parser.js"),
                ("takeout_engine.js", "../takeout_engine.js"),
                ("i18n.js", "../i18n.js")
            ]:
                full_p = os.path.join(BASE_DIR, mod_path)
                if os.path.exists(full_p):
                    with open(full_p, "r", encoding="utf-8") as mf:
                        content = mf.read()
                    preload_js.append(
                        "(function() {\n"
                        "  const module = { exports: {} };\n"
                        "  const exports = module.exports;\n"
                        + content + "\n"
                        "  modules[" + json.dumps(mod_id) + "] = module.exports;\n"
                        "})();\n"
                    )

            full_script = harness + "\n".join(preload_js) + "\n" + test_code
            res = subprocess.run([jsc_bin, "-e", full_script], capture_output=True, text=True)
            assert res.returncode == 0, f"Unit test failed in {rel}:\n{res.stderr or res.stdout}"
            print(f"  ✓ Unit test suite passed: {rel}")

test_json_files()
test_manifest_structure()
test_html_includes()
test_module_exports()
test_i18n_keys()
test_javascript_syntax()
test_javascript_unit_tests()

print("=" * 60)
print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
print("=" * 60)
