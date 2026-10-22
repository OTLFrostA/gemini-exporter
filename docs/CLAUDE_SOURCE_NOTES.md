# Claude source adapter — attribution and limitations

This provider is an independent implementation for Gemini Exporter v2, informed by the following MIT-licensed open-source projects:

- https://github.com/agoramachina/claude-exporter — MIT, copyright 2025 agoramachina. Source for Claude organization, conversation list and detail endpoint contracts.
- https://github.com/agarwalvishal/claude-chat-exporter — MIT. Reference for current-branch message-tree traversal and typed content blocks.
- https://github.com/glebmish/claude-exporter — MIT. Additional comparison for artifact / attachment behavior.

We do **not** bundle any of their scripts, UI, ZIP/export logic or third-party libraries. The provider reads account data through the signed-in Claude tab and maps it into the existing Domain model and renderer.

## Initial boundaries

- Claude is opt-in via an optional origin permission; existing Gemini users receive no new mandatory host permissions.
- Organization IDs are used as source-account identities. Team/shared-organization identity isolation requires further live verification.
- Claude currently exposes an array-returning conversation list and an undocumented detail endpoint. Those contracts may change or truncate silently; live pagination/coverage verification is required before marking the provider production-ready.
- Only the selected branch is rendered into Domain Detail. Alternate branches are not represented by the current v2 Domain schema.
- Text content, available thinking blocks, uploaded text extracts and simple content-bearing artifacts are mapped. Other tool content is represented conservatively; binary attachments are not claimed to be downloaded.
- No Claude live-save/sniffer is installed in this first integration; only manual scan and export are connected.
- No authorization headers, tokens, cookies or conversation bytes leave the local browser other than same-origin requests to claude.ai.

Before releasing, run the TypeScript, unit and browser suites; validate list size/pagination, team account identity, detail fidelity and attachments against a live logged-in Claude test account.
