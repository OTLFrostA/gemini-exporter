# Conversation source timestamps and saved versions

## Live evidence (2026-10-14)

A read-only audit used the authenticated dedicated debug Chrome session. It fetched
one 50-item MaZiqc page and six matching hNvQHb + targeted MaZiqc batches. Production
List and Detail parsers replayed the captured responses locally. No prompts were
sent or conversations modified. Raw private responses remain outside the repository;
the checked-in fixture contains only anonymized timestamp pairs and structural counts.

| Sample | List updatedAt (ms) | Latest detail turn (ms) | Batched metadata (ms) | Messages |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1792011603510 | 1792011603510 | 1792011603510 | 12 |
| 2 | 1792011347034 | 1792011347034 | 1792011347034 | 10 |
| 3 | 1792010344820 | 1792010344820 | 1792010344820 | 10 |
| 4 | 1791859894717 | 1791859894717 | 1791859894717 | 14 |
| 5 | 1791785795200 | 1791785795200 | 1791785795200 | 14 |
| 6 | 1791702686294 | 1791702686294 | 1791702686294 | 14 |

All six raw `[seconds, nanoseconds]` pairs also matched exactly. All six detail
responses exhausted their cursor; this sample does not establish universal equality,
metadata-only behavior, concurrent edits or correctness across multiple live detail pages.

The observed List response is `[null, cursor, rows]`, with activity at `row[5]`.
Targeted metadata is `[null, null, [row]]`, with the same `row[5]`. Detail is
`[turns, cursor, null, documents]`; these real turns carry their timestamp at `turn[4]`.
A structural timestamp scan found message/resource/document times, but no independent
conversation update field in the hNvQHb body. Document/resource timestamps are not
conversation versions. The existing Detail request already batches targeted List
metadata, so no additional request is required to obtain the authoritative activity time.

Before removal of the redundant Detail field, a real run created a new five-turn conversation and performed its initial
export. A read-only query of actual extension Chrome storage and IndexedDB then found:
`Index.updatedAt = Detail.updatedAt = savedAt = 1792015421221`, with ten saved messages
and `completeness: unknown` (no detected partial pagination). This verified the captured source-version value before the structural cleanup below;
it does not validate the final field removal or claim full Tier 2 acceptance.

## Canonical contract

- `createdAt`: source-authored creation, omitted when unknown.
- Index `updatedAt`: latest known source-authored conversation activity, used for sorting.
- Detail has **no `updatedAt`**. Acquisition carries a transient `sourceVersion` from
  matching batched List metadata, never message maxima or unrelated rows.
- Storage `savedAt`: the source version of the selected, nonpartial saved body, on the
  same scale as Index `updatedAt`. It is absent when version/coverage cannot be established.
  The transient `sourceVersion` is not a separate persisted field; storage reads reconstruct
  it from `savedAt` for formatting/export and Index observations.
- `revision`: an opaque local record token, independent of source activity versions.
- Export `chatTime`: source version of the body actually exported. `exportedAt` remains
  the physical export time and cannot prove source freshness or override a newer Index.

A later List may advance Index to v2 while cached Detail's savedAt remains v1. That
is expected staleness within one shared version scale. A rejected older/partial incoming
capture leaves the selected body's savedAt unchanged. A newly stored partial body,
metadata-only result, unknown version or version change during pagination cannot claim
an up-to-date saved version. Legacy v1 metadata and local save clocks cannot prove the
version of cached bodies; migration preserves those bodies without inventing a version.
Takeout dates describe observed offline activity; imported coverage stays partial.

The old `lastMessageAt` branch and generic List timestamp-slot scans were removed. Unknown
versions require refresh rather than incremental skipping. Known source versions compare
exactly, without a local-clock lock or a 2-second grace interval. Canonical observed
message-count increases still require export.
