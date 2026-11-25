#!/usr/bin/env python3
"""
scripts/run_harness_tests.py
----------------------------
Dedicated runner for Tier 2 / Tier 3 / tooling harness self-tests:
  1. All Python unittest suites in tests/ (`test_*.py` and `*_test.py`)
  2. Tier 2 browser probe Playwright specs (`tests/e2e/tier2_*.spec.ts`)
"""

import argparse
import concurrent.futures
import glob
import os
import subprocess
import sys
import time

REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS_DIR = os.path.join(REPO_DIR, "tests")


def discover_python_harness_suites():
    return sorted({
        path for pattern in ("test_*.py", "*_test.py")
        for path in glob.glob(os.path.join(TESTS_DIR, pattern))
        if os.path.isfile(path)
    })


def discover_tier2_e2e_specs():
    return sorted(
        os.path.relpath(path, REPO_DIR).replace(os.sep, "/")
        for path in glob.glob(os.path.join(TESTS_DIR, "e2e", "tier2_*.spec.ts"))
        if os.path.isfile(path)
    )


def run_python_suites(suites):
    if not suites:
        return
    env = os.environ.copy()
    env["PYTHONPATH"] = os.pathsep.join(filter(None, (REPO_DIR, TESTS_DIR, env.get("PYTHONPATH"))))
    max_workers = min(os.cpu_count() or 4, 6)
    started = time.monotonic()

    def run_one(suite_path):
        rel = os.path.relpath(suite_path, REPO_DIR).replace(os.sep, "/")
        res = subprocess.run(
            [sys.executable, "-m", "unittest", rel],
            cwd=REPO_DIR,
            env=env,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return rel, res

    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = [pool.submit(run_one, s) for s in suites]
        for fut in futures:
            rel, res = fut.result()
            if res.returncode != 0:
                failures.append((rel, res))
            else:
                print(f"  ✓ Python harness suite passed: {rel}")

    if failures:
        rel, res = failures[0]
        print(f"❌ Python harness suite failed: {rel}\n{res.stdout}\n{res.stderr}", file=sys.stderr)
        sys.exit(res.returncode)

    elapsed = time.monotonic() - started
    print(f"  ⚡ Executed {len(suites)} Python harness suites in {elapsed:.1f}s")


def run_tier2_e2e_specs(specs):
    if not specs:
        return
    print(f"\n🎭 Running {len(specs)} Tier 2 Playwright harness probe specs...")
    build_res = subprocess.run(["node", "build.js"], cwd=REPO_DIR)
    if build_res.returncode != 0:
        sys.exit(build_res.returncode)

    env = {**os.environ, "RUN_HARNESS_E2E": "1"}
    res = subprocess.run(["npx", "playwright", "test", *specs], cwd=REPO_DIR, env=env)
    if res.returncode != 0:
        sys.exit(res.returncode)


def main():
    parser = argparse.ArgumentParser(description="Run Python tooling & Tier 2/3 harness self-tests")
    parser.add_argument("--python-only", action="store_true", help="Run only Python unittest suites (skip Playwright Tier 2 probe specs)")
    parser.add_argument("--e2e-only", action="store_true", help="Run only Playwright Tier 2 probe specs")
    args = parser.parse_args()

    print("=" * 60)
    print(" Gemini Exporter - Tooling & Tier 2/3 Harness Self-Tests")
    print("=" * 60)

    if not args.e2e_only:
        py_suites = discover_python_harness_suites()
        run_python_suites(py_suites)

    if not args.python_only:
        e2e_specs = discover_tier2_e2e_specs()
        run_tier2_e2e_specs(e2e_specs)

    print("=" * 60)
    print("🎉 ALL HARNESS TESTS PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    main()
