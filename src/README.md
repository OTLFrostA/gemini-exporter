# Source architecture (v2)

The frozen [v2 design](https://app.notion.com/p/3fa5d4d759e18153911bed2246079b4e)
defines the module boundaries used by this directory tree:

| Directory | Design module and responsibility |
| --- | --- |
| `l1/client` | [L1](https://app.notion.com/p/3fb5d4d759e1812f9962cf24dcf9116a): provider requests, pagination and credentials |
| `l1/sniffer` | L1: passive Gemini request/response capture and source message bridge |
| `l1/parsers`, `l1/protocol` | L1: source decoding, provider wire schemas and unbound parse results |
| `l1/imports`, `l1/resources` | L1: Takeout import and temporary resource acquisition |
| `l2` | [L2](https://app.notion.com/p/3fb5d4d759e1814aaa92ee02a21419a7): Domain schemas, account identity, Index/Detail admission and Coverage |
| `l3a` | [L3a](https://app.notion.com/p/3fb5d4d759e1816dbc65c1cd23854e00): passive IndexedDB, Settings and directory-handle persistence |
| `l3b/ast`, `l3b/compose` | [L3b](https://app.notion.com/p/3fb5d4d759e181ed9ea7cffc849a5769): document AST and composition |
| `l4/format` | [L4](https://app.notion.com/p/3fb5d4d759e18131aaf0ecbe526d5ace): Markdown/HTML/JSON/Typst rendering, PDF compiler, sandbox and bundled resources |
| `l4/packaging`, `l4/delivery` | L4: archive paths, ZIP writer, browser downloads and filesystem writer |
| `application` | [Application](https://app.notion.com/p/3fb5d4d759e181169ed3dfed880a093a): sync/export workflows, Settings defaults and record cleanup |
| `ui` | [UI](https://app.notion.com/p/3fb5d4d759e181cdad0fc2f778766999): Popup, Options, badge, guidance and presentation helpers |
| `runtime` | [Runtime](https://app.notion.com/p/3fc5d4d759e181378680fb979175bc38): background/content entrypoints, IPC, account routing, readiness and browser capabilities |
| `migration` | Independent one-time, nondestructive v1 metadata/preferences migration |
| `shared` | Cross-module types, diagnostics and pure utilities |

Extension pages call Application/Domain APIs directly. Content uses Background IPC
for extension-origin persistence; page MAIN hooks pass captured source facts only.
Live Save sends a ConversationKey to Background, then uses the same Application
Markdown export workflow. Business bodies and directory handles do not travel in
Chrome JSON messages.

`build.js` maps the relocated source entrypoints to the existing `dist/content`,
`dist/background` and `dist/ui` bundle names. Manifest paths and sandbox resource
URLs point to their owning module's source directory.

`npm test` runs zero-any, whole-project TypeScript checking, all active Node and
offline Python unit tests, production build and fixture-based Playwright tests.
`node scripts/test-ui.cjs` limits behavioral tests to UI (type checking still checks
the complete project). No command above uses a live Google account.

See [integration cleanup](../docs/v2-integration-cleanup.md) for retired interfaces,
replacement coverage and the test-retirement audit.
