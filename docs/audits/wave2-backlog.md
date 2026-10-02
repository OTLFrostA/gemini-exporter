# Wave 1 debt handoff / Wave 2 backlog

Recorded during W1 closeout after #757–#761. This is a classified backlog,
not a parser fix or provider API design. Existing #759 characterizations remain
unchanged. Typing work must preserve them; intentional semantic changes require
separate regression updates and the repository's complete Tier 2 live validation.

Classification: **BUG** = demonstrated semantic mismatch; **EXPECTED_COMPAT** =
intentional compatibility behavior; **NEEDS_EVIDENCE** = expectation or payload
compatibility must be established; **WAVE2** = deferred typing/architecture work.
No currently ambiguous behavior is asserted to be EXPECTED_COMPAT without evidence.

## Parser semantic backlog

| ID | Classification | Observed behavior / retained test | Acceptance prerequisite for a separate change |
|---|---|---|---|
| P-01 | BUG | Rejected turn with a readable user payload still emits a user message while turnsRejected increments. Test: `known behavior: rejected turn with a user payload still emits a user message`. | Define whether rejection excludes the entire turn or only part; align diagnostics and messages without dropping valid partial turns. |
| P-02 | BUG | `['rc_missing']` becomes model text via single-element candidate fallback. Test: `known behavior: an ID-only candidate becomes model content through the single-element fallback`. | Distinguish structural IDs from legitimate compact text; add semantic regression and check real compact candidates. |
| P-03 | NEEDS_EVIDENCE | A malformed image tuple rejected as an image can be accepted as a generic user file. Test: `known behavior: a malformed image tuple is eligible for generic user-file fallback`. | Establish valid user-file layouts from payload evidence before narrowing detectors; protect valid uploads and generated media. |
| P-04 | NEEDS_EVIDENCE | Missing-title fallback may use newest wire prompt or chronological first user, depending on extraction path. Test: `detail: missing or malformed titles keep the existing newest-wire-prompt fallback`; existing detail-title tests cover flat message fallback. | Decide intended title source/order and compatibility with stored title authority before a semantic change. |
| P-05 | NEEDS_EVIDENCE | Null user payload can produce a schema-drift warning even when a model reply parses. Test: `detail: absent optional fields and truncated candidates do not fabricate messages or timestamps`. | Inspect legitimate model-only/null-user payloads; decide useful observability versus false positive, retaining real schema-drift visibility. |

All five are deferred. Neither P-01 nor P-02 is silently fixed during Wave 2
typing. Detailed evidence and trust boundaries are in
[RPC/JSPB parser boundary audit](rpc-jspb-parser-boundary.md).

## Provider contract backlog

Every row below is **WAVE2**. The current provider production API remains unchanged.
The [provider contract audit](provider-contract-audit.md) contains the actual
producer/consumer graph and migration prerequisites; this table does not invent
new API fields or implement its proposal.

| ID | Deferred task | Compatibility constraint |
|---|---|---|
| C-01 | `items` versus `conversations` migration | Move actual sync readers before removing the runtime alias. |
| C-02 | Separate `hasMore` from `exhaustive` | Never reconcile deletions from an incomplete list. |
| C-03 | Explicit `completionReason` mapping | Preserve natural exhaustion, watermark/unchanged boundary, loops, max pages, limits, errors and aborts. |
| C-04 | Typed diagnostics envelope | Preserve stored diagnostics and Google-limit/stopReason UI readers. |
| C-05 | Gemini evidence versus provider-neutral core | Keep raw wire/parser evidence behind the typed Gemini boundary; preserve debug/export readers. |
| C-06 | Runtime detail envelope typing | Cover provider, DOM, injected client, Takeout and stored-detail acquisition paths. |
| C-07 | Cancellation contract | Preserve actual global/client abort behavior and account isolation before introducing a stricter contract. |
| C-08 | Tighten `ActiveClientContract` | Coordinate with cancellation; do not merely remove the assignment escape. |
| C-09 | Typed multimodal/citation/structured-content mapping | Preserve attachments, generated-media identity, reports and canonical normalization. |
| C-10 | Reassess optional `fetchAsset?` scaffold when a real caller exists | Retain the current seam; export asset delegates have a different contract. No speculative implementation. |

Recommended first Wave 2 task: type current parser schema/protocol/facade
dependencies and diagnostic outputs, reuse existing media/citation/title types,
and retain all 19 boundary characterizations. Proceed to unknown JSON decode and
small envelope guards only after focused suites, corpus and full Tier 1 pass.
Provider migration follows typed pagination/diagnostic outputs, rather than
starting with a wholesale public-interface replacement.

## W1 acceptance and closeout history

[W1-05 integration report](wave1-integration-report.md) is a historical snapshot:
its lint failure describes the pre-closeout baseline, not a newly introduced
regression. Closeout PR A handles that floating Promise and command/count/title
documentation. Closeout PR B handles the explicit OpenAI title slot, authoritative
guard regression and stale provider fixture. W1 final acceptance is recorded
in the [closeout report](wave1-closeout.md), following both changes and the final
checks. Provider and parser implementation remains deferred.
