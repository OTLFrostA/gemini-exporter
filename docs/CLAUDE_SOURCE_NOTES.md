# Claude source adapter — attribution and limitations

This provider is an independent implementation for Gemini Exporter v2, informed by the following MIT-licensed open-source projects:

- https://github.com/agoramachina/claude-exporter — MIT, copyright 2025 agoramachina. Source for Claude organization, conversation list and detail endpoint contracts.
- https://github.com/agarwalvishal/claude-chat-exporter — MIT. Reference for current-branch message-tree traversal and typed content blocks.
- https://github.com/glebmish/claude-exporter — MIT. Additional comparison for artifact / attachment behavior.

We do **not** bundle any of their scripts, UI, ZIP/export logic or third-party libraries. The provider reads account data through the signed-in Claude tab and maps it into the existing Domain model and renderer.

## Initial boundaries

- Claude is opt-in via an optional origin permission; existing Gemini users receive no new mandatory host permissions.
- Organization IDs are used as source-account identities. Team/shared-organization identity isolation requires further live verification.
- Scans use the current `chat_conversations_v2` endpoint with 100-row offset pages and strong consistency. Only an explicit `has_more: false`, complete results and a nonrepeating ordered source chain admit exhausted Coverage; older passive array responses only add observed indexes. The seven-row live account was verified against the native sidebar. Large and team accounts still require live validation.
- Only the selected branch is rendered into Domain Detail. Alternate branches are not represented by the current v2 Domain schema.
- Text, exposed reasoning, uploaded text extracts and native tool content are mapped. Generated files with explicit UUID/files-api metadata are downloaded from the authenticated organization-specific contents endpoint, with a size cap and declared byte-length checks. Unknown uploaded binary formats remain partial.
- Permission-gated MAIN/ISOLATED content scripts capture native lists, details, completed streams and successful DELETE receipts, plus initial visible sidebar links. They use the common Badge, Popup, L2 admission and Live Save owners. The hook itself makes no extra source or identity requests.
- No authorization headers, tokens, cookies or conversation bytes leave the local browser other than same-origin requests to claude.ai.

Before releasing, run the TypeScript, unit and browser suites; validate list size/pagination, team account identity, detail fidelity and attachments against a live logged-in Claude test account.

## Native tool content

- The reserved parent UUID `00000000-0000-4000-8000-000000000000` closes the selected branch. Missing real parents, cycles and unavailable leaves still prevent complete quality.
- `AskUserQuestion` becomes ordinary Domain paragraphs and lists: headers, questions, single/multiple selection mode, option labels and descriptions. Its returned answers remain text. Export is a static record, not an interactive form.
- Web searches preserve query text and result titles/HTTP(S) links. Missing results and unsupported result blocks produce partial quality with message-scoped diagnostics.
- Connector list, registry search and suggestions become named cards with descriptions and HTTP(S) links. Tool discovery preserves returned tool references. Registry IDs, execution parameters and icon metadata do not represent authored conversation content.
- Artifact code blocks require an explicit `artifacts` tool or a modern `Artifact` publish bound to captured `Write` content for the same path. Missing file bytes and unparsed edits remain partial. Memory read/write/append and skill setup are operational events, represented by a status label; internal profile bodies and version tokens are excluded. A tool input containing a `content` field is not sufficient to classify it as an Artifact.
- Unsupported tools, malformed questionnaires, unavailable attachments and truncated content retain conservative quality and emit diagnostics. Empty conversations without a selected leaf remain unknown.

Initial live validation of the captured four-conversation account yields three complete non-empty conversations (26 messages) and one unknown empty conversation. Actual extension downloads were checked as Markdown and HTML, including both questionnaire questions and all eight options. This does not certify binary attachments, list exhaustion, team account isolation, PDF output or full Claude Tier 2 support.

A fresh three-round live conversation additionally exercises tables, LaTeX, Python, a two-question native questionnaire with submitted single/multiple choices, memory read/append, and the modern `Skill → Write → Artifact` tool chain. Modern Artifact export preserves the exact captured file source as inert code and the published link; it never executes the source or fetches missing file bytes. Unsupported file mutations invalidate retained bytes so a later publish cannot silently reuse an older version.


## Follow-up validation (2026-10-22)

The five-round acoustic test introduced native `visualize` widgets, task state, shell execution, file delivery and Claude Docs operations. Widgets preserve exact inert SVG/HTML source; static exports do not execute interactive code. Shell commands and results retain exact code/indentation. Docs creation, inline Markdown edits and comments are labelled chronological operations rather than a guessed final remote document; tool setup and abbreviated internal receipts are excluded. Unrecognized edits remain partial.

Only three replies in the account's next scenario completed; the fourth was submitted but ended with `stop_reason: error` during the fourth reply when the Free five-hour message quota was exhausted. Such interrupted output remains partial even when visible text and code are present. The live waiter now detects native quota notices outside authored message bodies and reports them separately from HTTP 429. It does not retry messages or upgrade the account.

Full-run attempts and targeted existing-conversation exports have separate reports. Badge and all seven visible sidebar rows passed in real 9222 Chrome. Full 5/8-round generation, promotion and confirmed deletion remain blocked by native message quota; targeted scan/export results do not substitute for those full-run gates.


Targeted follow-up disk acceptance covered 16 messages and 27 exact code bodies
across Markdown, HTML, JSON and PDF, including both generated Python originals.
Every PDF page and both complete HTML exports were rendered for visual review.
Optional local font permission in the `prompt` state had stalled PDF export;
the fallback now uses bundled fonts without asking for that optional access.
