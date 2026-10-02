# W2-03 Provider contract stabilization

Baseline: `f807a5c` (W2-02 / #765). Contract scope only; no parser, content,
export, storage, reconciliation or cancellation behavior is migrated.

## Neutral contract

`src/core/provider/aiProvider.ts` owns the neutral lifecycle and data:

| Type / fields | Evidence and scope |
|---|---|
| `ProviderConversationItem`: id/title, optional url/createdAt/updatedAt/messageCount | Conversation identity, display, recency and count used by sync/detail readers. Times are number-or-null as emitted by the API; stored string-time compatibility remains outside this acquisition contract. |
| `ProviderMessage`: optional id, role, content, optional timestamp | Text/role/time surface used by detail success checks and formatting. Existing model/assistant role vocabulary is preserved; no role conversion or media normalization occurs here. |
| `ProviderConversationDetail`: item fields plus messages | Minimum shared detail surface. No raw wire, title policy, time aliases or multimodal decoder inputs. |
| `ProviderPageResult<T>`: items, optional total/hasMore/nextCursor/stoppedEarly, required exhaustive/completionReason | Aggregate list control plane. `hasMore` is only a legacy hint. Reason is a provider-defined string; the Gemini companion restricts its exact seven-value vocabulary. |
| `ProviderListOptions<T>` and batch/progress/stop records | maxPages/incremental/signal, async page-batch stop decision, progress including page/added/total/batch. Generic item typing serves actual Gemini callbacks without importing Gemini into the core. |
| `ProviderReadiness`: ready/accountName/error | Existing readiness/display/error seam. Gemini accountSlot moves to its companion; accountName remains optional with no new producer requirement. |

`AIProvider` retains identity/name/hostPatterns, matchesUrl, readiness, list,
detail and optional fetchAsset. Neutral readiness context and detail options
are `unknown`: there is no evidenced neutral schema for account slots.
Asset options are likewise unknown; Blob/ArrayBuffer return and optional seam
remain unchanged. No abort method or future adapter is invented.

Unused Gemini pipeline reexports (Conversation/ChatMessage/Attachment/TitleSources)
are removed from the neutral module. Repository searches found no external
production or test imports of these reexports. Their original domain modules
remain unchanged.

## Gemini companion and adapter

`src/core/provider/gemini/geminiContracts.ts` is authoritative for current
Gemini application input/evidence:

- `GeminiProviderConversationItem = ConversationListItem` from W2-01:
  titleSource/titles, nullable chatTime/timestamp aliases and exact parser metadata.
- `GeminiProviderConversationDetail = PaginatedDetailResult` from W2-02:
  ParserMessage media/documents/citations/structured input, title provenance,
  raw/debug evidence, drift/rejected turns, truncation/cursor/count metadata.
  `_raw` stays unknown; this is not a wire-validation guarantee.
- `GeminiProviderPageResult` extends the exact W2-02 PaginationResult with
  required items/hasMore and null nextCursor. It statically retains conversations,
  typed Gemini diagnostics, hitGoogleLimit, exhaustive and all seven reasons.
- `GeminiProviderReadinessContext` names accountSlot; its readiness result retains
  accountSlot. Default `u0`, credentials and error fallback behavior are unchanged.
- `GeminiProviderListOptions` extends PaginationOptions with the observed
  content-owned forceFull pass-through. No pagination force-full policy is added.
- `GeminiProviderDetailOptions` names nullable targetSid/slot. Existing truthy
  `targetSid > slot > null` behavior (including empty-string fallback) is retained.
- `GeminiProviderClient` is the small two-method adapter client seam. Production
  GeminiAPIClient satisfies it; typed test clients need no broad class assertion.
- `GeminiProviderContract extends AIProvider` verifies compatibility of the exact
  companion returns with the neutral core. No extension bag/double assertion is used.

The adapter still spreads producer fields at runtime. The mechanism for exposing
extensions is now its declared, upstream-linked companion return contract;
spreads do not substitute for a missing type contract. Tests check evidence and
reference identity, including list aliases, media, provenance and diagnostics.

## Explicit transition for existing consumers

`ApplicationProvider = GeminiProviderContract` now lives in the type-only
`src/content/providerCompatibility.ts` module. The three current content readers
use explicit single assertions at their four resolver call sites. These preserve
the existing Gemini-only application assumption without claiming runtime
capability validation. W2-04/05/06/07 must remove them when neutral data and
explicit evidence mapping are implemented.

PR #766 incorrectly made generic registry storage and resolver returns depend
on that alias. The follow-up neutrality correction restores
`ProviderRegistryClass<TProvider extends AIProvider = AIProvider>` and
`resolveProvider(): AIProvider | undefined`. Generic infrastructure imports no
Gemini-specific contract. The resolver retains the existing Gemini side-effect
registration import; it does not constrain the neutral type boundary.
The global registry uses the neutral default. Only an explicitly specialized
registry instance promises a companion subtype.

No content acquisition, callback, DI, cancellation, sorting, merge or export logic
is migrated. Registration/default routing/host fallback and resolver import
side effects/URL-first-default-second behavior are unchanged. The assertions
and generic annotations are erased in emitted JavaScript. See
[neutrality correction](provider-registry-neutrality-fix.md) for final validation.

## Completeness and preserved public behavior

Gemini list result preserves natural_exhaustion, unchanged_boundary, token_loop,
max_pages, hit_google_limit, error and aborted exactly. Every explicit callback
stop still maps to unchanged_boundary; no callback_stop value is invented.
The adapter still uses hasMore = !!stoppedEarly and nextCursor = null.
No guard derives exhaustive from hasMore. No reconciliation guard is edited.

W2-02's existing edge risks remain: negative maxPages and empty NO_INNER_STR
without Bard evidence can currently yield natural/exhaustive; in-flight abort
rejection after partial data maps to error. P-01–P-05 also remain unchanged.
These require separate semantic work and live evidence, not contract relabeling.

The lifecycle method names, identity/URL behavior, asset scaffold, default client
construction, account isolation, callback identity and detail evidence are
unchanged. Unchecked legacy test fixtures still run for runtime compatibility;
new contract tests use typed producer fixtures.

## Remaining escapes and validation limits

There is no explicit any, broad index signature or double assertion in
`src/core/provider/**`. Neutral unknown contexts/options and Gemini unknown raw
wire evidence are intentional trust boundaries. Readiness catch retains one
erased `{message?: string} | null | undefined` projection of credential-error
messages, preserving the old optional property read and fallback. This is an
unvalidated diagnostic projection; arbitrary JavaScript throws are not certified
as string errors. The existing readiness result's declared string error surface
is unchanged.

Four temporary single assertions now reside at the content resolver call sites;
their current Gemini-only application assumption is explicit, not a neutral
registry requirement. Outside this task, syncEngine's `const all: any`/callbacks, ActiveClientContract,
live-save/router runtime envelopes and export escapes remain for W2-04/05/06/07.
Shared ChatMessage still has documents/citations any arrays; the provider's Gemini
companion uses W2-01 ParserMessage's explicitly typed replacements. Parser wire
array probes/structured decoder assertions and API client transport escapes
remain as listed in the W2-01/W2-02 audits. No permanent lint scope is expanded.

All five existing production modules emit byte-identical JavaScript against
`f807a5c` under esbuild TS transform (chrome120/ESM, syntax and whitespace
minification, unchanged identifiers), with no normalization or exclusions.
The new companion module is type-only. This patch does not trigger Tier 2
(parser/Takeout/sorting/interception/version behavior) or Tier 3; neither pass
is claimed. Logs and emission script/results are retained in the core checkout's
ignored `temp/w2-03-validation/` directory.

## Validation

| Check | Result |
|---|---|
| `npm run lint:zero-any` | Passed; permanent gate unchanged |
| `npm run type-check` | Passed |
| `python3 tests/run_tests.py --filter provider` | 5 matched suites passed, including 6 new contract cases |
| `npm run test:changed` | 20 affected unit suites, strict types/build and 43 E2E cases passed |
| Final `CI=1 npm test` | Scoped lint, strict types, 194 unit suite files, build and 43 E2E cases passed |
| `npm run pool:status` | 20/20; zero scenarios consumed |
| Ad hoc whole-provider explicit-any lint | Passed; no permanent scope expansion |
| Runtime emission comparison | Five existing production modules byte-identical; new companion type-only |
| `git diff --check` | Passed |
| Tier 2 / Tier 3 | Not triggered; no live/visual pass claimed |

The added readiness test initially failed because this repository's test loader
cannot resolve dynamic `.js` imports of TypeScript modules. Replacing it with
static import fixed the fixture; focused, incrementally impacted and final full
checks then all passed. No production behavior changed for this correction.

**Contract frozen for W2-04/05/06/07.** Use the neutral `AIProvider` data/options
and the explicit Gemini/application companion above; remove the content
compatibility alias and call-site assertions only after its consumers have migrated.
