# W2-06 Detail transport / content consumer

Baseline: `7570b40` (#769). Provider core, Gemini companion, registry/resolver,
parser, pagination, storage schema and export formatting remain unchanged.

## Runtime envelope and acquisition

`src/types/detailTransport.ts` describes the existing flat runtime payload; no
new serialization layout or generic extension bag is introduced.

- `GetConversationDetailResponse` discriminates successful `batchexecute` and
  `dom` responses, and failures. RPC carries the complete frozen
  `GeminiProviderConversationDetail`, or a separately declared deleted result.
  DOM carries `DomDetail`, or an explicitly declared empty DOM result.
- `DomDetail` extends the neutral id/title/messages/url/time/count core with
  observed DOM title metadata, image/attachment fields, HTML-length raw evidence,
  network/404/selector debug observations. It does not require RPC pagination,
  parser diagnostics, documents or drift fields that DOM never produces.
- `ContentConversationDetail` joins Gemini and DOM acquisition shapes for
  live-save. `DetailClient` promises only the injected operation implemented by
  GeminiAPIClient: typed paginated Gemini detail (or null). It does not pretend
  arbitrary clients produce wire data or promise lifecycle/abort methods.

Provider messages and evidence pass by identity: generated media/request
identities, images, attachments, documents, citations/sources, structured content,
thoughts/grounding markers, title provenance, nullable time aliases, raw/debug,
drift/rejection and truncation evidence are retained. No text-only projection,
field filtering or new timestamp normalization is added.

Router responses are checked through a local typed responder before entering
the broader runtime dispatcher. Title persistence inputs and its storage updater
are typed. DOM scraper detail outputs/message assembly are typed directly,
rather than asserting its previous `any` output into a Gemini contract.

Live-save still prefers an explicitly injected constructor; otherwise it resolves
the current application provider. Nonempty success returns the original object.
Missing/invalid chatTime still derives from the greatest valid message timestamp,
setting only falsy updatedAt/timestamp aliases as before. Empty or failed RPC
falls back to parsing the current document; an empty DOM result returns null.
The preexisting nullable-document invocation in test environments is retained
via a non-null assertion (erased at runtime), not a new skip/guard.

## Empty, deletion and debug behavior

Router still prefers nonempty RPC, then fetched/live DOM fallback. Empty RPC
keeps raw keys and JSON previews in `ProviderEmptyDebug`; raw remains unknown,
not a validated wire record. Ordinary RPC failures retain error debug and allow
DOM fallback. Confirmed RPC deletion still prunes storage and responds immediately
without DOM; DOM 404/not-found flags and existing deletion error strings still
prune only confirmed deletion. Empty DOM success combines RPC and DOM debug,
marks isEmpty versus isDeleted, and retains the existing localized error text.
DOM exceptions return failure with combined debug. Exactly-once/fail-closed
response behavior remains unchanged.

## Narrow downstream changes and deferred work

`messages.ts` reexports the response contract. `exportCompletion.ts` accepts the
existing `TitleSources` input, whose entries may be undefined; this is the minimal
type correction required to remove live-save's title-map cast. Title arbitration
and output record types remain unchanged.

Broad request dispatch, asset responses, scan dispatch and global cancellation
in messageRouter are deferred. ActiveClientContract is not used by this detail
acquisition path and remains unchanged, including its cancellation mirror.
Live-save queue, badge/runtime bridge, binary conversion, asset writer/target and
filesystem contracts are deferred. BatchWorker and canonical/export acquisition
migration remain later work. ApplicationProvider retains the existing explicit
Gemini assumption at the content boundary; registry/resolver stay neutral.

No permanent zero-any scope is expanded. `detailTransport.ts` and the new typed
regression suite contain no explicit any and are eligible. `messages.ts` is
also clean. Router and live-save still have the unrelated escapes above; DOM
scraper retains its network catch/sidebar/page-debug escapes. ExportCompletion
retains its broader export record/input escapes and is not whole-file eligible.

## Runtime scope and verification

Emission comparison against baseline uses unmodified esbuild output (chrome120,
ESM, syntax/whitespace minification). DOM scraper, live-save coordinator, messages
and exportCompletion emit byte-identical code. Router differs only by introducing
the typed detail-response forwarding closure and routing detail responses through
it. New transport types emit no runtime data transformation. This is not a claim
that the whole patch emits identical JavaScript.

AGENTS Tier 2 triggers (Protobuf/JSPB parsing, Takeout import, sorting, network
interception or release) are untouched. No Tier 2 or Tier 3 pass is claimed.

| Check | Result |
|---|---|
| `npm run type-check` | Passed |
| Provider filter | 7 suites passed |
| messageRouter / liveSave filters | New six-case typed contract suite passed |
| Existing `live_save` / `seam_s1_content_router` filters | 5 live-save suites and 1 router suite passed |
| `CI=1 npm run test:changed` | Strict types, 42 affected unit suites, build and 43 E2E passed |
| `CI=1 npm test` | Scoped zero-any, strict types, all 197 unit suite files, production build and 43 E2E passed without retries |
| `npm run pool:status` | 20/20; no scenarios consumed |
| Explicit-any scan of new types/tests and messages | Clean; permanent gate unchanged |
| Emission comparison | Four existing modules byte-identical; router forwarding closure differs |
| `git diff --check` | Passed |

Logs and comparison script are retained in the core checkout's ignored
`temp/w2-06-validation/` directory.
