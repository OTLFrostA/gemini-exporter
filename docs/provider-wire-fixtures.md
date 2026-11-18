# Preparing native provider fixtures

Use a dedicated QA conversation with publishable prompts and replies. Save only the native **response body** in an ignored local directory. Capture an independent expectation from the provider page at the same time: for example the selected branch, visible prompt and answer, questionnaire labels, or expected attachment ownership. A response body and its hash identify the input; a meaningful regression test also needs this independent expected behavior.

For ChatGPT, use the successful conversation Detail response (`GET /backend-api/conversation/:id`). For Claude, use the conversation Detail response for the test organization (`GET /api/organizations/:org/chat_conversations/:id`). For Grok, keep the metadata, response tree, and response bodies identified separately. The endpoint generators accept fixture bodies, so session data, request headers, cookies, and HARs do not belong in the fixture workflow.

For JSON and JSON-bearing SSE, prepare a local redaction plan. For example:

```json
{
  "aliases": { "source-node-id": "fixture-node-id" },
  "redact": [
    { "pointer": "/mapping/source-node-id/message/content/parts/0" },
    { "pointer": "/asset/download_url", "replacement": "https://example.test/asset.png" }
  ]
}
```

```sh
node -r ./tests/ts_register.js scripts/sanitize_provider_wire.ts \
  --format json --plan temp/redaction-plan.json temp/raw-detail.json temp/review-detail.json
```

Pointers follow the original document (including original keys); use `~0` for `~` and `~1` for `/`. Aliases match whole strings and object keys, so the same synthetic ID can replace a tree key and its references. A pointer without `replacement` masks each symbol with a symbol of the same UTF-8 and UTF-16 widths, keeping common markup punctuation. Use explicit replacements for locators and maintain any relevant offsets if the replacement changes length. With `--format sse`, prefix pointers with a zero-based JSON event index, excluding comments and `[DONE]`. The command rejects stale rules, unsupported SSE fields, malformed inputs, and an existing output path.

Gemini `batchexecute` has a separate preparation tool: `node -r ./tests/ts_register.js scripts/sanitize_gemini_wire.ts INPUT OUTPUT --mode tokens_and_urls` for preapproved QA prose. Its `full` mode masks some text but still retains selected wire values. Both tools prepare a review copy; review the entire result, including nested metadata and any strings containing embedded documents, before moving it under `tests/fixtures/`. Use invented QA inputs if the source contains private prose.

Register the reviewed body as `captured` in its endpoint generator, then exercise retrieval and export outcomes with fixture transport at the edge. If a response was rebuilt around a captured fragment, register it as `derived`. Record the SHA-256 of the checked-in bytes when adding a P0 provenance entry; it verifies the submitted bytes, not their origin. An authorization error or login screen supplies no capture evidence.
