#!/usr/bin/env python3
"""
scripts/parser_migration/test_provenance.py
-------------------------------------------
CLI tool for inspecting and verifying test provenance classification (Section 5 & 21).

Usage:
  python3 scripts/parser_migration/test_provenance.py --summary
  python3 scripts/parser_migration/test_provenance.py --tier P0
  python3 scripts/parser_migration/test_provenance.py --domain markdown
"""

import os
import sys
import json
import argparse

REPO_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST_PATH = os.path.join(REPO_DIR, "scripts", "parser_migration", "test_provenance_manifest.json")

def load_manifest():
    if not os.path.isfile(MANIFEST_PATH):
        print(f"Error: Manifest not found at {MANIFEST_PATH}", file=sys.stderr)
        sys.exit(1)
    with open(MANIFEST_PATH, "r", encoding="utf-8") as fp:
        return json.load(fp)

def print_summary(manifest):
    print("=" * 65)
    print("📋 Gemini Exporter — Test Provenance Classification Summary")
    print("=" * 65)
    summary = manifest.get("summary", {})
    print(f"Total Audited Suites: {summary.get('totalSuites', len(manifest['suites']))}")
    print(f"Total Audited Tests:  {summary.get('totalTests', sum(s['testCount'] for s in manifest['suites']))}\n")

    print("📊 By Provenance Tier:")
    defs = manifest.get("classificationDefinitions", {})
    by_tier = summary.get("byClassification", {})
    for tier in ["P0", "P1", "P2", "P3", "P4"]:
        count = by_tier.get(tier, 0)
        desc = defs.get(tier, "")
        prefix = desc.split(":")[0] if ":" in desc else tier
        print(f"  [{tier}] {count:3d} tests — {prefix}")

    print("\n📦 By Target Domain:")
    by_domain = {}
    for s in manifest["suites"]:
        d = s.get("domain", "unknown")
        by_domain[d] = by_domain.get(d, 0) + s.get("testCount", 0)
    for d, c in sorted(by_domain.items()):
        print(f"  • {d:15s}: {c:3d} tests")
    print("=" * 65)

def list_suites(manifest, filter_tier=None, filter_domain=None):
    suites = manifest["suites"]
    if filter_tier:
        suites = [s for s in suites if s.get("classification") == filter_tier.upper()]
    if filter_domain:
        suites = [s for s in suites if s.get("domain") == filter_domain.lower()]

    title = f"Suites matching (tier={filter_tier or 'ANY'}, domain={filter_domain or 'ANY'}): {len(suites)} suites"
    print("\n" + title)
    print("-" * len(title))
    for s in suites:
        print(f"[{s['classification']}] {s['file']} ({s['testCount']} tests)")
        print(f"    Policy: {s['policy']}")
        print(f"    Source: {s['provenanceSource']}")
        print(f"    Notes:  {s['notes']}\n")

def main():
    parser = argparse.ArgumentParser(description="Test Provenance Classification Inspector")
    parser.add_argument("--summary", action="store_true", help="Print overall provenance summary")
    parser.add_argument("--tier", choices=["P0", "P1", "P2", "P3", "P4"], help="Filter by tier")
    parser.add_argument("--domain", choices=["markdown", "latex", "canonical_ast", "typst_payload"], help="Filter by domain")
    args = parser.parse_args()

    manifest = load_manifest()
    if args.tier or args.domain:
        list_suites(manifest, filter_tier=args.tier, filter_domain=args.domain)
    else:
        print_summary(manifest)

if __name__ == "__main__":
    main()
