# Native Domain runtime acceptance

## Scope

Runtime acquisition, pagination, Takeout caches, storage readers, live save,
HTML/Markdown orchestration and PDF preparation now carry
`ResourceConversationParseResult` directly. Historical record decoding is confined
to the old-storage migration boundary. Architecture gates reject the retired input
format and projection APIs throughout production source.

The two supported JSON exports serve different purposes. The versioned complete
archive retains the full Domain graph plus asset destinations. OpenAI-compatible
JSON projects messages only during final serialization; it is not a ChatGPT
archive import implementation. Developer raw JSON requires real provider evidence.

Domain, Document AST, renderers, raw parser grammars and persisted storage schema
are unchanged. Source resource facts remain immutable while preparation allocates
output paths. Missing bodies fail explicitly and remain retryable.

## Initial live run and retained failure

The first complete default-pool attempt passed 21 features but failed PDF math
validation. Its two dependent stages were automatically skipped, so this was not
a successful Tier 2 acceptance run.

The railway vibration conversation contained the literal command `\gtrso` in
its exported Markdown. MiTeX reports `unknown command: \gtrso`; the unchanged
renderer preserves the full source with its normal fallback label. HTML and PDF
both retain that formula. The failure is not resolved by silently rewriting source
math or removing the fallback assertion.

The PDF assertion also had an independent false positive: a regex matched normal
prose such as "Use LaTeX and state the units". It now checks the renderer's actual
English or Chinese fallback labels, tolerating extraction whitespace, and reports
the failing formula's context. Python regressions accept normal prose/code and
reject both real fallback labels, including the observed invalid command. The
original PDF still fails the corrected assertion.

## Final validation

Full `npm test` passed scoped zero-any, strict types, Python and TypeScript unit
suites (238 TypeScript suites), production build and all 59 Playwright tests.
Both JSON formats were
physically downloaded, unpacked and validated in browser tests. Production ZIP
packaging and the bundled-font release gate passed. Consumed scenarios were
replaced with new domains and the scenario pool validates at 20/20.

The subsequent complete default-pool Tier 2 run passed on 2026-10-08: all 24
features passed, with zero failures, skips or warnings. Its new scenarios covered
glacial-lake outburst flooding and passive seismic-noise tomography. No stages,
real fallback checks or physical export assertions were disabled.

Eight conversations were jointly exported and the actual downloaded ZIPs unpacked:

| Format | Physical output | Validation |
| --- | --- | --- |
| Markdown | 2,218,362-byte ZIP | Complete new rounds, historical golden categories, index/frontmatter, nonempty resources |
| HTML | 2,276,917-byte ZIP, eight conversations | Document structures and physical resources |
| PDF | 3,657,034-byte ZIP, eight conversations | Compiled binaries, content and zero math-fallback labels |

The new 256-byte custom-extension upload matched its original SHA-256. There were
no zero-byte output files. Both live-save workflows, old-conversation promotion,
ephemeral deletion, full history pagination, all four Takeout title upgrades,
stale-tab image acquisition, onboarding, and clean uninstall/reinstall passed.

Private source data and generated physical exports remain local and are not
committed with this audit.
