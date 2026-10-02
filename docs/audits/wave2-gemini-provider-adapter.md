# W2-04 Explicit GeminiProvider adapter

Baseline: `c303687` (#767, W2-03 neutrality correction). W2-03 neutral and
Gemini companion contracts remain unchanged. Registry/resolver remain neutral;
no content/export consumer, parser, pagination, storage or reconciliation code
is migrated. Permanent zero-any scope is unchanged.

## Explicit fields and boundaries

The adapter now declares every top-level producer field it forwards rather than
spreading a producer into a supposedly neutral return. Existing W2-03 companion
contracts remain flat for transition compatibility; no new nested envelope or
public API is invented.

| Mapping | Neutral core | Gemini companion / compatibility |
|---|---|---|
| List | items, total, exhaustive, completionReason, legacy hasMore/nextCursor/stoppedEarly control | conversations alias, exact seven-value Gemini reason, hitGoogleLimit, GeminiPaginationDiagnostics |
| Detail | id/title/url/messages, createdAt/updatedAt, messageCount | titleSource/titles, timestamp/chatTime aliases, nextPageToken, attachmentCount, schemaDrift/turnsRejected, truncated/isTruncated/truncateReason, _raw/_debug |

List items remain typed ConversationListItem objects. Messages remain typed
ParserMessage objects; the adapter forwards the messages array unchanged, so
nested images/attachments/generation identities, documents, citations/sources,
thoughts/thinking, structured content and grounding markers retain their exact
values and references. No text-only projection or media/title normalization
is performed. Raw/debug data remain evidence, not validated wire objects.

Required fields map directly from current typed producers. Optional fields use
explicit own-enumerable property checks, retaining absence versus present
undefined/null rather than manufacturing flags or stripping observations.
This includes list stoppedEarly and all seven optional detail evidence fields.
Undeclared top-level extensions are intentionally excluded; no current
parser/pagination producer emits such an extension needed by consumers. Nested
opaque evidence is preserved, not filtered.

One old untyped detail fixture lacked required pagination metadata; it now
contains nullable times/url/cursor/count fields matching the actual producer.
Its precedence/evidence assertions remain unchanged. New typed fixtures and
actual pagination aggregates verify the complete declared mapping.

## Completeness, options and lifecycle

List options and callbacks are passed by identity directly to the client.
No wrappers alter callback-stop decisions, progress, signal, forceFull or slot
policy. The adapter still uses `hasMore = !!stoppedEarly`, `nextCursor = null`;
exhaustive and all seven reasons pass through without inference/relabeling.
Google-limit and nested diagnostic evidence remain intact. Existing negative
maxPages/empty NO_INNER_STR/partial AbortError edge semantics are untouched.

Detail still selects truthy targetSid, then slot, then null, including empty
string fallback. Default client construction, matchesUrl, credential slots,
self-registration order, URL/default resolution, asset scaffold and cancellation
paths are unchanged.

## Honest readiness error narrowing and contract assessment

Signatures already use W2-03 typed options. The remaining readiness catch used
an unchecked `{message?: string}` projection of unknown thrown values. It could
return a numeric/object message despite the declared string error field.
The catch now observes Error or object/function message properties as unknown,
returns only a nonempty string, and otherwise uses the existing Chinese fallback.
Error and plain-object string messages, empty messages, null/undefined and string
throws retain their prior text. Non-string message values now use the fallback.
This is a deliberate diagnostic correction, not a type-only claim.

No W2-03 core/companion shape defect was discovered and no contract redesign
was needed. The preexisting diagnostic projection violated the existing
readiness declaration; narrowing fixes the implementation. No new assertion,
any, broad extension bag or object spread exists in GeminiProvider.

## Runtime scope and verification

Five new adapter cases verify full/nested evidence identity, optional property
presence, equivalence with previous spread mapping for actual pagination
aggregates, exclusion of undeclared top-level keys, and honest readiness errors.
Compile-time key coverage forces review when upstream detail/list fields grow.
The existing eight contract cases retain seven completeness reasons, callback/
options identity, slot precedence, readiness and neutral registry regressions.

Emission comparison against `c303687` checks nine existing production modules.
The adapter intentionally emits different JavaScript for explicit mapping/error
narrowing; the eight other checked provider/content boundary modules
remain byte-identical. No normalization or exclusion is used. The compatibility
module still emits no code. This does not claim the whole patch is type-only.

AGENTS.md Tier 2 triggers (Protobuf/JSPB parsing, Takeout import, sorting,
network interception or version release) are not modified. This adapter change
preserves acquired declared data and completeness, with the diagnostic correction
above covered locally; no trigger applies. Tier 2/3 are not executed and no
live/visual pass is claimed.

## Validation

| Check | Result |
|---|---|
| `npm run type-check` | Passed |
| Provider-focused tests | 6 matched suites passed, including 5 new adapter cases and 8 existing contract cases |
| `npm run test:changed` | 21 affected unit suites and 43 E2E cases passed |
| `CI=1 npm test` | Scoped lint, strict types, 195 unit suite files, build and 43 E2E cases passed |
| `npm run pool:status` | 20/20; zero scenarios consumed |
| Ad hoc provider-layer explicit-any check | Passed; permanent gate unchanged |
| Runtime emission comparison | Adapter intentionally differs; eight other modules byte-identical |
| `git diff --check` | Passed |
| Tier 2 / Tier 3 | Not triggered; no live/visual pass claimed |

Logs and emission script/results are retained in the core checkout's ignored
`temp/w2-04-validation/` directory. No W2-05/06/07 consumer migration was started.
