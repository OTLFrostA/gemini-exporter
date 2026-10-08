# Native Domain parser acceptance

The complete Tier 2 run passed on 2026-10-07 (America/Los_Angeles) against
`0603857d12d58a1da54c985ece02cfa3b67dd708`, using the signed-in debug Chrome
profile and the default scenario pool. All 24 features passed, with zero failures,
skips or warnings. No stages or export assertions were disabled.

The two newly generated scenarios covered urban stormwater and magnetic skyrmions.
The full run exercised real multi-turn generation, Imagen, uploaded attachments,
onboarding, live disk saves, old-conversation promotion, updated badges, ephemeral
deletion, Takeout import, all-history pagination and four authoritative title
upgrades. Search, selection and language controls also passed.

Eight conversations were jointly exported and their downloaded ZIPs unpacked:

| Format | Physical output | Validation |
| --- | --- | --- |
| Markdown | 2,305,944-byte ZIP | Both new scenarios' complete rounds, historical golden categories, index/frontmatter and nonempty attachments |
| HTML | 2,365,477-byte ZIP, eight HTML conversations | Required document structures and physical resources |
| PDF | 3,898,068-byte ZIP, eight PDF conversations | Compiled binaries and required content |

The 254-byte uploaded file matched the original SHA-256. No zero-byte output files
were found. Image acquisition and Markdown references also passed with a stale
Gemini tab. The extension uninstall and clean reinstall lifecycle passed.

The first full attempt exposed a test setup dependency: the search-clear case
assumed a previous case's selection survived intervening DAG cases. The case now
establishes its own real search and selection before clearing. Its original list
restoration and selection assertions remain; Python regressions verify that actual
selection loss still fails. The subsequent complete run produced the result above.

Local `npm test` passed the zero-any check, strict types, Python tests, 236
TypeScript unit suites, production build and 46 Playwright tests. The migration
adds 14 native-caller contracts and two DOM browser contracts. Consumed scenarios
were replaced with fresh domains, restoring the pool to 20/20.

A separate private Takeout audit produced 1,049 conversations and 176 referenced
resources, including seven audio files, with successful closure, AST placement and
byte acquisition, and no missing, ambiguous or unbound resources. Private source
data and physical live exports remain local rather than entering the repository.

Storage implementation, persisted conversation types, schema, serializers and keys
are unchanged. This acceptance covers the exercised Gemini production workflows;
it does not establish support for every future RPC/DOM variant, OpenAI imports or
a future Domain storage migration.
