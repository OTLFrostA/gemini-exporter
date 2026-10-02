# Provider registry neutrality correction

Baseline: `2d0264b` (PR #766). This follow-up corrects its type boundary;
no unrelated W2 behavior is changed.

## Root cause and boundary

PR #766 replaced AIProvider in the registry/resolver with ApplicationProvider,
an alias of GeminiProviderContract. A provider implementing only the neutral
interface therefore could not register without Gemini diagnostics/evidence.

Now `ProviderRegistryClass<TProvider extends AIProvider = AIProvider>` stores
and returns its explicitly selected subtype. A default instance and the global
registry accept/return neutral AIProvider. `resolveProvider()` returns
AIProvider | undefined. Neither imports any Gemini-specific contract type.
The resolver's existing Gemini self-registration side-effect import remains.

`ApplicationProvider` has moved to `src/content/providerCompatibility.ts`.
Four explicit single assertions in the three existing content consumers retain
their current Gemini-dependent assumption, without changing emitted code.
This is temporary application compatibility, not a runtime capability guard.
W2-04/05/06/07 must remove the alias/assertions after migrating neutral data and
Gemini evidence reads. No new provider adapters or full content migration occur.

## Regression and preservation evidence

An any-free fixture implements only AIProvider, registers with
`new ProviderRegistryClass()`, and is retrieved through typed get/getAll/
getDefault/findByUrl. It has no Gemini options, diagnostics or parser data.
The compiler would reject its registration if the default registry regressed
to the #766 Gemini requirement. An explicitly specialized registry test
retains Gemini diagnostics/reasons; the existing six contract tests retain
adapter assignability, seven completeness reasons, media/raw/provenance
identity, slot/callback forwarding and readiness behavior.

All nine existing production modules checked (provider core/adapter/companion,
barrel/registry/resolver and three content consumers) emit byte-identical
JavaScript against `2d0264b`, using esbuild TS transform with chrome120/ESM,
syntax/whitespace minification and unchanged identifiers. No normalization or
exclusion is used. The new compatibility module emits no JavaScript.
Registration order, duplicate warnings, URL matching, default fallback,
account isolation, cancellation and export behavior are unchanged.

Negative maxPages, empty NO_INNER_STR, partial AbortError classification,
W2-02's Awaited test gap, parser/client/content escapes and the permanent lint
gate remain untouched. No parser/pagination/reconciliation/storage/title
semantics change. Tier 2/3 are not triggered; no live/visual pass is claimed.

## Validation

| Check | Result |
|---|---|
| `npm run type-check` | Passed |
| Provider-focused tests | 5 matched suites passed; contract suite now has 8 cases |
| `npm run test:changed` | 20 affected unit suites and 43 E2E cases passed |
| `CI=1 npm test` | Scoped lint, types, 194 unit suite files, build and 43 E2E cases passed |
| `npm run pool:status` | 20/20; zero scenarios consumed |
| Whole provider-layer explicit-any check | Passed; permanent gate unchanged |
| Emission comparison | All nine existing modules byte-identical; new content alias emits no code |
| `git diff --check` | Passed |

Logs and emission script/results are retained in the core checkout's ignored
`temp/provider-neutrality-validation/` directory. No unrelated W2 issue was fixed.
This correction is submitted as a new PR because #766 was already merged.
