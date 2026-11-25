# Source architecture (v2)

The frozen [v2 design](https://app.notion.com/p/3fa5d4d759e18153911bed2246079b4e)
defines the module boundaries used by this directory tree:

| Directory | Design module and responsibility |
| --- | --- |
| `l1/client` | [L1](https://app.notion.com/p/3fb5d4d759e1812f9962cf24dcf9116a): provider requests, pagination and credentials (decoupled from L2 writes via `ProviderHost`) |
| `l1/sniffer` | L1: passive provider request/response capture and serialized source message bridges (DOM observers live in `runtime/content`) |
| `l1/parsers`, `l1/protocol` | L1: source decoding, provider wire schemas and unbound parse results |
| `l1/imports`, `l1/resources` | L1: offline archive decoding/binding and temporary resource acquisition |
| `l2` | [L2](https://app.notion.com/p/3fb5d4d759e1814aaa92ee02a21419a7): Domain schemas, account identity, Index/Detail admission and Coverage |
| `l3a` | [L3a](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00): passive IndexedDB, Settings and directory-handle persistence |
| `l3b/ast`, `l3b/compose` | [L3b](https://app.notion.com/p/3fb5d4d759e181ed9ea7cffc849a5769): document AST and composition |
| `l4/format` | [L4](https://app.notion.com/p/3fb5d4d759e18131aaf0ecbe526d5ace): Markdown/HTML/JSON/DOCX/Typst rendering, PDF compiler, sandbox and bundled resources |
| `l4/packaging`, `l4/delivery` | L4: archive paths, ZIP writer, browser downloads and filesystem writer |
| `application` | [Application](https://app.notion.com/p/3fb5d4d759e181169ed3dfed880a093a): sync/export/import workflows, Settings defaults and record cleanup |
| `application/vault` | Application: encrypted vault key setup, record codec, transport clients and sync orchestration |
| `ui` | [UI](https://app.notion.com/p/3fb5d4d759e181cdad0fc2f778766999): Popup, Options, badge, guidance and presentation helpers |
| `runtime` | [Runtime](https://app.notion.com/p/3fc5d4d759e181378680fb979175bc38): background/content entrypoints, IPC, account routing, readiness and browser capabilities |
| `migration` | Independent one-time, nondestructive v1 metadata/preferences migration |
| `shared` | Cross-module types, diagnostics and pure utilities |

Extension pages call Application/Domain APIs directly. Content uses Background IPC
for extension-origin persistence; page MAIN hooks pass captured source facts only.
Live Save sends a ConversationKey to Background, then uses the same Application
Markdown export workflow. Business bodies and directory handles do not travel in
Chrome JSON messages.

Markdown, HTML and JSON prepare documents independently of attachments.
The source pipeline composes documents and reserves local attachment paths from
Domain metadata before any attachment bytes are required. Folder export writes
each document first and fills its attachment paths separately. Browser export
waits for resource processing and delivers the documents and available attachments
together, in one ZIP when there are multiple files. PDF and DOCX finish rendering
after their embedded media has been prepared.

Attachment failures produce a document with failure placeholders and a JSON report
under `attachment-reports/`. Corrections replace the document at its original
path, whether staged for browser delivery or already written to a folder.
Successful attachment acquisitions are reused within the task.
Browser downloads use a separate attachment directory per task. Markdown, HTML
and JSON folder exports use stable `assets/<provider>/<accountId>/<conversationId>/` and `files/...` paths.
Before acquisition, Application asks L4 Delivery whether each planned file exists;
existing files are reused by name without downloading or rewriting their bytes.
Same-path content changes retain the local file; delete it to acquire it again.
Folder document names and batch collision suffixes retain their existing rules.
PDF/DOCX embedded media still require acquisition. Previous task-scoped folders
are left untouched and are not searched for reusable attachments.
Folder exports commit the ExportRecord after document and attachment writes
finish. The body-delivery callback updates progress independently. Cancelling
outstanding attachments cannot retract an already delivered document.

The explicit UI diagnostic JSON download includes conversation titles and IDs.
Gemini structured-body rejection diagnostics also retain the full failed native
document, rejected node/annotation and its JSON Pointer, and the matching Markdown
body for local replay. Adapter failures retain the decoded document as JSON text
and the matching Markdown body. These samples may include private conversation
text, URLs and file tokens; they stay in diagnostic evidence beside the parse
result, never in Domain/Document AST fields. Successful native parses do not
collect these raw samples. Existing diagnostic count limits still apply.

Successful decoded messages retain neither per-candidate replay metadata nor raw
document arrays. After a content failure, the adapter finds that selected candidate
in the current response and materializes only the diagnostic fields it needs.
Typed artifact packets in `candidate[30]` establish complete native document ownership;
response-level document recovery excludes candidate narrative/citation metadata and
nested identified containers, marking recovered fallback bodies as partial.

Unresolved Gemini source annotations additionally report each affected native text
node, the rejected coordinates, coordinate validity, and unbound source IDs.
When developer mode is enabled, `GEMINI_SOURCE_REPLAY_EVIDENCE` retains the complete
decoded `hNvQHb` payload once per affected Detail page for offline replay, without
entering Domain or persistent conversation state.

Diagnostic revision 3 includes the current browser online state and granted extension
permissions, ChatGPT branch-coverage reasons and candidate admission outcomes,
before/after persisted Detail versions, and resource request phases, origins,
response status/type, elapsed time and exception names. Request routing evidence
retains origins rather than signed URL paths or query parameters; rejected download
exchanges record field names, status and bounded error-code/type identifiers rather
than the full response body. Download locator shapes omit their actual strings.
Incomplete ChatGPT branches include node counts and up to eight tail/child node
summaries (roles, recipients, content kinds, visibility and completion flags),
without message text. Detail admission records request/response times alongside
source versions. Folder-write errors include filename code points/UTF-8 length,
permission-query results and the stage/name of each failed attempt.
Source URL reads retain authenticated access first and retry transport TypeErrors
without credentials for public wildcard-CORS images. Explicit HTTP failures and
cancellation are not retried. Native `ace_pod_expired` responses are classified as
expired resources, without inventing an HTTP 404.
These observations stay outside Domain and do not add duplicate UI failure groups.
Export-run evidence lives in the current Options page: reproduce the export and
download diagnostics before reloading or closing that page. Stored partial records
alone cannot reconstruct an earlier run's source responses or failure causes.

`build.js` maps the relocated source entrypoints to the existing `dist/content`,
`dist/background` and `dist/ui` bundle names. Manifest paths and sandbox resource
URLs point to their owning module's source directory.

`npm test` runs zero-any, `scripts/check-architecture.cjs` (layer DAG and 0-cycle gate), whole-project TypeScript checking, all active Node and
offline Python unit tests, production build, bundled font checks, and fixture-based Playwright tests.
No command above uses a live Google account.

See [Architecture Specification](../docs/architecture/architecture.md) and
[Storage](l3a/README.md) for the current contracts. Test ownership and execution rules are described in
[module-unit isolation](../docs/v2-unit-isolation.md).
