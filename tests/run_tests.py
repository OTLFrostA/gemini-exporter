import glob
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
TESTS_DIR = os.path.join(BASE_DIR, "tests")

# Tier 1 discovers the migration wrapper; a filter can also select its source directly.
COMMONJS_SUITE_WRAPPERS = {"upgrade_v1.test.cjs": "upgrade_released_v17.test.ts"}

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
        assert not m.get("host_permissions"), "Platform origins must be optional"
        assert not m.get("content_scripts"), "Source scripts must be permission-gated dynamic registrations"
        assert "https://gemini.google.com/*" in m["optional_host_permissions"]
        assert "https://chatgpt.com/*" in m["optional_host_permissions"]
        assert "https://claude.ai/*" in m["optional_host_permissions"]
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
    #  2. data-i18n, data-i18n-title, data-i18n-placeholder and aria labels for the
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
            for attr in ("data-i18n", "data-i18n-title", "data-i18n-placeholder", "data-i18n-aria-label"):
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
    if os.environ.get("GEMINI_SKIP_REDUNDANT_TSC") == "1":
        print("  ✓ TypeScript strict syntax already validated upstream (skipped duplicate tsc)")
        return
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

def javascript_unit_test_files():
    return sorted(
        glob.glob(os.path.join(TESTS_DIR, "*.test.js"))
        + glob.glob(os.path.join(TESTS_DIR, "*.test.ts"))
        + glob.glob(os.path.join(TESTS_DIR, "arch", "*.test.ts"))
    )

def test_javascript_unit_tests(target_tests=None):
    test_files = javascript_unit_test_files()
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
    run_javascript_unit_tests(test_files)

def run_javascript_unit_tests(test_files):
    if not test_files:
        return

    import subprocess
    import shutil

    # npm test and the TypeScript require hook already require Node.
    node_bin = next((candidate for candidate in [
        shutil.which("node"),
        os.path.expanduser("~/.local/node/bin/node"),
        os.path.expanduser("~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"),
        r"C:\Program Files\nodejs\node.exe",
    ] if candidate and os.path.exists(candidate)), None)
    assert node_bin, "Node.js is required for the TypeScript unit test suite"

    register_hook = os.path.join(BASE_DIR, "tests", "ts_register.js")
    preload_hook = os.path.join(BASE_DIR, "tests", "helpers", "l1V2UnitPreload.cjs")

    import concurrent.futures
    import threading
    import time

    env_workers = os.environ.get("GEMINI_TEST_WORKERS")
    max_workers = max(1, int(env_workers)) if env_workers and env_workers.isdigit() else min(os.cpu_count() or 4, 6)
    # Limit concurrent headless Chromium launches inside Node unit files so UI timing assertions never starve.
    browser_sem = threading.Semaphore(2)

    def run_single_suite(tf):
        rel = os.path.relpath(tf, BASE_DIR)
        with open(tf, encoding="utf-8") as source_file:
            source_text = source_file.read()
        isolated_l1 = "helpers/l1V2UnitMocks.js" in source_text
        launches_browser = "chromium.launch" in source_text or "@playwright/test" in source_text
        if isolated_l1:
            cmd = [node_bin, "-r", register_hook, "-r", preload_hook, "--test", tf]
        elif os.path.exists(register_hook):
            cmd = [node_bin, "-r", register_hook, "--test", tf]
        else:
            cmd = [node_bin, "--test", tf]

        if launches_browser:
            with browser_sem:
                res = subprocess.run(cmd, cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace")
        else:
            res = subprocess.run(cmd, cwd=BASE_DIR, capture_output=True, text=True, encoding="utf-8", errors="replace")
        return rel, res

    started = time.monotonic()
    failures = []
    if len(test_files) <= 1 or max_workers == 1:
        for tf in test_files:
            rel, res = run_single_suite(tf)
            if res.returncode != 0:
                failures.append((rel, res))
                break
            print(f"  ✓ Unit test suite passed: {rel}")
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
            ordered_futures = [pool.submit(run_single_suite, tf) for tf in test_files]
            for fut in ordered_futures:
                rel, res = fut.result()
                if res.returncode != 0:
                    failures.append((rel, res))
                else:
                    print(f"  ✓ Unit test suite passed: {rel}")

    if failures:
        rel, res = failures[0]
        assert False, f"Unit test failed in {rel}:\n{res.stdout}\n{res.stderr}"
    elapsed = time.monotonic() - started
    print(f"  ⚡ Executed {len(test_files)} unit suites in {elapsed:.1f}s (workers={max_workers})")

def test_content_badge_flicker_prevention():
    """Verify Badge visual layout invariants in CSS; runtime Badge behavior is covered by ui_v2 suites."""
    css_path = os.path.join(BASE_DIR, "src/ui/badge/content.css")
    with open(css_path, "r", encoding="utf-8") as f:
        css = f.read()
    assert "white-space: nowrap" in css, "Badge must not wrap while its count changes"
    assert "min-width:" in css, "Badge keeps a stable minimum width"
    assert ".syncing .pulse" in css, "Badge retains its visual sync feedback"
    assert re.search(r'#geminiExportBadge\s+\.pulse\s*\{[^}]*background:\s*#06b6d4', css), "Idle pulse must remain visually stable"
    print("  ✓ V2 Badge visual CSS layout invariants verified")

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
    # The final v2 cutout CSS rule overrides the earlier generic overlay rule.
    # Inspect the effective cascade; popover attributes span two rule blocks.
    containers = re.findall(r'\.tour-overlay-container\s*\{([^}]+)', css)
    popovers = re.findall(r'\.tour-popover\s*\{([^}]+)', css)
    assert containers and popovers, 'Tour overlay and popover CSS must exist'
    container = containers[-1]
    popover = ''.join(popovers)
    assert "pointer-events:none" in container.replace(" ", ""), "Cutout must pass business clicks to its target"
    assert "pointer-events:auto" in popover.replace(" ", ""), "Popover controls must stay operable"
    assert "max-height:" in popover and "overflow:auto" in popover.replace(" ", ""), "Small viewports must retain all Tour actions"
    print("  ✓ Current Tour cutout and viewport CSS invariants verified")


def test_storage_keys_and_constants_ssot():
    """Verify retired V1 global session/database keys do not reappear and packaging script remains wired."""
    def source(path):
        with open(os.path.join(BASE_DIR, path), encoding="utf-8") as f:
            return f.read()

    exporter = source("src/application/export/runExport.ts") + "\n" + source("src/application/export/exportPipeline.ts")
    constants = source("src/shared/utils/constants.ts")
    assert "LAST_EXPORT_SESSION" not in exporter, "Export must not use persistent V1 sessions"
    assert "IDB_DATABASES" not in constants, "Shared constants must not duplicate L3a database configuration"

    build = source("build.js")
    package = source("package.json")
    assert "--pack" in build, "Build must support packaging"
    assert '"package":' in package, "package.json must expose packaging"
    print("  ✓ Retired V1 storage keys absent and build packaging verified")

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
    res = subprocess.run([sys.executable, "-m", "unittest", "tests.test_chrome_diagnostics"],
                         cwd=BASE_DIR, capture_output=True, text=True)
    assert res.returncode == 0, f"Chrome launch/diagnostics regression checks failed: {res.stderr or res.stdout}"
    print("  ✓ Background Chrome launcher & diagnostics regression checks passed")

def test_tier2_platforms_suite():
    import subprocess
    res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "tests", "test_tier2_platforms.py")],
                         capture_output=True, text=True)
    assert res.returncode == 0, f"test_tier2_platforms.py failed: {res.stderr or res.stdout}"
    print("  ✓ Platform-independent Tier 2 plugin orchestration passed")

def test_dag_subgraph_suite():
    import subprocess
    cmd = [sys.executable, os.path.join(BASE_DIR, "tests", "test_dag_subgraph.py")]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"test_dag_subgraph.py failed: {res.stderr or res.stdout}"
    print("  ✓ Tier 2 Declarative DAG Scheduling & Subgraph Pruning test suite passed")

def test_tier2_assertions_suite():
    import subprocess
    res = subprocess.run([sys.executable, os.path.join(BASE_DIR, "tests", "test_integrity_model.py")], capture_output=True, text=True)
    assert res.returncode == 0, f"Frozen evidence validation failed: {res.stderr or res.stdout}"
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

def run_python_unit_tests(test_files):
    import subprocess

    for test_file in test_files:
        rel = os.path.relpath(test_file, BASE_DIR)
        result = subprocess.run([sys.executable, "-m", "unittest", rel], cwd=BASE_DIR)
        if result.returncode:
            sys.exit(result.returncode)
        print(f"  ✓ Unit test suite passed: {rel}")

def run_filtered_unit_tests(keyword):
    print(f"🔍 正在按关键字过滤单元测试: '{keyword}'")
    normalized_keyword = keyword.replace("\\", "/").lower()

    def matches(path):
        return normalized_keyword in os.path.relpath(path, BASE_DIR).replace(os.sep, "/").lower()

    python_tests = sorted({
        path for pattern in ("test_*.py", "*_test.py")
        for path in glob.glob(os.path.join(TESTS_DIR, pattern))
        if matches(path)
    })
    node_tests = {
        path for path in (
            javascript_unit_test_files()
            + glob.glob(os.path.join(TESTS_DIR, "*.test.cjs"))
            + glob.glob(os.path.join(TESTS_DIR, "arch", "*.test.cjs"))
        ) if matches(path)
    }
    for source, wrapper in COMMONJS_SUITE_WRAPPERS.items():
        if os.path.join(TESTS_DIR, source) in node_tests:
            node_tests.discard(os.path.join(TESTS_DIR, wrapper))

    matching = sorted([*python_tests, *node_tests])
    if not matching:
        print(f"❌ 未找到匹配关键字 '{keyword}' 的单元测试！")
        sys.exit(1)
    print(f"🧪 匹配到 {len(matching)} 个单元测试套件:")
    for path in matching:
        print(f"  • {os.path.relpath(path, BASE_DIR)}")
    sys.stdout.flush()
    run_python_unit_tests(python_tests)
    run_javascript_unit_tests(sorted(node_tests))
    print("=" * 60)
    print(f"🎉 全部 {len(matching)} 个过滤测试均顺利通过！")
    print("=" * 60)

def run_all():
    import argparse
    parser = argparse.ArgumentParser(description="Gemini Exporter 综合测试套件")
    parser.add_argument("--changed", action="store_true", help="仅执行当前 Git 改动及其传递依赖影响的测试")
    parser.add_argument("--filter", default=None, help="按关键字或文件名过滤单元测试 (如 --filter storage)")
    parser.add_argument("--files", nargs="*", default=None, help="显式指定目标测试文件或变更文件")
    parser.add_argument("--base", default=None, help="Git 差异基准分支 (默认 origin/main 或 main)")
    args, _ = parser.parse_known_args()

    if args.filter:
        run_filtered_unit_tests(args.filter)
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
                    test_tier2_platforms_suite()
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
    test_storage_keys_and_constants_ssot()
    test_serial_pipeline_suite()
    test_gemini_driver_suite()
    test_selectors_and_gateway_suite()
    test_platform_driver_suite()
    test_pipeline_decoupling_suite()
    test_visual_sandbox_suite()
    test_framework_environment_suite()
    test_tier2_platforms_suite()
    test_dag_subgraph_suite()
    test_tier2_assertions_suite()
    test_impact_analyzer_suite()
    run_python_unit_tests([os.path.join(TESTS_DIR, "test_run_tests_filter.py")])
    test_javascript_syntax()
    test_javascript_unit_tests()

    print("=" * 60)
    print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_all()
