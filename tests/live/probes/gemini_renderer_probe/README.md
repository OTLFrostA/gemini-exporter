# Gemini renderer probe

Read [REPORT.md](REPORT.md) for the observed production behavior and evidence hashes.
The probe is read-only and uses the project's existing Chrome 9222 profile and CDP client.

1. Open the project's test Chrome and sign in to Gemini.
2. Run `python3 tests/live/probes/gemini_renderer_probe/probe.py CASE CHAT_URL NEEDLE` for each historical conversation. The script reloads the chat, intercepts only `data-math` assignments and reachable global KaTeX calls, and writes DOM/stack/resource evidence under `artifacts/gemini-renderer-probe/CASE/`.
3. If exact RPC source is needed, run `capture_rpc.cjs MAIN_CHECKOUT CASE_OUTPUT MARKER` from a checkout with `@playwright/test` installed, then `extract_rpc.py CASE_OUTPUT MARKER [DEST_OUTPUT]`. `capture_rpc.cjs` retains only matching `batchexecute` response bodies.
4. Run `compare.cjs ARTIFACT_ROOT` from the main checkout with `node -r ./tests/ts_register.js` to produce the current MDAST/Canonical comparison from `raw.md`.

`extract_exported_snippets.py` separately preserves contiguous Tier 2 export lines as provenance references. Those files are not treated as RPC raw source. Captured responses, DOM and proprietary JS chunks remain ignored local artifacts.
