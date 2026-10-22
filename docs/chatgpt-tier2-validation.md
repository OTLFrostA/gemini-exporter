# ChatGPT live validation (2026-10-22)

Run the provider suite against the logged-in staging Chrome on port 9222:

```sh
npm run test:tier2 -- --provider chatgpt
```

The ChatGPT suite covers complex 5- and 8-round conversations, passive local
save and promotion, request-confirmed remote deletion and same-key local cleanup,
popup download, scan, and physical Markdown/HTML/JSON/PDF exports. Gemini's
existing full suite remains separate, including its Takeout workflow.

## Recorded validation

This development session completed acceptance through repaired continuations;
it was **not one uninterrupted clean Tier 2 run**. Earlier failed reports remain
in the local evidence directory. The complex source conversations ultimately
contained 7 and 8 rounds after lifecycle revisits.

- Live disk save, old-conversation promotion without workbench reload, confirmed
  native deletion of Index/Detail/ExportRecord, and popup export passed.
- All 12 local conversations were physically downloaded in all four formats:
  zero skipped conversations and zero export failures. Two old deletion probes
  remain local from before the capture fix; list absence does not authorize deletion.
- Independent source evidence verified complete text, code and math in the two
  complex conversations. The generated-image golden matched exported pixels.
- Both questionnaire goldens retained their questions/options and usable
  fallback, with complete source coverage. Interactive behavior is not replayed.
- Visual review covered all 12 PDFs (166 pages) and 12 HTML documents (306
  viewport/wide-region captures). Unchanged HTML captures were reused only on
  exact PNG SHA-256 equality with the previous completed visual review.
- Full `npm test` passed, including 163 Playwright tests with 1 skip.
- The scenario pool was replenished to 20 entries.

The network observer recorded 13 HTTP 429 responses during this debugging
window: 4 native ads/sync requests, 4 native plural-conversation requests, 3
independent source-evidence reads, and 2 extension golden-image detail refreshes
before the resource-acquisition fix. No 429 was recorded during the final
four-format export window. This is observational evidence, not a guarantee
against future provider throttling.

Private source snapshots, downloads and screenshots are intentionally ignored
under `tests/output/chatgpt_full_20261022/`. Its `COMPLETION.md`,
`completion-report.json`, per-stage reports, network JSONL and visual review
ledger preserve the detailed evidence.
