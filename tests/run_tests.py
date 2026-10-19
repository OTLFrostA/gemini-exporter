#!/usr/bin/env python3
"""Tier 1 entry: active Node contracts and offline Python harness unit tests.
Retired v1 source-text assertions are replaced by behavioral v2 suites.
"""
import argparse
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
from test_impact_analyzer import DependencyGraph, analyze_impact, get_git_changed_files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--filter', default='')
    parser.add_argument('--changed', action='store_true')
    parser.add_argument('--files', nargs='*')
    parser.add_argument('--base')
    args = parser.parse_args()
    files = sorted(str(p.relative_to(ROOT)) for directory in [ROOT / 'tests', ROOT / 'tests/arch']
                   for p in directory.iterdir() if p.name.endswith(('.test.ts', '.test.cjs')))
    if args.changed:
        changes = args.files if args.files is not None else get_git_changed_files(base_ref=args.base, base_dir=str(ROOT))
        impact = analyze_impact(set(changes), graph=DependencyGraph(base_dir=str(ROOT)), base_dir=str(ROOT))
        files = [file for file in files if file in impact.target_unit_tests]
    if args.filter:
        files = [file for file in files if args.filter in file]
    if files:
        subprocess.run(['node', 'scripts/test-unit.cjs', *files], cwd=ROOT, check=True)
    elif args.filter:
        parser.error('No active unit suite matches --filter')
    # Separate processes avoid helper modules shadowing Python test filenames.
    for file in sorted((ROOT / 'tests').glob('test_*.py')):
        if args.filter and args.filter not in file.name:
            continue
        subprocess.run([sys.executable, str(file)], cwd=ROOT, check=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
