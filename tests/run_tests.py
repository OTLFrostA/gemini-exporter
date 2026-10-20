import os
import sys
import json
import re

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

print("=" * 60)
print(" Gemini Exporter - Comprehensive Test Suite")
print("=" * 60)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def test_json_files():
    for jf in ["manifest.json", "package.json", "_locales/zh_CN/messages.json", "_locales/en/messages.json", "scripts/test_scenario_pool.json"]:
        p = os.path.join(BASE_DIR, jf)
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
            print(f"  ✓ JSON valid: {jf}")
    # 场景池运行时归档（temp/scenario_pool/archive.json）是 git-ignored 的，不在 tracked 校验之列

def test_manifest_structure():
    with open(os.path.join(BASE_DIR, "manifest.json"), "r", encoding="utf-8") as f:
        m = json.load(f)
        assert m["manifest_version"] == 3
        assert "storage" in m["permissions"]
        assert m["background"]["service_worker"] == "dist/background/background.js", "background service_worker must point to the esbuild dist output"
        cs = m["content_scripts"]
        assert cs[0]["js"] == ["dist/content/content.js"], "ISOLATED content script must load single bundled dist/content/content.js"
        main_world = [c for c in cs if c.get("world") == "MAIN"]
        assert len(main_world) == 1 and main_world[0]["js"] == ["dist/content/hook.js"], "MAIN world must load single bundled dist/content/hook.js"
        war = m["web_accessible_resources"][0]["resources"]
        assert "dist/content/hook.js" in war, "web_accessible_resources must expose dist/content/hook.js"
        print("  ✓ manifest.json scripts and permissions verified")

def test_build_pipeline():
    assert os.path.isfile(os.path.join(BASE_DIR, "build.js")), "build.js (esbuild pipeline) must exist"
    with open(os.path.join(BASE_DIR, "package.json"), "r", encoding="utf-8") as f:
        pkg = json.load(f)
    assert pkg["scripts"].get("build") == "node build.js", "package.json must define npm run build"
    assert "esbuild" in pkg.get("devDependencies", {}), "esbuild must be a devDependency"
    with open(os.path.join(BASE_DIR, ".gitignore"), "r", encoding="utf-8") as f:
        gi = f.read()
    assert re.search(r'^dist/?$', gi, re.MULTILINE), "dist/ build output must be gitignored"

    # Phase 5: verify all 5 bundle entrypoints configured in build.js
    with open(os.path.join(BASE_DIR, "build.js"), "r", encoding="utf-8") as f:
        build_content = f.read()
    assert "content/content" in build_content, "build.js must configure content/content bundle"
    assert "content/hook" in build_content, "build.js must configure content/hook bundle"
    assert "background/background" in build_content, "build.js must configure background/background bundle"
    assert "ui/popup" in build_content, "build.js must configure ui/popup bundle"
    assert "ui/options" in build_content, "build.js must configure ui/options bundle"

    # Phase 5: verify bundle artifacts if dist/ has been built
    dist_dir = os.path.join(BASE_DIR, "dist")
    if os.path.isdir(dist_dir):
        expected_bundles = [
            "dist/content/content.js",
            "dist/content/hook.js",
            "dist/background/background.js",
            "dist/ui/popup.js",
            "dist/ui/options.js",
        ]
        for bundle in expected_bundles:
            assert os.path.isfile(os.path.join(BASE_DIR, bundle)), f"Bundle artifact missing: {bundle}"
        print("  ✓ all 5 bundle artifacts verified in dist/")

    print("  ✓ esbuild build pipeline verified (build.js + npm script + devDependency)")

def test_html_includes():
    for opt_path in ["src/ui/options/options.html"]:
        with open(os.path.join(BASE_DIR, opt_path), "r", encoding="utf-8") as f:
            opt_html = f.read()
            # PR 5: options.html uses JSZip (UMD global) + single bundled dist/ui/options.js
            assert '<script src="/lib/jszip.min.js"></script>' in opt_html, f"Missing /lib/jszip.min.js in {opt_path}"
            assert '<script src="/dist/ui/options.js"></script>' in opt_html, f"Missing /dist/ui/options.js in {opt_path}"
            # Ensure legacy 50-script scatter is removed (spot-check 2 legacy entries must NOT be present)
            assert '/dist/core/protocol/protocol.js' not in opt_html or opt_html.count('<script') == 2, f"Legacy per-file scripts must be removed in {opt_path}"

    for pop_path in ["src/ui/popup/popup.html"]:
        with open(os.path.join(BASE_DIR, pop_path), "r", encoding="utf-8") as f:
            pop_html = f.read()
            # Phase 3: popup.html uses single bundled dist/ui/popup.js
            assert '<script src="/dist/ui/popup.js"></script>' in pop_html, f"Missing /dist/ui/popup.js in {pop_path}"
            # Ensure legacy per-file scripts are removed
            assert '/dist/core/protocol/protocol.js' not in pop_html or pop_html.count('<script') == 1, f"Legacy per-file scripts must be removed in {pop_path}"
    print("  ✓ options.html and popup.html script tags verified")


def test_i18n_keys():
    # V2 UI supports two intentional static-label mechanisms:
    #  1. data-en/data-zh (and data-ui-* pairs) for inline labels;
    #  2. data-i18n, data-i18n-title and data-i18n-placeholder for the
    #     existing UI_COPY dictionary consumed by labelPage().
    # Removing those active attributes would break language switching. Verify
    # complete EN/ZH translations instead of banning one of the two mechanisms.
    from html.parser import HTMLParser
    import json
    labels_path = os.path.join(BASE_DIR, "src/ui/shared/legacyLabels.ts")
    with open(labels_path, encoding="utf-8") as f:
        source = f.read()
    body = source.split(" = {", 1)[1].rsplit("};", 1)[0]
    copy = json.loads("{" + body + "}")
    assert set(copy) == {"en", "zh"}, "UI_COPY must declare both languages"
    assert set(copy["en"]) == set(copy["zh"]), "UI_COPY keys must match across languages"
    assert all(isinstance(value, str) and value.strip()
               for language in ("en", "zh") for value in copy[language].values()), "Every UI_COPY translation must be nonempty"

    class Labels(HTMLParser):
        def __init__(self):
            super().__init__()
            self.count = 0
        def handle_starttag(self, tag, attrs):
            pairs = dict(attrs)
            assert len(pairs) == len(attrs), f"Duplicate attributes on {tag}: {attrs}"
            for en, zh in (("data-en", "data-zh"), ("data-ui-en", "data-ui-zh")):
                if en in pairs or zh in pairs:
                    assert pairs.get(en) and pairs.get(zh), f"Incomplete inline bilingual label: {attrs}"
                    self.count += 1
            for attr in ("data-i18n", "data-i18n-title", "data-i18n-placeholder"):
                if attr not in pairs:
                    continue
                key = pairs[attr]
                assert key and key in copy["en"] and key in copy["zh"], f"Unknown UI_COPY key for {attr}: {key}"
                self.count += 1

    for filepath in ("src/ui/options/options.html", "src/ui/popup/popup.html"):
        checker = Labels()
        with open(os.path.join(BASE_DIR, filepath), encoding="utf-8") as f:
            checker.feed(f.read())
        assert checker.count > 0, f"No bilingual labels checked in {filepath}"
    print("  ✓ Current UI static labels have complete EN/ZH translations")

def test_javascript_syntax():
    import subprocess
    import shutil
    # PR7: delegate syntax validation to TypeScript compiler (strict mode covers JS + TS)
    node_bin = None
    for cand in [shutil.which("node"), os.path.expanduser("~/.local/node/bin/node"), os.path.expanduser("~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"), r"C:\Program Files\nodejs\node.exe"]:
        if cand and os.path.exists(cand):
            node_bin = cand
            break

    tsc_script = os.path.join(BASE_DIR, "node_modules", "typescript", "bin", "tsc")
    if node_bin and os.path.exists(tsc_script):
        res = subprocess.run([node_bin, tsc_script, "--noEmit"], cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace")
    else:
        env = os.environ.copy()
        for p in [r"C:\Program Files\nodejs", r"C:\Program Files\nodejs\npx.cmd"]:
            if p not in env.get("PATH", ""):
                env["PATH"] = p + os.pathsep + env.get("PATH", "")
        npx_bin = shutil.which("npx", path=env["PATH"]) or r"C:\Program Files\nodejs\npx.cmd" or "npx"
        res = subprocess.run(f'"{npx_bin}" tsc --noEmit', cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace", shell=True, env=env)

    assert res.returncode == 0, f"TypeScript syntax check failed (tsc --noEmit):\n{res.stdout}\n{res.stderr}"
    print(f"  ✓ TypeScript strict syntax validated (tsc --noEmit)")

def test_javascript_unit_tests(target_tests=None):
    import subprocess
    import glob
    import shutil
    import tempfile

    jsc_bin = "/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc"
    node_bin = None
    for cand in [shutil.which("node"), os.path.expanduser("~/.local/node/bin/node"), os.path.expanduser("~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"), r"C:\Program Files\nodejs\node.exe"]:
        if cand and os.path.exists(cand):
            node_bin = cand
            break

    test_files = sorted(set(glob.glob(os.path.join(BASE_DIR, "tests", "*.test.js")) + glob.glob(os.path.join(BASE_DIR, "tests", "*.test.ts")) + glob.glob(os.path.join(BASE_DIR, "tests", "arch", "*.test.ts"))))
    if target_tests is not None:
        norm_targets = {os.path.normpath(t).replace("\\", "/") for t in target_tests}
        norm_bases = {os.path.basename(t) for t in target_tests}
        test_files = [
            tf for tf in test_files
            if os.path.relpath(tf, BASE_DIR).replace("\\", "/") in norm_targets
            or os.path.basename(tf) in norm_bases
        ]
        if not test_files:
            print("  ✓ 无受影响的 JavaScript/TypeScript 单元测试需要执行。")
            return


    # Preload files for mock fs in JSC
    file_map = {}
    for root, dirs, files in os.walk(BASE_DIR):
        # Prune build outputs, test results and artifacts
        dirs[:] = [d for d in dirs if d not in ["node_modules", ".git", "playwright", "dist", "output", "test-results", "playwright-report"]]
        if any(x in root for x in ["node_modules", ".git", "playwright", "dist", "tests/output", "tests\\output", "test-results", "playwright-report"]):
            continue
        for f in files:
            if f.endswith((".js", ".html", ".json", ".md")):
                p = os.path.join(root, f)
                with open(p, "r", encoding="utf-8", errors="replace") as fp:
                    content = fp.read()
                    file_map[os.path.normpath(p)] = content

    register_hook = os.path.join(BASE_DIR, "tests", "ts_register.js")

    for tf in test_files:
        rel = os.path.relpath(tf, BASE_DIR)
        if node_bin:
            cmd = [node_bin, "-r", register_hook, "--test", tf] if os.path.exists(register_hook) else [node_bin, "--test", tf]
            res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
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
            nodeTest.skip = (name) => { throw new Error('Skipping unit tests is strictly forbidden: ' + name); };
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
                            let p = parts.join('/').replace(/\\/+/g, '/');
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
                            let norm = p.replace(/\\/+/g, '/');
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
                ("src/shared/utils/utils.js", "../src/shared/utils/utils.js"),
                ("src/shared/utils/utils.js", "./src/shared/utils/utils.js"),
                ("src/shared/utils/utils.js", "./utils.js"),
                ("src/shared/utils/utils.js", "../utils.js"),
                ("src/l1/parsers/gemini/rpc/extractors.js", "./parser/extractors.js"),
                ("src/l1/parsers/gemini/rpc/extractors.js", "./extractors.js"),
                ("src/l1/parsers/gemini/rpc/extractors.js", "../src/l1/parsers/gemini/rpc/extractors.js"),
                ("tests/helpers/recordFixture/attachments.js", "./parser/attachments.js"),
                ("tests/helpers/recordFixture/attachments.js", "./attachments.js"),
                ("tests/helpers/recordFixture/attachments.js", "./helpers/recordFixture/attachments.js"),
                ("src/l1/parsers/gemini/rpc/parseList.js", "./parser/parseList.js"),
                ("src/l1/parsers/gemini/rpc/parseList.js", "./parseList.js"),
                ("src/l1/parsers/gemini/rpc/parseList.js", "../src/l1/parsers/gemini/rpc/parseList.js"),
                ("src/l1/client/gemini/api/credentialManager.js", "./client/credentialManager.js"),
                ("src/l1/client/gemini/api/credentialManager.js", "./credentialManager.js"),
                ("src/l1/client/gemini/api/credentialManager.js", "../src/l1/client/gemini/api/credentialManager.js"),
                ("src/l1/client/gemini/api/retryPolicy.js", "./client/retryPolicy.js"),
                ("src/l1/client/gemini/api/retryPolicy.js", "./retryPolicy.js"),
                ("src/l1/client/gemini/api/retryPolicy.js", "../src/l1/client/gemini/api/retryPolicy.js"),
                ("src/l1/client/gemini/api/rpcClient.js", "./client/rpcClient.js"),
                ("src/l1/client/gemini/api/rpcClient.js", "./rpcClient.js"),
                ("src/l1/client/gemini/api/rpcClient.js", "../src/l1/client/gemini/api/rpcClient.js"),
                ("src/l1/client/gemini/api/pagination.js", "./client/pagination.js"),
                ("src/l1/client/gemini/api/pagination.js", "./pagination.js"),
                ("src/l1/client/gemini/api/pagination.js", "../src/l1/client/gemini/api/pagination.js"),
                ("src/l1/client/gemini/geminiClient.js", "../src/l1/client/gemini/geminiClient.js"),
                ("src/l1/client/gemini/geminiClient.js", "./src/l1/client/gemini/geminiClient.js"),
                ("src/l1/client/gemini/geminiClient.js", "./geminiClient.js"),
                ("utils.js", "../utils.js"),
                ("utils.js", "./utils.js"),
                ("src/core/constants.js", "../src/core/constants.js"),
                ("src/core/constants.js", "./constants.js"),
                ("src/core/tabService.js", "../src/core/tabService.js"),
                ("src/l4/packaging/writers/zipWriter.js", "../src/l4/packaging/writers/zipWriter.js"),
                ("src/l4/delivery/writers/fsWriter.js", "../src/l4/delivery/writers/fsWriter.js"),
                ("src/l4/delivery/writers/writerInterface.js", "../src/l4/delivery/writers/writerInterface.js"),
                ("src/core/engine/chatFormatter.js", "../src/core/engine/chatFormatter.js"),
                ("src/l1/imports/takeout/zipBombGuard.js", "./takeout/zipBombGuard.js"),
                ("src/l1/imports/takeout/zipBombGuard.js", "./zipBombGuard.js"),
                ("src/l1/imports/takeout/zipBombGuard.js", "../src/l1/imports/takeout/zipBombGuard.js"),
                ("src/shared/resources/takeout/mediaIndex.js", "./takeout/mediaIndex.js"),
                ("src/shared/resources/takeout/mediaIndex.js", "./mediaIndex.js"),
                ("src/shared/resources/takeout/mediaIndex.js", "../src/shared/resources/takeout/mediaIndex.js"),
                ("src/l1/imports/takeout/importTakeout.js", "./takeout/takeoutParser.js"),
                ("src/l1/imports/takeout/importTakeout.js", "./takeoutParser.js"),
                ("src/l1/imports/takeout/importTakeout.js", "../src/l1/imports/takeout/importTakeout.js"),
                ("src/l1/imports/takeoutEngine.js", "../src/l1/imports/takeoutEngine.js"),
                ("src/l1/imports/takeoutEngine.js", "./src/l1/imports/takeoutEngine.js"),
                ("src/l1/imports/takeoutEngine.js", "./takeoutEngine.js"),
                ("src/core/engine/export/progressReporter.js", "./export/progressReporter.js"),
                ("src/core/engine/export/progressReporter.js", "./progressReporter.js"),
                ("src/core/engine/export/progressReporter.js", "../src/core/engine/export/progressReporter.js"),
                ("src/core/engine/export/sessionRecovery.js", "./export/sessionRecovery.js"),
                ("src/core/engine/export/sessionRecovery.js", "./sessionRecovery.js"),
                ("src/core/engine/export/sessionRecovery.js", "../src/core/engine/export/sessionRecovery.js"),
                ("src/core/engine/export/batchWorker.js", "./export/batchWorker.js"),
                ("src/core/engine/export/batchWorker.js", "./batchWorker.js"),
                ("src/core/engine/export/batchWorker.js", "../src/core/engine/export/batchWorker.js"),
                ("src/l1/client/rateLimiter.js", "./export/rateLimiter.js"),
                ("src/l1/client/rateLimiter.js", "./rateLimiter.js"),
                ("src/l1/client/rateLimiter.js", "../src/l1/client/rateLimiter.js"),
                ("src/core/engine/export/exportOrchestrator.js", "./export/exportOrchestrator.js"),
                ("src/core/engine/export/exportOrchestrator.js", "./exportOrchestrator.js"),
                ("src/core/engine/export/exportOrchestrator.js", "../src/core/engine/export/exportOrchestrator.js"),
                ("src/application/exportEngine.js", "../src/application/exportEngine.js"),
                ("src/application/exportEngine.js", "./src/application/exportEngine.js"),
                ("src/application/exportEngine.js", "./exportEngine.js"),
                ("src/core/exporter/zipWriter.js", "../src/core/exporter/zipWriter.js"),
                ("src/core/exporter/fsWriter.js", "../src/core/exporter/fsWriter.js"),
                ("src/ui/options/state/conversationsStore.js", "../src/ui/options/state/conversationsStore.js"),
                ("src/ui/options/views/listView.js", "../src/ui/options/views/listView.js"),
                ("src/ui/options/views/logView.js", "../src/ui/options/views/logView.js"),
                ("src/ui/options/views/accountView.js", "../src/ui/options/views/accountView.js"),
                ("src/ui/options/views/dialogView.js", "../src/ui/options/views/dialogView.js"),
                ("src/runtime/capabilities/dirHandleController.js", "../src/runtime/capabilities/dirHandleController.js"),
                ("src/ui/options/controllers/takeoutController.js", "../src/ui/options/controllers/takeoutController.js"),
                ("src/ui/options/controllers/syncController.js", "../src/ui/options/controllers/syncController.js"),
                ("src/ui/options/controllers/exportController.js", "../src/ui/options/controllers/exportController.js"),
                ("storage_service.js", "../storage_service.js"),
                ("chat_formatter.js", "../chat_formatter.js"),
                ("gemini_parser.js", "../gemini_parser.js"),
                ("takeout_engine.js", "../takeout_engine.js"),
                ("src/shared/utils/locales/zh.js", "./locales/zh.js"),
                ("src/shared/utils/locales/en.js", "./locales/en.js"),
                ("src/shared/utils/locales/zh.js", "../src/shared/utils/locales/zh.js"),
                ("src/shared/utils/locales/en.js", "../src/shared/utils/locales/en.js"),
                ("src/shared/utils/i18n.js", "../src/shared/utils/i18n.js"),
                ("src/shared/utils/i18n.js", "./i18n.js"),
                ("i18n.js", "../i18n.js")
            ]:
                full_p = os.path.join(BASE_DIR, mod_path)
                if not os.path.exists(full_p):
                    if mod_path.startswith("src/"):
                        dp = os.path.join(BASE_DIR, "dist", mod_path[4:])
                        if os.path.exists(dp):
                            full_p = dp
                if not os.path.exists(full_p) and mod_path.endswith('.js'):
                    tsp = full_p[:-3] + '.ts'
                    if os.path.exists(tsp):
                        full_p = tsp
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

def test_content_badge_flicker_prevention():
    css_path = os.path.join(BASE_DIR, "src/ui/badge/content.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()
    assert "white-space: nowrap" in css, "content.css should prevent badge text wrapping"
    assert "min-width:" in css, "content.css should define min-width to avoid width jitter"
    assert ".syncing .pulse" in css, "content.css should only pulse when syncing"
    assert re.search(r'#geminiExportBadge\s+\.pulse\s*\{[^}]*background:\s*#06b6d4', css), "content.css idle pulse should define static background #06b6d4"

    content_ts = os.path.join(BASE_DIR, "src/runtime/content/content.ts")
    js_path = content_ts if os.path.isfile(content_ts) else os.path.join(BASE_DIR, "src/runtime/content/content.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    badge_ts = os.path.join(BASE_DIR, "src/ui/badge/badgeView.ts")
    badge_js_path = badge_ts if os.path.isfile(badge_ts) else os.path.join(BASE_DIR, "src/ui/badge/badgeView.js")
    badge_js = ""
    if os.path.exists(badge_js_path):
        with open(badge_js_path, "r", encoding="utf-8") as f:
            badge_js = f.read()
    observer_ts = os.path.join(BASE_DIR, "src/runtime/content/pageObserver.ts")
    observer_path = observer_ts if os.path.isfile(observer_ts) else os.path.join(BASE_DIR, "src/runtime/content/pageObserver.js")
    with open(observer_path, "r", encoding="utf-8") as f:
        observer_js = f.read()
    sync_ts = os.path.join(BASE_DIR, "src/runtime/content/syncEngine.ts")
    sync_path = sync_ts if os.path.isfile(sync_ts) else os.path.join(BASE_DIR, "src/runtime/content/syncEngine.js")
    with open(sync_path, "r", encoding="utf-8") as f:
        sync_js = f.read()
    combined_js = js + badge_js
    assert "debouncedSync" in observer_js, "pageObserver.js should debounce sync triggers"
    with open(os.path.join(BASE_DIR, "src/l2/ingestion.ts"), encoding="utf-8") as f:
        ingestion = f.read()
    with open(os.path.join(BASE_DIR, "src/runtime/content/geminiIndexCapture.ts"), encoding="utf-8") as f:
        capture_js = f.read()
    assert "ingestIndexes" in capture_js, "L1 capture must delegate admission to the shared Domain boundary"
    assert "JSON.stringify(list) !== JSON.stringify(existing)" in ingestion, "Index admission must skip unchanged writes"
    assert "textContent" in combined_js and "targetText" in combined_js, "badgeView/content.js updateBadge should guard textContent updates"
    assert "existing.isConnected" in combined_js or "isConnected" in combined_js, "badgeView/content.js ensureBadge should check isConnected"
    print("  ✓ Content badge flicker prevention verified")

def test_account_uuid_storage_boundary():
    with open(os.path.join(BASE_DIR, "src/l3a/storageService.ts"), encoding="utf-8") as f:
        storage = f.read()
    assert "gemini_account_slots" not in storage, "Storage must not maintain a second account registry"
    assert "gemini_exported_u0" not in storage, "Current storage must not read legacy slot aliases"
    print("  ✓ UUID storage boundary verified")

def test_custom_dataset_loading():
    import tempfile
    scripts_dir = os.path.join(BASE_DIR, "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from test_live_chat_and_export import load_custom_dataset

    # 1. No dataset -> should return (True, None) (falls back to pool)
    ok, res = load_custom_dataset(None)
    assert ok and res is None, "None dataset path should succeed with None (allowing pool default)"

    # 2. Non-existent dataset file -> should return (False, err)
    ok, res = load_custom_dataset("/path/to/non_existent_dataset.json")
    assert not ok and "不存在" in res, "Non-existent dataset file should fail"

    # 3. Invalid JSON file -> should return (False, err)
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as f:
        f.write("{invalid json content")
        f_bad = f.name
    try:
        ok, res = load_custom_dataset(f_bad)
        assert not ok and "失败" in res, "Invalid JSON dataset should fail"
    finally:
        if os.path.isfile(f_bad):
            os.remove(f_bad)

    # 4. Valid JSON dataset -> should return (True, parsed_data)
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as f:
        f.write('[{"id":"test","title":"Test","turns":["Q1","A1"]}]')
        f_name = f.name
    try:
        ok, res = load_custom_dataset(f_name)
        assert ok and isinstance(res, list) and len(res) == 1, "Valid dataset should parse successfully"
    finally:
        if os.path.isfile(f_name):
            os.remove(f_name)

    print("  ✓ Custom dataset loader & format validation verified")

def test_scenario_pool_pipeline():
    import tempfile
    scripts_dir = os.path.join(BASE_DIR, "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from manage_scenario_pool import validate_pool, consume_scenarios, topup_scenarios

    # Use an isolated corpus: Tier 2 may legitimately leave the real pool below 20/20.
    scenarios = [
        {
            "id": f"unit_scenario_{i:02d}",
            "title": f"Unit Scenario {i}",
            "domain": f"unit_domain_{i % 10}",
            "features": ["imagen", "creative"] if i < 2 else ["code"],
            "turns": [f"prompt {i} turn 1", f"prompt {i} turn 2"],
        }
        for i in range(20)
    ]

    with tempfile.TemporaryDirectory() as tmp_dir:
        pool_path = os.path.join(tmp_dir, "pool.json")
        archive_path = os.path.join(tmp_dir, "archive.json")
        with open(pool_path, "w", encoding="utf-8") as f:
            json.dump(scenarios, f, ensure_ascii=False)

        # Validate capacity and diversity without reading the real consumed.json.
        ok, errs, status = validate_pool(pool_path, strict_count=True)
        assert ok, f"Scenario pool validation failed: {errs}"
        assert status["count"] == 20
        assert status["has_imagen"] >= 2
        assert len(status["domains"]) >= 10

        # Dry-run selection must leave the fixture and archive untouched.
        selected, pool_after = consume_scenarios(pool_path, count=2, dry_run=True, require_imagen=True)
        assert len(selected) == 2
        assert len(pool_after) == 18
        assert any("imagen" in s.get("features", []) for s in selected)
        with open(pool_path, "r", encoding="utf-8") as f:
            assert len(json.load(f)) == 20
        assert not os.path.exists(archive_path)

        # Consume, archive, and top up entirely within the temporary directory.
        consumed, remaining = consume_scenarios(
            pool_path, count=2, archive_path=archive_path, dry_run=False, require_imagen=True
        )
        assert [s["id"] for s in consumed] == [s["id"] for s in selected]
        assert len(remaining) == 18
        with open(pool_path, "r", encoding="utf-8") as f:
            assert len(json.load(f)) == 18
        with open(archive_path, "r", encoding="utf-8") as f:
            archived = json.load(f)
        assert len(archived) == 2
        assert all("consumed_at" in item for item in archived)

        ok, errs, _ = validate_pool(pool_path, strict_count=True)
        assert not ok and any("水位不足" in err for err in errs)

        added, restored_pool = topup_scenarios(consumed, pool_path=pool_path)
        assert len(added) == 2
        assert len(restored_pool) == 20
        ok, errs, restored_status = validate_pool(pool_path, strict_count=True)
        assert ok, f"Restored scenario pool validation failed: {errs}"
        assert restored_status["count"] == 20

    print("  ✓ Scenario pool pipeline, 20-scenario diversity, consume, archive & top-up verified")

def test_online_scenario_provider_and_lifecycle_tracker():
    import tempfile
    import contextlib
    import io
    scripts_dir = os.path.join(BASE_DIR, "scripts")
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from framework.scenario_provider import OnlineScenarioProvider
    from framework.lifecycle_tracker import SessionLifecycleTracker

    # 1. Test OnlineScenarioProvider
    OnlineScenarioProvider.reset()
    mock_pool = [
        {"id": "sc_img", "title": "Imagen Test", "features": ["imagen", "creative"], "turns": ["draw a cat", "draw a dog"]},
        {"id": "sc_code", "title": "Code Test", "features": ["code", "python"], "turns": ["write fibonacci", "optimize it"]},
    ]
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as f_p:
        json.dump(mock_pool, f_p, ensure_ascii=False)
        p_path = f_p.name
    with tempfile.NamedTemporaryFile("w", delete=False, suffix=".json") as f_a:
        json.dump([], f_a)
        a_path = f_a.name

    try:
        prov = OnlineScenarioProvider(pool_path=p_path, archive_path=a_path)
        status = prov.get_status()
        assert status["count"] == 2
        assert status["has_imagen"] == 1

        # Suppress live-run messages emitted for synthetic fixture scenarios.
        with contextlib.redirect_stdout(io.StringIO()):
            # Pop imagen
            sc1 = prov.pop_scenario(required_features=["imagen"])
            assert sc1["id"] == "sc_img"
            assert prov.get_status()["count"] == 1

            # Pop next
            sc2 = prov.pop_scenario()
            assert sc2["id"] == "sc_code"
            assert prov.get_status()["count"] == 0

        # Archive check
        with open(a_path, "r", encoding="utf-8") as af:
            archived = json.load(af)
        assert len(archived) == 2
        assert "consumed_at" in archived[0]

        # Ephemeral query fallback when pool empty
        eq = prov.pop_ephemeral_query()
        assert "瞬态一致性" in eq or len(eq) > 10

        # Exhaused pool raises RuntimeError
        try:
            prov.pop_scenario()
            assert False, "Should raise RuntimeError on exhausted pool"
        except RuntimeError as e:
            assert "场景池已枯竭" in str(e)
    finally:
        OnlineScenarioProvider.reset()
        for p in [p_path, a_path]:
            if os.path.isfile(p):
                os.remove(p)

    # 2. Test SessionLifecycleTracker
    tracker = SessionLifecycleTracker()
    with contextlib.redirect_stdout(io.StringIO()):
        tracker.track("chat_abc_1")
        tracker.track("chat_abc_2")
        tracker.track("chat_abc_1")  # duplicate
    assert len(tracker._tracked_chat_ids) == 2

    # mark one deleted (e.g. from ephemeral deletion test)
    tracker.mark_deleted("chat_abc_1")
    assert "chat_abc_1" in tracker._deleted_chat_ids

    # active chats should be only chat_abc_2
    assert tracker.get_active_chats() == ["chat_abc_2"]

    # teardown retains active chats without deleting them
    with contextlib.redirect_stdout(io.StringIO()):
        retained = tracker.teardown()
    assert retained == 1

    print("  ✓ OnlineScenarioProvider & SessionLifecycleTracker unit tests passed")


def test_tour_status_indicator_styling():
    # The current Spotlight uses a cutout and dialog, not old connection lamps.
    with open(os.path.join(BASE_DIR, "src/ui/guidance/tourGuide.css"), encoding="utf-8") as f:
        css = f.read()
    container = re.search(r'\.tour-overlay-container\s*\{([^}]+)', css).group(1)
    popover = re.search(r'\.tour-popover\s*\{([^}]+)', css).group(1)
    assert "pointer-events:none" in container.replace(" ", ""), "Cutout must pass business clicks to its target"
    assert "pointer-events:auto" in popover.replace(" ", ""), "Popover controls must stay operable"
    assert "max-height:" in popover and "overflow:auto" in popover.replace(" ", ""), "Small viewports must retain all Tour actions"
    with open(os.path.join(BASE_DIR, "src/ui/guidance/tourGuide.ts"), encoding="utf-8") as f:
        guide = f.read()
    assert "role', 'dialog'" in guide and "Escape" in guide, "Guidance must preserve dialog semantics and keyboard dismissal"
    print("  ✓ Current Tour cutout, interaction and viewport styles verified")


def test_takeout_limit_modal_and_wall_detection():
    with open(os.path.join(BASE_DIR, "src/ui/options/options.ts"), encoding="utf-8") as f:
        options = f.read()
    with open(os.path.join(BASE_DIR, "src/ui/guidance/tourGuide.ts"), encoding="utf-8") as f:
        guide = f.read()
    with open(os.path.join(BASE_DIR, "src/ui/options/controllers/syncController.ts"), encoding="utf-8") as f:
        sync = f.read()
    with open(os.path.join(BASE_DIR, "src/application/settings/index.ts"), encoding="utf-8") as f:
        settings = f.read()
    assert "takeoutFileInput" in options and "handleTakeoutImport" in options
    assert "takeoutPromptCompleted" in settings and "takeoutPromptCompleted" in options
    assert "showTakeoutPrompt" in guide and "importFile()" in guide
    assert "scanAll" in sync and "AbortSignal" in sync, "Scan is a local typed Application invocation"
    for old in ("deepScan", "hitGoogleLimit", "gemini_pending_takeout_prompt"):
        assert old not in sync, f"UI must not reconstruct provider limits with {old}"
    # Threshold, acknowledgement, import and cancellation behavior run against
    # actual handlers in tour_guide.test.ts and takeout_limit_prompt.spec.ts.
    print("  ✓ Takeout guidance uses Application counters, current Settings and File import")


def test_stage1_architecture_ssot_and_state_isolation():
    # 1. Verify per-slot aborts in background.ts/js (or modular src/runtime/background/)
    bg_dir = os.path.join(BASE_DIR, "src/runtime/background")
    if os.path.isdir(bg_dir):
        bg_code = ""
        for bf_name in sorted(os.listdir(bg_dir)):
            if bf_name.endswith(".ts") or bf_name.endswith(".js"):
                with open(os.path.join(bg_dir, bf_name), "r", encoding="utf-8") as bf:
                    bg_code += bf.read() + "\n"
    else:
        bg_ts = os.path.join(BASE_DIR, "src/runtime/background/background.ts")
        bg_js_path = bg_ts if os.path.isfile(bg_ts) else os.path.join(BASE_DIR, "src/runtime/background/background.js")
        with open(bg_js_path, "r", encoding="utf-8") as f:
            bg_code = f.read()
    assert "__bgAborts" in bg_code and "Map" in bg_code, "background.js must isolate abort flags per account slot using Map"
    assert not re.search(r'let\s+__bgAborted\s*=\s*(?:false|true);', bg_code), "background.js must not contain mutable global __bgAborted"
    assert "isSlotAborted" in bg_code and "setSlotAborted" in bg_code, "background.js must provide slot-aware abort helpers"

    # 2. Verify per-slot Takeout cache in takeoutEngine
    takeout_ts = os.path.join(BASE_DIR, "src/l1/imports/takeoutEngine.ts")
    takeout_path = takeout_ts if os.path.isfile(takeout_ts) else os.path.join(BASE_DIR, "src/l1/imports/takeoutEngine.js")
    with open(takeout_path, "r", encoding="utf-8") as f:
        takeout_code = f.read()
    assert "__accountTakeouts" in takeout_code and "Map" in takeout_code, "takeoutEngine must isolate takeout dictionaries per account slot"
    assert "getStore" in takeout_code, "takeoutEngine must route through getStore(slot)"

    # 3. Verify SSoT compareConversations in syncEngine.ts and options.js
    sync_ts = os.path.join(BASE_DIR, "src/runtime/content/syncEngine.ts")
    sync_js_path = sync_ts if os.path.isfile(sync_ts) else os.path.join(BASE_DIR, "src/runtime/content/syncEngine.js")
    with open(sync_js_path, "r", encoding="utf-8") as f:
        sync_code = f.read()
    assert "compareConversations" in sync_code, "syncEngine.js upsertConversations must use compareConversations SSoT"

    options_ts = os.path.join(BASE_DIR, "src/ui/options/options.ts")
    options_js_path = options_ts if os.path.isfile(options_ts) else os.path.join(BASE_DIR, "src/ui/options/options.js")
    with open(options_js_path, "r", encoding="utf-8") as f:
        options_code = f.read()
    assert "compareConversations" in options_code, "options.js loadStore must use compareConversations SSoT"

    # 4. Verify SSoT sanitizeFileName and cleanTitle delegation in exportEngine
    export_ts = os.path.join(BASE_DIR, "src/application/exportEngine.ts")
    export_path = export_ts if os.path.isfile(export_ts) else os.path.join(BASE_DIR, "src/application/exportEngine.js")
    with open(export_path, "r", encoding="utf-8") as f:
        export_code = f.read()
    assert "sanitizeFileName" in export_code, "exportEngine sanitizeFileName must delegate to GeminiUtils SSoT"

    print("  ✓ Stage 1 Architecture: SSoT consolidation and per-slot state isolation verified")

def test_storage_keys_and_constants_ssot():
    constants_path = os.path.join(BASE_DIR, "src/shared/utils/constants.ts")
    with open(constants_path, "r", encoding="utf-8") as f:
        constants_code = f.read()

    # 1. Verify STORAGE_KEYS completeness in constants.ts
    required_keys = [
        "FORMAT", "ZIP", "DEV_MODE", "LANG", "PENDING_TAKEOUT_PROMPT",
        "SUPPRESS_DIRECT_WRITE_PROMPT", "CREDENTIALS_MAP", "CREDENTIALS",
        "LAST_SYNC_DIAGNOSTICS", "LAST_EXPORT_SESSION",
        "LIVE_SAVE_CONFIG", "HAS_COMPLETED_TOUR", "LAST_SEEN_FEATURE_VERSION",
        "BADGE_POS", "HAS_COMPLETED_TAKEOUT_PROMPT", "HAS_IMPORTED_TAKEOUT"
    ]
    for k in required_keys:
        assert f"{k}:" in constants_code, f"STORAGE_KEYS in constants.ts must define {k}"

    assert "DEFAULT_EXPORT_FOLDER_NAME" in constants_code, "constants.ts must define DEFAULT_EXPORT_FOLDER_NAME"
    assert "IDB_DATABASES" in constants_code, "constants.ts must define IDB_DATABASES"

    # 2. Verify build.js supports --pack and package script exists in package.json
    build_path = os.path.join(BASE_DIR, "build.js")
    with open(build_path, "r", encoding="utf-8") as f:
        build_code = f.read()
    assert "--pack" in build_code, "build.js must implement --pack packaging support"

    pkg_path = os.path.join(BASE_DIR, "package.json")
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg_code = f.read()
    assert '"package":' in pkg_code, 'package.json must declare "package" script'

    # 3. Static Linter: ensure no raw string literals in src/ bypass STORAGE_KEYS
    forbidden_literals = [
        ("gemini_dev_mode", "STORAGE_KEYS.DEV_MODE"),
        ("gemini_export_zip", "STORAGE_KEYS.ZIP"),
        ("gemini_export_format", "STORAGE_KEYS.FORMAT"),
        ("gemini_account_slots", "STORAGE_KEYS.ACCOUNT_SLOTS"),
        ("gemini_last_sync_diagnostics", "STORAGE_KEYS.LAST_SYNC_DIAGNOSTICS"),
        ("gemini_export_badge_pos", "STORAGE_KEYS.BADGE_POS"),
        ("has_completed_tour", "STORAGE_KEYS.HAS_COMPLETED_TOUR"),
        ("last_seen_feature_version", "STORAGE_KEYS.LAST_SEEN_FEATURE_VERSION"),
        ("has_completed_takeout_prompt", "STORAGE_KEYS.HAS_COMPLETED_TAKEOUT_PROMPT"),
        ("has_imported_takeout", "STORAGE_KEYS.HAS_IMPORTED_TAKEOUT")
    ]

    src_dir = os.path.join(BASE_DIR, "src")
    violations = []
    for root, _, files in os.walk(src_dir):
        for f in files:
            if f.endswith(".ts") and f != "constants.ts":
                full_p = os.path.join(root, f)
                with open(full_p, "r", encoding="utf-8") as fp:
                    content = fp.read()
                rel_p = os.path.relpath(full_p, BASE_DIR).replace("\\", "/")
                for lit, s_key in forbidden_literals:
                    if f"'{lit}'" in content or f'"{lit}"' in content:
                        violations.append(f"{rel_p}: contains raw literal '{lit}', must use {s_key}")

    assert not violations, "SSoT Storage Key Violations found:\n" + "\n".join(violations)
    print("  ✓ Storage Keys and Constants SSoT integrity verified (0 raw literals in src/)")

def test_stage2_architecture_improvements():
    # 1. Verify sanitizeRelativePath in utils, zipWriter, fsWriter, and exportEngine
    utils_ts = os.path.join(BASE_DIR, "src/shared/utils/utils.ts")
    utils_path = utils_ts if os.path.isfile(utils_ts) else os.path.join(BASE_DIR, "src/shared/utils/utils.js")
    with open(utils_path, "r", encoding="utf-8") as f:
        utils_code = f.read()
    assert "sanitizeRelativePath" in utils_code, "utils must implement and export sanitizeRelativePath"

    zip_writer_ts = os.path.join(BASE_DIR, "src/l4/packaging/writers/zipWriter.ts")
    zip_writer_path = zip_writer_ts if os.path.isfile(zip_writer_ts) else os.path.join(BASE_DIR, "src/l4/packaging/writers/zipWriter.js")
    with open(zip_writer_path, "r", encoding="utf-8") as f:
        zip_code = f.read()
    assert "sanitizeRelativePath" in zip_code or "sanitizePath" in zip_code, "zipWriter must use sanitizeRelativePath"

    fs_writer_ts = os.path.join(BASE_DIR, "src/l4/delivery/writers/fsWriter.ts")
    fs_writer_path = fs_writer_ts if os.path.isfile(fs_writer_ts) else os.path.join(BASE_DIR, "src/l4/delivery/writers/fsWriter.js")
    with open(fs_writer_path, "r", encoding="utf-8") as f:
        fs_code = f.read()
    assert "sanitizeRelativePath" in fs_code, "fsWriter must use sanitizeRelativePath"
    assert "ensureSubDir" in fs_code and "writeFile" in fs_code, "fsWriter must support flexible path writing"

    # 2. Verify export orchestrator AsyncQueue and elimination of busy-polling
    export_ts = os.path.join(BASE_DIR, "src/core/engine/export/exportOrchestrator.ts")
    if not os.path.isfile(export_ts):
        export_ts = os.path.join(BASE_DIR, "src/application/exportEngine.ts")
    export_path = export_ts if os.path.isfile(export_ts) else os.path.join(BASE_DIR, "src/application/exportEngine.js")
    with open(export_path, "r", encoding="utf-8") as f:
        export_code = f.read()
    assert "AsyncQueue" in export_code, "exportEngine must implement event-driven AsyncQueue"
    assert not re.search(r'setTimeout\s*\(\s*\w+\s*,\s*100\s*\)', export_code), "exportEngine must not use busy-polling setTimeout(r, 100)"
    assert "attachmentQueue" in export_code, "exportEngine must properly manage attachmentQueue"
    assert "writeFileDirect" in export_code, "exportEngine must have writeFileDirect"

    # 3. Verify hookCredentials.js error sandboxing
    hook_ts = os.path.join(BASE_DIR, "src/l1/sniffer/gemini/hookCredentials.ts")
    hook_path = hook_ts if os.path.isfile(hook_ts) else os.path.join(BASE_DIR, "src/l1/sniffer/gemini/hookCredentials.js")
    with open(hook_path, "r", encoding="utf-8") as f:
        hook_code = f.read()
    assert "origFetch" in hook_code, "hookCredentials.js must guard origFetch"
    assert "origOpen" in hook_code and "origSend" in hook_code, "hookCredentials.js must guard origOpen and origSend"
    assert "RegExp.$1" not in hook_code, "hookCredentials.js must not use deprecated RegExp.$1"

    # 4. Verify geminiClient.js dynamic credential refresh on HTTP 400
    client_ts = os.path.join(BASE_DIR, "src/l1/client/gemini/geminiClient.ts")
    client_path = client_ts if os.path.isfile(client_ts) else os.path.join(BASE_DIR, "src/l1/client/gemini/geminiClient.js")
    with open(client_path, "r", encoding="utf-8") as f:
        client_code = f.read()
    assert "cachedCredentials" not in client_code, "geminiClient must not reference undefined cachedCredentials"
    assert "_retried" in client_code, "geminiClient must support automatic retry on 400 with fresh credentials"
    assert re.search(r'async\s+function\s+resolveCred\s*\(', client_code) or "resolveCred" in client_code, "geminiClient resolveCred must accept credential overrides"

    # 5. Verify background.ts/js MV3 keepalive
    bg_ts = os.path.join(BASE_DIR, "src/runtime/background/background.ts")
    bg_path = bg_ts if os.path.isfile(bg_ts) else os.path.join(BASE_DIR, "src/runtime/background/background.js")
    with open(bg_path, "r", encoding="utf-8") as f:
        bg_code = f.read()
    assert re.search(r'function\s+startKeepAlive\s*\(', bg_code) or "startKeepAlive" in bg_code, "background.js must implement startKeepAlive"
    assert "stopKeepAlive" in bg_code, "background.js must invoke and clean up keepalive in long-running jobs"

    print("  ✓ Stage 2 Architecture: Pipeline decoupling, event-driven AsyncQueue, and path sanitization verified")

def test_serial_pipeline_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_serial_pipeline.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_serial_pipeline.py failed: {res.stderr or res.stdout}"
    print("  ✓ Serial Action Pipeline & Single-Flight Executor verification passed")

def test_gemini_driver_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_gemini_driver.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_gemini_driver.py failed: {res.stderr or res.stdout}"
    print("  ✓ High-Level GeminiDriver & ChatSession test suite passed")

def test_selectors_and_gateway_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_selectors_and_gateway.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_selectors_and_gateway.py failed: {res.stderr or res.stdout}"
    print("  ✓ Central Selectors Registry & SafeInteractionGateway test suite passed")

def test_platform_driver_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_platform_driver.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_platform_driver.py failed: {res.stderr or res.stdout}"
    print("  ✓ ChatPlatformDriver ABC & ExtensionActions test suite passed")

def test_pipeline_decoupling_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_pipeline_decoupling.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_pipeline_decoupling.py failed: {res.stderr or res.stdout}"
    print("  ✓ Pipeline Decoupling & StreamSettledConfig test suite passed")

def test_visual_sandbox_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_visual_sandbox.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_visual_sandbox.py failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 3 Visual Sandbox & Autonomous QA Agent test suite passed")

def test_framework_environment_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_framework_environment.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_framework_environment.py failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 2 TestEnvironment & Unified Lifecycle test suite passed")

def test_dag_subgraph_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_dag_subgraph.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_dag_subgraph.py failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 2 Declarative DAG Scheduling & Subgraph Pruning test suite passed")

def test_tier2_assertions_suite():
    import subprocess
    res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "tests", "test_tier2_assertions.py")], capture_output=True, text=True)
    assert res.returncode == 0, f"Tier 2 assertion counterexamples failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 2 content/completeness assertions and fault counterexamples passed")
    res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "tests", "test_html_evidence.py")], capture_output=True, text=True)
    assert res.returncode == 0, f"HTML disk content assertions failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 2 physical HTML content counterexamples passed")

    res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "tests", "test_pdf_evidence.py")], capture_output=True, text=True)
    assert res.returncode == 0, f"PDF complete content assertions failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 2 PDF complete content counterexamples passed")
    res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "tests", "test_upgrade_profile.py")], capture_output=True, text=True)
    assert res.returncode == 0, f"Real profile upgrade harness guards failed: {res.stderr or res.stdout}"
    print("  ✓ Real profile upgrade harness package/profile guards passed")


def test_impact_analyzer_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_impact_analyzer.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_impact_analyzer.py failed: {res.stderr or res.stdout}"
    print("  ✓ Test Impact Analyzer & Dependency Graph test suite passed")

def run_all():
    import argparse
    import glob
    parser = argparse.ArgumentParser(description="Gemini Exporter 综合测试套件")
    parser.add_argument("--changed", action="store_true", help="仅执行当前 Git 改动及其传递依赖影响的测试")
    parser.add_argument("--filter", default=None, help="按关键字或文件名过滤单元测试 (如 --filter storage)")
    parser.add_argument("--files", nargs="*", default=None, help="显式指定目标测试文件或变更文件")
    parser.add_argument("--base", default=None, help="Git 差异基准分支 (默认 origin/main 或 main)")
    args, _ = parser.parse_known_args()

    if args.filter:
        print(f"🔍 正在按关键字过滤单元测试: '{args.filter}'")
        all_test_files = sorted(set(glob.glob(os.path.join(BASE_DIR, "tests", "*.test.js")) + glob.glob(os.path.join(BASE_DIR, "tests", "*.test.ts")) + glob.glob(os.path.join(BASE_DIR, "tests", "arch", "*.test.ts"))))
        matching = [tf for tf in all_test_files if args.filter.lower() in os.path.relpath(tf, BASE_DIR).lower()]
        if not matching:
            print(f"❌ 未找到匹配关键字 '{args.filter}' 的单元测试！")
            sys.exit(1)
        print(f"🧪 匹配到 {len(matching)} 个单元测试套件:")
        for m in matching:
            print(f"  • {os.path.relpath(m, BASE_DIR)}")
        test_javascript_unit_tests(target_tests=matching)
        print("=" * 60)
        print(f"🎉 全部 {len(matching)} 个过滤测试均顺利通过！")
        print("=" * 60)
        return

    if args.changed:
        scripts_dir = os.path.join(BASE_DIR, "scripts")
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        try:
            from test_impact_analyzer import get_git_changed_files, analyze_impact, DependencyGraph
            changed = set(args.files) if args.files else get_git_changed_files(base_ref=args.base, base_dir=BASE_DIR)
            graph = DependencyGraph(base_dir=BASE_DIR)
            result = analyze_impact(changed, graph=graph, base_dir=BASE_DIR)

            if result.is_docs_only:
                print("⚡ [增量测试] 检测到仅有文档/静态资源改动，无需执行单元测试套件。")
                print("=" * 60)
                print("🎉 ALL TESTS PASSED SUCCESSFULLY! (0s)")
                print("=" * 60)
                return

            if result.is_all_affected:
                print("⚠️ [增量测试] 检测到全局核心配置变更，回退执行全量测试套件...")
            else:
                print(f"⚡ [增量测试] 识别到 {len(result.changed_files)} 个变更文件，传递闭包覆盖 {len(result.affected_files)} 个模块。")
                print(f"🧪 即将执行 {len(result.target_unit_tests)} 个受影响单元测试套件...")

                affected = result.affected_files
                # 执行关联的 Python 规格断言套件
                if any("manifest.json" in f or "package.json" in f for f in affected):
                    test_json_files()
                    test_manifest_structure()
                if any("build.js" in f or "package.json" in f for f in affected):
                    test_build_pipeline()
                if any("options.html" in f or "popup.html" in f for f in affected):
                    test_html_includes()
                if any("locales" in f for f in affected):
                    test_i18n_keys()
                if any(x in f for f in affected for x in ["badgeView", "content.css", "pageObserver", "syncEngine"]):
                    test_content_badge_flicker_prevention()
                if any(x in f for f in affected for x in ["storageService", "conversationsStore"]):
                    test_account_uuid_storage_boundary()
                if any("test_live_chat_and_export.py" in f for f in affected):
                    test_custom_dataset_loading()
                if any("scenario" in f for f in affected):
                    test_scenario_pool_pipeline()
                    test_online_scenario_provider_and_lifecycle_tracker()
                if any(x in f for f in affected for x in ["tourGuide", "options.css", "dialogView"]):
                    test_tour_status_indicator_styling()
                    test_takeout_limit_modal_and_wall_detection()
                if any(x in f for f in affected for x in ["background", "takeoutEngine", "syncEngine"]):
                    test_stage1_architecture_ssot_and_state_isolation()
                if any(x in f for f in affected for x in ["writers", "exportOrchestrator", "geminiClient", "hookCredentials"]):
                    test_stage2_architecture_improvements()
                if any("pipeline" in f for f in affected):
                    test_serial_pipeline_suite()
                    test_pipeline_decoupling_suite()
                if any("driver" in f for f in affected):
                    test_gemini_driver_suite()
                    test_platform_driver_suite()
                if any("selectors" in f for f in affected):
                    test_selectors_and_gateway_suite()
                if any("env" in f for f in affected):
                    test_framework_environment_suite()
                if any(x in f for f in affected for x in ["framework", "dag", "cases"]):
                    test_dag_subgraph_suite()
                    test_tier2_assertions_suite()
                if any("impact_analyzer" in f for f in affected):
                    test_impact_analyzer_suite()

                test_javascript_syntax()
                test_javascript_unit_tests(target_tests=result.target_unit_tests)
                print("=" * 60)
                print(f"🎉 全部受影响单元测试 ({len(result.target_unit_tests)} 个套件) 均顺利通过！")
                print("=" * 60)
                return
        except Exception as e:
            print(f"⚠️ 依赖分析器出现异常 ({e})，回退执行全量测试套件...")

    # 全量默认执行路径 (Backward Compatible)
    test_json_files()
    test_manifest_structure()
    test_build_pipeline()
    test_html_includes()
    test_i18n_keys()
    test_content_badge_flicker_prevention()
    test_account_uuid_storage_boundary()
    test_custom_dataset_loading()
    test_scenario_pool_pipeline()
    test_online_scenario_provider_and_lifecycle_tracker()
    test_tour_status_indicator_styling()
    test_takeout_limit_modal_and_wall_detection()
    test_stage1_architecture_ssot_and_state_isolation()
    test_storage_keys_and_constants_ssot()
    test_stage2_architecture_improvements()
    test_serial_pipeline_suite()
    test_gemini_driver_suite()
    test_selectors_and_gateway_suite()
    test_platform_driver_suite()
    test_pipeline_decoupling_suite()
    test_visual_sandbox_suite()
    test_framework_environment_suite()
    test_dag_subgraph_suite()
    test_tier2_assertions_suite()
    test_impact_analyzer_suite()
    test_javascript_syntax()
    test_javascript_unit_tests()

    print("=" * 60)
    print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_all()
