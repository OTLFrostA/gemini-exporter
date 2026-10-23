# Claude source adapter — attribution and limitations

This provider is an independent implementation for Gemini Exporter v2, informed by the following MIT-licensed open-source projects:

- https://github.com/agoramachina/claude-exporter — MIT, copyright 2025 agoramachina. Source for Claude organization, conversation list and detail endpoint contracts.
- https://github.com/agarwalvishal/claude-chat-exporter — MIT. Reference for current-branch message-tree traversal and typed content blocks.
- https://github.com/glebmish/claude-exporter — MIT. Additional comparison for artifact / attachment behavior.

We do **not** bundle any of their scripts, UI, ZIP/export logic or third-party libraries. The provider reads account data through the signed-in Claude tab and maps it into the existing Domain model and renderer.

## Initial boundaries

- Claude is opt-in via an optional origin permission; existing Gemini users receive no new mandatory host permissions.
- Organization IDs are used as source-account identities. Team/shared-organization identity isolation requires further live verification.
- Claude currently exposes an array-returning conversation list and an undocumented detail endpoint. Those contracts may change or truncate silently; the scan indexes observed rows but intentionally returns a partial-coverage result rather than claiming source exhaustion. Pagination/coverage verification is required before marking the provider production-ready.
- Only the selected branch is rendered into Domain Detail. Alternate branches are not represented by the current v2 Domain schema.
- Text content, available thinking blocks, uploaded text extracts and simple content-bearing artifacts are mapped. Binary attachments are not claimed to be downloaded.
- No Claude live-save/sniffer is installed in this first integration; only manual scan and export are connected.
- No authorization headers, tokens, cookies or conversation bytes leave the local browser other than same-origin requests to claude.ai.

Before releasing, run the TypeScript, unit and browser suites; validate list size/pagination, team account identity, detail fidelity and attachments against a live logged-in Claude test account.

## Native tool content

- The reserved parent UUID `00000000-0000-4000-8000-000000000000` closes the selected branch. Missing real parents, cycles and unavailable leaves still prevent complete quality.
- `AskUserQuestion` becomes ordinary Domain paragraphs and lists: headers, questions, single/multiple selection mode, option labels and descriptions. Its returned answers remain text. Export is a static record, not an interactive form.
- Web searches preserve query text and result titles/HTTP(S) links. Missing results and unsupported result blocks produce partial quality with message-scoped diagnostics.
- Connector list, registry search and suggestions become named cards with descriptions and HTTP(S) links. Tool discovery preserves returned tool references. Registry IDs, execution parameters and icon metadata do not represent authored conversation content.
- Only the `artifacts` tool can produce an Artifact code block. Memory writes are operational events, represented by a status label; internal profile bodies and version tokens are excluded. A tool input containing a `content` field is not sufficient to classify it as an Artifact.
- Unsupported tools, malformed questionnaires, unavailable attachments and truncated content retain conservative quality and emit diagnostics. Empty conversations without a selected leaf remain unknown.

Live validation of the captured four-conversation account now yields three complete non-empty conversations (26 messages) and one unknown empty conversation. Actual extension downloads were checked as Markdown and HTML, including both questionnaire questions and all eight options. This does not certify binary attachments, list exhaustion, team account isolation, PDF output or full Claude Tier 2 support.
