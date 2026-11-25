import glob
import json
import os
import sys
from pathlib import Path

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

ISOLATED_SUITE_MARKERS = (
    "helpers/l1V2UnitMocks",
    "before(",
    "after(",
    "beforeEach(",
    "afterEach(",
    "mock.",
    "Module._",
    "require.cache",
    "fake-indexeddb",
    "useStorageUnitEnvironment",
    "indexStorage",
    "installDomainStorage",
    "installApplicationHost",
    "installProviderHost",
    "globalThis.",
    "global.",
    "Object.defineProperty(globalThis",
    "Object.defineProperty(chrome",
    "process.env.",
    "process.chdir",
    "resetMitexForTesting",
)


def test_javascript_syntax():
    if os.environ.get("GEMINI_SKIP_REDUNDANT_TSC") == "1":
        print("  ✓ TypeScript strict syntax already validated upstream (skipped duplicate tsc)")
        return
    import subprocess
    import shutil
    node_bin = None
    for cand in [
        shutil.which("node"),
        os.path.expanduser("~/.local/node/bin/node"),
        os.path.expanduser("~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"),
        r"C:\Program Files\nodejs\node.exe",
    ]:
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
    print("  ✓ TypeScript strict syntax validated (tsc --noEmit)")


def discover_unit_tests():
    return sorted(
        str(path) for path in Path(BASE_DIR, "tests").rglob("*")
        if path.is_file()
        and path.name.endswith((".test.js", ".test.ts", ".test.cjs"))
        and "e2e" not in path.relative_to(Path(BASE_DIR, "tests")).parts
    )


def test_javascript_unit_tests(target_tests=None):
    test_files = discover_unit_tests()
    if target_tests is not None:
        norm_targets = {os.path.normpath(os.path.join(BASE_DIR, t)) for t in target_tests}
        missing = norm_targets - set(test_files)
        assert not missing, f"Selected unit suites were not discovered: {sorted(missing)}"
        test_files = [tf for tf in test_files if tf in norm_targets]
        if not test_files:
            print("  ✓ 无受影响的 JavaScript/TypeScript 单元测试需要执行。")
    return run_javascript_unit_tests(test_files)


def classify_suite(tf):
    with open(tf, encoding="utf-8") as source_file:
        source_text = source_file.read()
    isolated_l1 = "helpers/l1V2UnitMocks.js" in source_text
    launches_browser = (
        "chromium.launch" in source_text
        or "@playwright/test" in source_text
        or "from 'playwright'" in source_text
        or 'from "playwright"' in source_text
        or "import('playwright')" in source_text
        or 'import("playwright")' in source_text
    )
    uses_wasm = "realWasmSandbox" in source_text
    is_isolated = (
        tf.endswith(".test.cjs")
        or isolated_l1
        or launches_browser
        or any(marker in source_text for marker in ISOLATED_SUITE_MARKERS)
    )
    return is_isolated, isolated_l1, launches_browser, uses_wasm


def run_javascript_unit_tests(test_files):
    if not test_files:
        return 0

    import subprocess
    import shutil
    import concurrent.futures
    import threading
    import time

    node_bin = next((candidate for candidate in [
        shutil.which("node"),
        os.path.expanduser("~/.local/node/bin/node"),
        os.path.expanduser("~/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe"),
        r"C:\Program Files\nodejs\node.exe",
    ] if candidate and os.path.exists(candidate)), None)
    assert node_bin, "Node.js is required for the TypeScript unit test suite"

    register_hook = os.path.join(BASE_DIR, "tests", "ts_register.js")
    preload_hook = os.path.join(BASE_DIR, "tests", "helpers", "l1V2UnitPreload.cjs")
    batch_runner = os.path.join(BASE_DIR, "tests", "run_unit_batch.cjs")

    env_workers = os.environ.get("GEMINI_TEST_WORKERS")
    max_workers = max(1, int(env_workers)) if env_workers and env_workers.isdigit() else min(os.cpu_count() or 4, 6)
    browser_sem = threading.Semaphore(2)

    def run_single_suite(tf, isolated_l1=False, launches_browser=False):
        rel = os.path.relpath(tf, BASE_DIR)
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
        return [(rel, res)]

    def run_batch(batch_files):
        if len(batch_files) == 1 or not os.path.exists(batch_runner) or not os.path.exists(register_hook):
            return [item for tf in batch_files for item in run_single_suite(tf)]
        env = {**os.environ, "GEMINI_UNIT_BATCH": json.dumps(batch_files)}
        cmd = [node_bin, "-r", register_hook, "--test", batch_runner]
        res = subprocess.run(cmd, cwd=BASE_DIR, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace")
        if res.returncode == 0:
            return [(os.path.relpath(tf, BASE_DIR), res) for tf in batch_files]
        # Pinpoint exact failing file(s) without cross-file state if a batch failed.
        return [item for tf in batch_files for item in run_single_suite(tf)]

    started = time.monotonic()
    isolated_tasks = []
    pure_wasm_files = []
    pure_standard_files = []

    for tf in test_files:
        is_isolated, isolated_l1, launches_browser, uses_wasm = classify_suite(tf)
        if is_isolated or len(test_files) <= 4 or max_workers == 1:
            isolated_tasks.append((tf, isolated_l1, launches_browser))
        elif uses_wasm:
            pure_wasm_files.append(tf)
        else:
            pure_standard_files.append(tf)

    batches = []
    if pure_wasm_files:
        wasm_shards = min(2, len(pure_wasm_files))
        for i in range(wasm_shards):
            batches.append(pure_wasm_files[i::wasm_shards])
    if pure_standard_files:
        std_shards = min(max_workers, max(1, (len(pure_standard_files) + 24) // 25))
        for i in range(std_shards):
            shard = pure_standard_files[i::std_shards]
            if shard:
                batches.append(shard)

    failures = []
    if max_workers == 1:
        for tf, isolated_l1, launches_browser in isolated_tasks:
            for rel, res in run_single_suite(tf, isolated_l1, launches_browser):
                if res.returncode != 0:
                    failures.append((rel, res))
                    break
                print(f"  ✓ Unit test suite passed: {rel}")
            if failures:
                break
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(run_batch, b) for b in batches]
            futures.extend(
                pool.submit(run_single_suite, tf, isolated_l1, launches_browser)
                for tf, isolated_l1, launches_browser in isolated_tasks
            )
            for fut in futures:
                for rel, res in fut.result():
                    if res.returncode != 0:
                        failures.append((rel, res))
                    else:
                        print(f"  ✓ Unit test suite passed: {rel}")

    if failures:
        rel, res = failures[0]
        assert False, f"Unit test failed in {rel}:\n{res.stdout}\n{res.stderr}"
    elapsed = time.monotonic() - started
    print(f"  ⚡ Executed {len(test_files)} unit suites in {elapsed:.1f}s (workers={max_workers}, batches={len(batches)}, isolated={len(isolated_tasks)})")
    return len(test_files)


def run_python_unit_tests(test_files):
    import subprocess

    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(filter(None, (BASE_DIR, TESTS_DIR, env.get("PYTHONPATH"))))
    for test_file in test_files:
        rel = os.path.relpath(test_file, BASE_DIR)
        result = subprocess.run(
            [sys.executable, "-m", "unittest", rel], cwd=BASE_DIR, env=env,
        )
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
    node_tests = {path for path in discover_unit_tests() if matches(path)}

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
    parser = argparse.ArgumentParser(description="Gemini Exporter 单元测试套件")
    parser.add_argument("--changed", action="store_true", help="仅执行当前 Git 改动及其传递依赖影响的测试")
    parser.add_argument("--filter", default=None, help="按关键字或文件名过滤单元测试 (如 --filter storage)")
    parser.add_argument("--files", nargs="*", default=None, help="显式指定目标测试文件或变更文件")
    parser.add_argument("--base", default=None, help="Git 差异基准分支 (默认 origin/main 或 main)")
    parser.add_argument("--skip-typecheck", action="store_true", help="跳过重复的 tsc --noEmit 检查")
    args, _ = parser.parse_known_args()
    if args.skip_typecheck:
        os.environ["GEMINI_SKIP_REDUNDANT_TSC"] = "1"

    if args.filter:
        run_filtered_unit_tests(args.filter)
        return

    if args.changed:
        scripts_dir = os.path.join(BASE_DIR, "scripts")
        if scripts_dir not in sys.path:
            sys.path.insert(0, scripts_dir)
        try:
            from test_impact_analyzer import get_git_changed_files, analyze_impact, DependencyGraph, GitChangeError
            try:
                changed = set(args.files) if args.files else get_git_changed_files(base_ref=args.base, base_dir=BASE_DIR)
            except GitChangeError as e:
                parser.exit(1, f"Error: {e}\n")
            graph = DependencyGraph(base_dir=BASE_DIR)
            result = analyze_impact(changed, graph=graph, base_dir=BASE_DIR)
        except Exception as e:
            print(f"⚠️ 依赖分析器出现异常 ({e})，回退执行全量测试套件...")
        else:
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

                import subprocess
                python_tests = [f for f in result.target_unit_tests if f.endswith(".py")]
                for test_file in python_tests:
                    print(f"🧪 Python: {test_file}", flush=True)
                    test_env = os.environ.copy()
                    test_dir = os.path.dirname(os.path.join(BASE_DIR, test_file))
                    test_env["PYTHONPATH"] = os.pathsep.join(filter(None, [BASE_DIR, test_dir, test_env.get("PYTHONPATH")]))
                    res = subprocess.run([sys.executable, "-m", "unittest", test_file], cwd=BASE_DIR, env=test_env)
                    if res.returncode != 0:
                        sys.exit(res.returncode)

                test_javascript_syntax()
                executed = len(python_tests) + test_javascript_unit_tests(
                    target_tests=[f for f in result.target_unit_tests if not f.endswith(".py")]
                )
                print("=" * 60)
                print(f"🎉 全部受影响单元测试 ({executed} 个套件) 均顺利通过！")
                print("=" * 60)
                return

    test_javascript_syntax()
    test_javascript_unit_tests()

    print("=" * 60)
    print("🎉 ALL TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_all()
