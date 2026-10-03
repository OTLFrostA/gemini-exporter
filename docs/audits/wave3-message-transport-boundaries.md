# W3-02 — Message transport boundaries

Baseline: main `ede3754` (W3-01 / PR #773). This extends W3 by the cause of type
loss: generic Chrome transport, over-promising action guards and unvalidated UI
reply consumption. It does not scan parser/export/storage files for unrelated
`any` or introduce a transport framework.

## Contracts and behavior

- `sendTypedMessage` types its request and returns `Promise<unknown>`. Its former
  caller-selected result generic and default `any` are removed; specifying a
  result type never validated Chrome data. Timeout values and lastError handling
  remain unchanged.
- `isMessageAction` now proves only `{ action: A }`. Matching an action cannot
  prove a conversation ID or any other action-specific payload. Its runtime
  predicate still checks the same discriminant.
- Named TabService sender exports now match their shared `unknown` input/output
  contract, including callback payloads and caught values. Existing tab candidate
  ordering, strict account-slot matching, connection-error-only failover and
  default/explicit timeouts remain intact. Ping requires `ok === true`, so a
  string/number acknowledgement cannot produce CONNECTED. Error status exposes
  only a string message property, rather than leaking arbitrary thrown metadata.
- Background relay callbacks and the public batch-fetcher sender wrapper forward
  unknown replies without claiming a validated background response. They do not
  transform the forwarded data or change batch cancellation/retry behavior.
- `isScanResponse` validates success, optional finite counts, error text, limit
  flags and the two diagnostic fields promised to the UI. It preserves the reply
  and full diagnostic object identity. A malformed reply enters the existing
  rejection cleanup, calls onError and cannot call onFinished. Valid quota/limit
  detection and scan callback shapes remain unchanged.
- Popup validates the success envelope and top-level export input: nullable
  string ID/title and a required message array. Valid nested-data and legacy
  direct-chat replies retain the complete original object. Malformed replies
  produce a fetch error, do not download and release the current-export guard.
  No export format, normalizer, title rule or asset policy changes.

`PopupExportInput.messages` is deliberately `unknown[]`, and extra detail fields
remain unknown. This check does not pretend to validate a complete parsed
`Conversation` or Gemini detail. Deep message/attachment/structured-data validation
still belongs to formatter/parser boundary work. Generic transport also passes
unrecognized responses through as unknown; only the consuming seams validate
what they need.

## Regression and permanent gate

The exact compile-time regression pins awaited opaque sender returns, unknown
input, scan callback parameters and the popup result. It rejects the old
arbitrary-result-generic contract and proves action narrowing does not yield a
`FetchChatMessage`. Static imports and fixtures use no `any`, cast or suppression.

Runtime regressions cover malformed scan fields/diagnostics, scan state release,
no successful completion after malformed replies, valid reply identity and quota
flags, popup envelope/direct-chat preservation, and malformed ping
acknowledgements. The browser regression feeds two malformed popup responses and
then a valid response: no invalid download occurs, the button recovers each time,
and the downloaded Markdown physically contains both the prompt and reply.
Existing timeout and provider tests retain their assertions; source checks use
the newly accurate unknown catch signatures.

The permanent zero-any manifest covers 22 whole production files. Newly added:
`messaging.ts`, `tabService.ts`, `messageResponses.ts`, and `syncController.ts`.
Popup and broad background/batch modules are not misrepresented as whole-file
zero-any: incoming listener payloads, injected module lookups, batch detail
normalization, raw debug/error metadata and formatter internals remain separate
root-cause tasks. Their direct relay/receipt adaptations are included here.

## Validation

- Strict TypeScript, scoped zero-any and focused transport/controller regressions pass.
- Focused popup browser regression and existing popup tests pass.
- `CI=1 npm run test:changed`: 130 impacted unit suite files, strict types, build
  and all 44 affected E2E tests pass without retries.
- `CI=1 npm test`: scoped gate, strict types, 199 unit suite files, build and
  44 E2E tests pass without retries.
- Scenario pool remains 20/20, with no live scenario consumed.

Esbuild output for the generic messaging utility and both background relay files
is byte-identical to baseline; only the TabService checks, UI consumers and new
response-check helper alter runtime behavior.

No Protobuf/JSPB parser, Google request-interception hook, Takeout import behavior,
conversation ordering or release operation changes. These do not trigger Tier 2;
Tier 3 was not assigned. Logs are retained in the core checkout's ignored
`temp/w3-02-validation/` directory before worktree cleanup.
