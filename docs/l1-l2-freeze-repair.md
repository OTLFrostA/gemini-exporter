# L1/L2 frozen-design repair and contract cleanup

Initial repair: PR #1061, based on `65581493`, merged into `dev/v2` as `4ede73c5` on 2026-10-19. This follow-up starts from that merged commit. The frozen Notion design remains authoritative; the HTTP 429 clarification is the explicitly requested design change.

## Audit disposition

| Audited difference | Result |
| --- | --- |
| Passive confirmed deletion did not reach L2 | Hook transports its already verified request/acknowledgement. Bridge reuses the same deletion parser, checks the source/account, waits for earlier captured admissions, without allowing an earlier failed admission to veto that deletion, then calls L2 through the existing thin Runtime IPC. UI notifications follow committed deletion. The regression exercises the actual Hook, Bridge, Background and IndexedDB, including account switching and rollback. |
| Ordinary throttling inferred from 1096 or error text | Only HTTP 429 triggers throttling/retry. Recent LIST continuation's structured 1096 still represents the confirmed provider pagination boundary. The speculative combined-error-text case is withdrawn, not implemented. |
| Account scan cleanup was non-atomic | Already fixed in base by #1060. Added a real IndexedDB rollback regression proving Coverage and ExportRecords remain together when deletion fails. |
| Temporary download URL entered Asset.sourceUri | Prefer an unchanged durable source URI over resolved download URLs. Known signed download URLs (`X-Goog-Signature`/`X-Amz-Signature`), `data:` and `blob:` stay out of persisted Asset locators; current acquisition hints retain them. Changing a signed download credential does not change an available durable resource identity. L2 rejects these known transient locator forms. Query parameters on durable sources are preserved. |
| Coverage implicitly required Index.updatedAt | Validate source-key membership independently of optional Index metadata. Source activity evidence can establish Coverage when Index.updatedAt is absent or differs. |
| Undefined optional facts and empty metadata entered Detail | Canonical admission omits undefined optional fields recursively. Generation/document objects with no defined facts are rejected before writes. Canonical graphs keep their identity; caller inputs are not mutated. Explicit known empty arrays remain present. |
| Public PageObservation arrays were mutable | items/keys are readonly arrays; a compile-time contract accepts readonly caller evidence and rejects mutation through the observation. |
| Storage still exposed retired individual write ports | Already removed by #1060. This PR does not restore compatibility writers or old StorageService APIs. |

Sources: [L1→L2 contract](https://app.notion.com/p/3fc5d4d759e181bb9df1d848d3c270b1), [Sniffer](https://app.notion.com/p/3fc5d4d759e1819e878ed6b1b331b4b9), [ConversationIndex](https://app.notion.com/p/3fb5d4d759e181c1abd9c0905c44c058), [Resources](https://app.notion.com/p/3fb5d4d759e181aab177d2d6c30292c7).

## Test migration and ownership

Run `node scripts/test-l1.cjs` and `node scripts/test-l2.cjs`. Each manifest records primary-owner suites, cross-module integration suites and type contracts separately. Both categories run; the type checker checks production code plus that manifest's suites/type contracts. The repository-wide `npm test` gate is unchanged.

- `message_bridge`, `observed_page_ingest`, `sniff_watermark_isolation`: use the current L1→L2 ingress, real IndexedDB and request-captured identity. Trusted passive pages can establish Coverage; uncorrelated/unknown/truncated captures cannot certify a boundary. Application cancellation is no longer a passive admission API.
- `conversation_index_storage`: replaces retired Chrome-local/StorageService/Sync writers with L2 admissions and current physical stores. Duplicate observations merge. Detail and minimal Index commit atomically. Confirmed deletion removes facts without tombstones; fresh source observations can recreate them. No legacy cloud-availability/fence schema is reintroduced.
- `content_quality`: asserts source/Detail quality directly; export delivery records are owned by Application Export.
- `domain_trust_counts`: large provider-neutral graphs survive persistence; bytes are owned by an explicitly released task context, not a retired persistent resource store.
- `domain_downstream_boundaries`: delivery history stays separate from validated Domain; table composition retains its existing boundary regression. Retired diagnostic snapshot recovery is not a new Domain API.
- `p1_c_regressions`: cancellation/timeout/Retry-After checks use the current Client, resource wait and retry owners. Ordinary failures no longer imply retry; only HTTP 429 does. No retired batchFetcher or AssetPipeline is restored.
- `p1_a_regressions`, `provider_abstraction`, `provider_degrade`, `batch_a_followup`: use the current Runtime message/account contract, supported Content capabilities and acquisition result semantics.
- `regression_lock`: L1 Hook/parser/captured-account scenarios now have a focused executable harness. The Takeout placeholder-title regression uses current import and persisted Index/Detail reads. Retired source-string checks requiring active Content detail fetch and DOM-shell fallback are superseded by current L1 source/parser contracts and MessageRouter capability behavior checks; those retired commands are not restored. Mixed Export/Delivery/UI/release scenarios are preserved in `regression_lock_other_layers.test.ts`, which remains in the normal full test discovery. They are not skipped or declared migrated. Their unrelated retired dependencies still block the full repository gate.
- Browser Domain persistence tests now use v2 stores, atomic rollback and task-scoped bytes. The Content persistence test drives a real captured Detail RPC instead of the retired active Content detail-fetch command.
- Tier 2's deletion oracle now requires a pre-existing local conversation, the confirmed source event and removal of Index/Detail/ExportRecord, while retaining unrelated Index facts. It no longer treats local retention after confirmed deletion as success. All other full-lifecycle phases remain mandatory.

This scoped migration is not a claim that all tests across Application, Delivery, UI and Runtime have migrated. Full-gate failures remain visible and must not be bypassed to merge the PR.

## Follow-up contract cleanup

- Removed the production flat `ChatMessage`/Turn/Attachment/title-map schema (`src/types/conversation.ts`). Historical record grammar now lives only in `tests/helpers/historicalConversation.ts`; current public types come from their Domain owners. Source generation identity lives with its parser evidence.
- Removed Parser `resourceHints` and its archive/destination sidecar from every native parser, page merge and resource closure. Only acquisition hints accompany keyless source facts. Historical archive-path fixtures remain test-only. The type contract rejects the retired Parser property.
- Renamed source attachment/citation/reasoning helpers to describe source interpretation; deleted unused legacy attachment wrapper ports without compatibility aliases. Native wire-format interpretation remains supported.
- Migrated `rpc_list_ingest`, `sync_provider_contract`, `watermark_checkpoint`, `conversation_version`, `conversation_repository` and `p1_archive_retention` to the current Bridge/Provider/L2/read/physical-store owners. They cover committed counts, coverage, source versions, complete/partial selection, Index/Detail separation, account keys, rollback/retry, and ordinary 404 versus confirmed deletion. No old repository, StorageService, syncEngine, tombstone, capture receipt or cloudAvailability model is restored.
- Extracted native page merging, metadata retries, cooperative Takeout decoding, attachment ownership and source generation identity from mixed export suites, so retired export imports cannot prevent those L1 tests from loading.
- Migrated media persistence to L2 snapshot selection plus task-scoped resource acquisition. Known source generation conflicts/ambiguity do not authorize cross-source matches. URI-less bytes remain task output; fresh/released tasks cannot recover a persistent cache. Archive path/byte receipts never become Domain fields. The retired persistent-resource-cache behavior is intentionally replaced, rather than recreated.
- Export preparation/completion/serialization and resource-delivery fallback scenarios remain in `conversation_repository_other_layers`, `conversation_version_other_layers`, `provider-native-callers_other_layers`, and `media-identity-delivery`. Normal full discovery still executes them and reports their retired dependencies. They are not declared migrated or skipped.
- Updated active local testing guidance to the frozen title and deletion contracts. Old PDF plans are explicitly marked historical; archived audits retain their historical observations.

## Tier 2 test-code migration (live execution deferred)

- Physical stored-conversation probes require an explicit `ConversationKey`, so switching the selected account cannot turn deletion checks into empty reads of another account. The delete test requires pre-existing same-key Index/Detail, a same-window/origin event with captured provider identity and request/acknowledgement, committed removal of all three records and removal of the UI row.
- Scan reset uses Application `clearLocalScanRecords`: Coverage and ExportRecords clear atomically, while Index/Detail stay intact. Current keyed Index rows replace flat ID aliases. Coverage activity evidence does not require matching Index.updatedAt.
- Takeout probes expose keyless source facts and source-path/asset-ID/byte evidence. Assertions check current Index/Detail/Message/Asset schemas, account ownership, source-known roles/content, resource closure and SHA256 bytes with full source paths. Generation metadata does not fabricate an assistant message. Valid partial sources remain allowed; imported counts and required known facts/bytes must still match.
- The offline Python harness has 88 passing tests, including negative cases for flat/old schemas, wrong accounts/assets/bytes, invented message assumptions, and false deletion success. Probe TypeScript is included in the L1 manifest type check. No real Chrome/Gemini Tier 2 session was started for this follow-up.

## Validation

- L1 manifest: **613/613 passed**, zero skipped. L2 manifest: **288/288 passed**, zero skipped. Both production-plus-manifest TypeScript checks passed. The manifests overlap on integration suites; these counts must not be added as distinct test totals.
- Offline Tier 2 Python harness: **88 passed**. Python framework syntax and the bundled probe build passed. No live Tier 2 run was started.
- Scoped zero-any and production build passed (six bundles, zero warnings). `git diff --check` passed.
- Repository `npm test` remains blocked by **219 test TypeScript diagnostics**, with zero diagnostics in production `src/`. Full unit discovery: **1,744 passed, 202 failed, 6 cancelled, zero skipped**. Legacy export/delivery/UI/runtime failures remain visible; this is not a green full repository gate. The historical Python aggregate runner additionally stops on its retired `src/content/syncEngine.js` source-string check; the current full Node unit discovery was run independently, without changing either runner.
- Scenario pool remains **20/20**, with zero entries consumed by this follow-up.

The follow-up PR stays draft while the repository-wide gate is red. PR #1061 is already merged; this draft contains only the additional cleanup after that merge.
