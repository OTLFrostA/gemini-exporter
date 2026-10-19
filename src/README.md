# Source architecture (v2)

The frozen [v2 design](https://app.notion.com/p/3fa5d4d759e18153911bed2246079b4e) defines ownership:

| Directory | Responsibility |
| --- | --- |
| `core/parsers` | Source decoding and unbound parse results |
| `core/provider`, `core/engine` | L1 acquisition, pagination, temporary resource capabilities |
| `core/domain` | L2 account identity, trusted Index/Detail admission, Coverage |
| `core/storage` | Physical IndexedDB and Chrome Settings/handle persistence |
| `core/document`, `core/export` | Composition, resource preparation, formats and packaging |
| `core/application` | Scan/export workflows, Settings defaults, record cleanup |
| `core/migration` | One-time, nondestructive v1 metadata/preferences migration |
| `background`, `content`, `core/api` | Browser execution contexts, IPC and readiness |
| `ui` | Popup, Options, selection, guidance and result presentation |

Extension pages call Application/Domain APIs directly. Content uses Background IPC
for extension-origin persistence; page MAIN hooks pass captured source facts only.
Live Save sends a ConversationKey to Background, then uses the same Application
Markdown export workflow. Business bodies and directory handles do not travel in
Chrome JSON messages.

`npm test` runs zero-any, whole-project TypeScript checking, all active Node and
offline Python unit tests, production build and fixture-based Playwright tests.
`node scripts/test-ui.cjs` limits behavioral tests to UI (type checking still checks
the complete project). No command above uses a live Google account.

See [integration cleanup](../docs/v2-integration-cleanup.md) for retired interfaces,
replacement coverage and the test-retirement audit.
