#!/usr/bin/env python3
"""
scripts/parser_migration/extract_corpus.py
-----------------------------------------
Extracts raw Gemini conversation text and LaTeX mathematical expressions
directly from verified real Gemini sources (Section 6.1 & 6.2):
- scripts/test_scenario_pool.json (20 multi-domain production scenarios)
- tests/fixtures/gemini_takeout_clean.zip (real Takeout HTML activity)
- tests/fixtures/canonical/gemini-normalizer-sample.json (canonical sample)

ZERO OLD-PARSER INTERMEDIATES: Text is extracted as raw source strings.
Outputs to: tests/fixtures/real_gemini_corpus.json
"""

import os
import sys
import json
import zipfile
import re
from datetime import datetime

REPO_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUTPUT_PATH = os.path.join(REPO_DIR, "tests", "fixtures", "real_gemini_corpus.json")

def extract_corpus():
    pool_path = os.path.join(REPO_DIR, "scripts", "test_scenario_pool.json")
    takeout_path = os.path.join(REPO_DIR, "tests", "fixtures", "gemini_takeout_clean.zip")
    sample_path = os.path.join(REPO_DIR, "tests", "fixtures", "canonical", "gemini-normalizer-sample.json")

    documents = []

    # 1. Real Scenario Pool (20 scenarios x 5 turns = 100 turns)
    if os.path.isfile(pool_path):
        with open(pool_path, "r", encoding="utf-8") as fp:
            pool = json.load(fp)
        for sc in pool:
            sc_id = sc["id"]
            for idx, turn in enumerate(sc.get("turns", [])):
                if isinstance(turn, str) and turn.strip():
                    documents.append({
                        "id": f"pool_{sc_id}_turn{idx + 1}",
                        "source": "scenario_pool",
                        "scenarioId": sc_id,
                        "domain": sc.get("domain", "general"),
                        "features": sc.get("features", []),
                        "text": turn
                    })

    # 2. Canonical Sample Raw Payload
    if os.path.isfile(sample_path):
        with open(sample_path, "r", encoding="utf-8") as fp:
            sample = json.load(fp)
        sample_id = sample.get("id", "sample")
        for m in sample.get("messages", []):
            c = m.get("content")
            m_id = m.get("id", "msg")
            if isinstance(c, str) and c.strip():
                documents.append({
                    "id": f"sample_{sample_id}_{m_id}",
                    "source": "raw_sample",
                    "domain": "web_chat",
                    "features": ["formatting", "mixed"],
                    "text": c
                })

    # 3. Real Takeout Activity HTML
    if os.path.isfile(takeout_path):
        with zipfile.ZipFile(takeout_path) as zf:
            for name in zf.namelist():
                if name.endswith(".html"):
                    html = zf.read(name).decode("utf-8", errors="replace")
                    chunks = re.findall(r'<div class="content-cell[^"]*">([\s\S]*?)</div>', html)
                    for idx, c in enumerate(chunks):
                        clean = re.sub(r'<br\s*/?>', '\n', c)
                        clean = re.sub(r'<[^>]+>', '', clean).strip()
                        if clean and len(clean) > 5:
                            documents.append({
                                "id": f"takeout_chunk_{idx + 1}",
                                "source": "takeout_html",
                                "domain": "takeout_history",
                                "features": ["real_user_history"],
                                "text": clean
                            })

    # Mathematical expressions regex (unpolluted raw TeX extraction)
    display_re = re.compile(r"\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]")
    inline_re = re.compile(r"(?<!\\)\$(.+?)(?<!\\)\$|\\\(([\s\S]+?)\\\)")

    math_expressions = []
    seen_math = set()

    for doc in documents:
        t = doc["text"]
        # Display math first
        for m in display_re.finditer(t):
            expr = m.group(1) or m.group(2)
            if expr:
                expr_str = expr.strip()
                if expr_str and (expr_str, True) not in seen_math:
                    seen_math.add((expr_str, True))
                    math_expressions.append({
                        "id": f"math_disp_{len(math_expressions) + 1}",
                        "docId": doc["id"],
                        "latex": expr_str,
                        "display": True,
                        "source": doc["source"]
                    })

        # Remove displays, then scan inline math
        t_no_disp = display_re.sub(" ", t)
        for m in inline_re.finditer(t_no_disp):
            expr = m.group(1) or m.group(2)
            if expr:
                expr_str = expr.strip()
                # Exclude simple currency amounts like $5 or $10
                if expr_str and not re.match(r"^\d+(?:\.\d{1,2})?$", expr_str):
                    if (expr_str, False) not in seen_math:
                        seen_math.add((expr_str, False))
                        math_expressions.append({
                            "id": f"math_inline_{len(math_expressions) + 1}",
                            "docId": doc["id"],
                            "latex": expr_str,
                            "display": False,
                            "source": doc["source"]
                        })

    corpus = {
        "version": "1.0.0",
        "extractedAt": datetime.utcnow().isoformat() + "Z",
        "description": "Public sanitized real Gemini corpus extracted directly from raw sources (Section 6.3)",
        "summary": {
            "totalDocuments": len(documents),
            "totalMathExpressions": len(math_expressions),
            "displayMathCount": sum(1 for m in math_expressions if m["display"]),
            "inlineMathCount": sum(1 for m in math_expressions if not m["display"]),
            "sources": list(set(d["source"] for d in documents))
        },
        "documents": documents,
        "mathExpressions": math_expressions
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as fp:
        json.dump(corpus, fp, indent=2, ensure_ascii=False)

    print("=" * 65)
    print("📦 Real Gemini Corpus Extracted Successfully!")
    print(f"File: {os.path.relpath(OUTPUT_PATH, REPO_DIR)}")
    print(f"Total Markdown Documents:    {len(documents)}")
    print(f"Total Math Expressions:      {len(math_expressions)} (Display: {corpus['summary']['displayMathCount']}, Inline: {corpus['summary']['inlineMathCount']})")
    print(f"Sources:                     {', '.join(corpus['summary']['sources'])}")
    print("=" * 65)

if __name__ == "__main__":
    extract_corpus()
