# L1/L2 frozen-design repair — PR #1061

Base: `65581493` on `dev/v2`. The frozen Notion design remains authoritative; the HTTP 429 clarification is the explicitly requested design change.

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

## Validation

- L1 manifest: 560 tests passed, zero skipped; production plus manifest suite/type contracts pass TypeScript.
- L2 manifest: 231 tests passed, zero skipped; production plus manifest suite/type contracts pass TypeScript.
- Runtime/deletion integration: 67 tests passed, including real Hook → Bridge → authenticated Background → L2 → IndexedDB commit and rollback.
- Headless Domain persistence browser cases: 6 passed. Account Registry browser cases: 6 passed.
- Scoped zero-any gate and production build pass (six bundles, zero warnings).
- Repository-wide `npm test` remains blocked at 295 pre-existing other-layer test TypeScript diagnostics (production source: zero). Normalizing source paths and moved test-file positions introduces no new diagnostic messages. The full unit run also still fails legacy Application/Delivery/UI cases; it is not reported as green. The baseline independently reproduces the stale PDF exporter constructor failure.
- Tier 2 was interrupted and is deferred at the user's request; no Tier 2 pass is claimed. The deletion-oracle changes are not live-validated. Consumed scenario-pool entries were replenished to 20/20 and validated.

PR #1061 stays draft while the repository-wide gate remains red.
