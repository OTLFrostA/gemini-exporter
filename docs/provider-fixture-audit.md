# Provider fixture audit (2026-10-27)

The audit covers native provider fixture definitions and their consumers in unit,
integration and Playwright tests. `ChatGPT` is the OpenAI website provider; these
fixtures are not OpenAI public API responses.

Run `node scripts/audit-provider-fixtures.cjs` for the endpoint inventory, or
`node scripts/audit-provider-fixtures.cjs --json` for every key, definition line
and reference location. The scan includes TypeScript/JavaScript consumers and Python-embedded Node probes,
as well as keys stored in arrays, default
parameters and conditional dispatch. It counts quoted references, including
signature constraints and generator-to-generator references, **not runtime
invocations**. Constructed dynamic names cannot be proven by this textual scan;
`npm run type-check` separately checks endpoint generator arguments. Unkeyed
capture APIs (`geminiListPage`, `geminiListPages`, `geminiRpcPacket`) are exercised
by their existing capture and consumer suites and are not included in this table.

| Provider | Keyed fixtures | Disposition |
| --- | ---: | --- |
| Gemini | 474 | Reuse captured normal traffic; retain explicit protocol/content/state counterexamples. |
| ChatGPT | 111 | Session, List, Detail, Stream, Delete, download URL and signed bytes already use their matching generators. |
| Claude | 60 | Move six Organizations responses into its generator; correct a List request that received Organizations data. |
| Grok | 19 | Add keyed captured Detail/metadata/tree/response loaders and explicit List/account variants. |

There are no unresolved keys or unreferenced fixture definitions after removing
four unused Gemini request/stream samples. This does not imply every mocked
callback is executed: some provider tests install unused List ports while testing
Detail acquisition.

## Gemini capture replacement decisions

- **Recent List:** keep the 23-page, 458-conversation capture chain. Normal
  acquisition uses its paired requests/responses; state-transition fixtures use
  `geminiListRow` / `geminiListVariant`. UUID attribution List fixtures now use
  that same captured row layout instead of a separate six-slot row constructor.
- **Detail:** the storage-extension and raw-export probes now replay the complete
  seven-turn capture. Their assertions require all 14 messages, preserved request
  identity and real transport bytes. Storage also checks the fixed final captured
  answer after the source tab closes; the page's unrelated DOM text is a decoy.
- **Identity-dependent Detail:** bridge admission, passive save, live-save routing
  and both UUID attribution variants retain all seven captured turns and change
  only the conversation ID. A regression reverses this substitution and requires
  byte-for-byte equality with the captured body, including framing.
- **Stream:** answered, unresponded, request-identity and framing variants now
  derive from `gemini_answered_stream.json`. Unicode, corrupt length, error
  trailers and cumulative oversized streams remain explicit stress variants.
- **Delete:** the realtime native-void success case now uses the saved GzXR5e
  acknowledgement, including its framing/trailers. Echo, foreign-target,
  malformed and error variants stay dedicated; they test acceptance/rejection
  conditions the ordinary empty acknowledgement cannot establish.
- **Pinned:** the saved empty Pinned response proves only empty source end.
  Populated Pinned and cross-stream ordering/cursor states remain synthetic.
- **Structured content:** captured citation, table, code, file and image fragments
  stay in content-specific fixtures. Their reconstructed RPC wrappers are not
  original captured HTTP packets. The inline combined-citation counterexample
  now embeds the saved native citation nodes in an explicit wire paragraph
  instead of calling the production decoder to manufacture the input under test.

The synchronized main branch adds 11 metadata-only title/identity boundary
fixtures. They remain explicit counterexamples: the seven-turn Detail capture
cannot establish missing/wrongly typed metadata fields or a metadata-only result.

Retained keyed List/Detail families cover malformed transport and inner slots,
historical layouts, RPC isolation, exact 1096/1167 types and ownership, title
arbitration, timestamps/freshness, pagination conflicts, candidate selection,
empty-turn admission, unsupported documents, citations/resources and media
identity. Replacing these with an ordinary successful page would remove the
condition being tested. Mixed List+Detail and production export examples with
specific authored content remain explicit derived/synthetic scenarios.

## Other providers and provenance limits

ChatGPT and Claude generator bodies are chiefly **synthetic protocol fixtures**.
Centralizing them under `Gen(key)` does not make them captures. The committed
ChatGPT DIL corpus is captured component content, not evidence for Session,
List, pagination, deletion or signed-download HTTP envelopes. The Tier 2 golden
files contain IDs/oracles, not replayable native responses; they cannot replace
those endpoint fixtures. Branch, missing-parent, tool, widget, retry, malformed
identity and resource cases therefore keep their specific synthetic inputs.

Claude account observation was missing from its closure guard. It now obtains
all Organizations payloads from `organizationsGen`, including malformed rows,
cache changes, invalid envelopes and HTTP failure bodies. Its discovery-injection
mock dispatches Organizations and List requests to their respective generators.

Grok's existing text/image JSON captures now load as fresh copies through keyed
generators. Metadata, response tree and load-responses bodies retain their
separate endpoint identities. List envelopes/cursors are explicitly synthetic
variants around captured conversation metadata. User identities are synthetic
and independent of conversation IDs; the browser mock previously reused the
conversation UUID as `userId`. Unexpected browser endpoints now fail instead of
receiving a generic empty array. Parser mutation tests remain visible at their
assertion sites, starting from a fresh captured input each time.

The common fixture contract rejects runtime imports of production parsers into
provider generators. Provider closure guards cover Gemini, ChatGPT, Claude and
Grok. The capture/independence tests and browser consumers verify that replacing
ordinary payloads does not remove completeness, source binding or export checks.
This change does not alter production code or claim a new live Tier 2/3 pass.

## Full-gate environment repair

The complete local gate exposed a separate launcher bug: after preceding browser
harness tests put pressure on ephemeral ports, `connect_ex` returned
`EADDRNOTAVAIL` (49 on this macOS host) for an occupied loopback listener. The
launcher incorrectly treated every nonzero result as a free target port.
`ensure_port_free` now checks binding the target address directly. It rejects
both listening and bound-but-not-listening sockets, does not allocate an outbound
port, and preserves non-occupancy OS errors. Regression tests cover these cases.
No extension source or shipping manifest is changed.

## Fixture structure and provenance

The current registry contains **664 fixed keys**: 530 synthetic, 126 derived and
8 returning captured units. These are source classifications, not test quality
scores. A synthetic malformed input can establish a boundary that a successful
capture cannot. Saved decoded fragments, timestamp measurements and reconstructed
wire envelopes do not count as original captured HTTP exchanges.

The endpoint entrypoints and all existing keys remain compatible:

- `geminiDetail.ts` aggregates fixed case maps under `gemini/detail/`. Small
  builders are grouped into protocol, structured content, resources, integration
  and version modules. Saved structured fragments live in `detail/sources.ts`;
  shared timestamp/file inputs live in `gemini/sources.ts`. Builders do not call
  production parsers.
- `gemini.ts` delegates to `gemini/list/cases.ts`, shared List builders and the
  bounded pagination module. Existing capture loaders remain the source of normal
  List transport and rows. `paginationOrigin` documents the six constructed key
  families separately from the fixed-key inventory.
- Grok has distinct Detail, metadata, responses, tree, List and User modules.
  `grok/sources.ts` owns fresh-copy loaders shared by endpoint cases. The former
  Detail module reexports metadata/responses/tree generators for existing callers.
- ChatGPT and Claude retain their small endpoint modules and now expose the same
  metadata contract. Their authored endpoint samples remain synthetic.

`provenance.ts` defines a small discriminated union:

| kind | Required information | Meaning |
| --- | --- | --- |
| `synthetic` | purpose | Authored protocol/content/state sample without saved capture input. |
| `captured` | source path, unit | Returns the saved unit directly; the unit may be a sanitized body or a saved endpoint bundle, not necessarily an entire HTTP exchange. |
| `derived` | source paths, changes | Saved input rewrapped, combined, or changed to establish a specific condition. |

Each fixed case map exports `fixtureOrigins`, built from its own keys with an
explicit synthetic default and typed overrides for saved inputs. Repeated source
annotations are shared locally. `catalog.ts` gathers these records without calling
factories or materializing large stress payloads. To inspect the structured data:

```sh
node -r ./tests/ts_register.js -e 'console.log(JSON.stringify(require("./tests/fixtures/providers/catalog.ts").fixtureCatalog, null, 2))'
```

When adding a key, place its factory in the matching endpoint/content map. Use an
existing small builder when it expresses that wire layout; add a focused builder
when needed. If saved input is used, add a `captured` or `derived` override beside
that map. A new map must also be added to the catalog. The contract test rejects
missing/duplicate metadata, nonexistent evidence paths and unresolved fixed keys;
its production-parser independence check now traverses nested fixture modules.
It verifies project declarations and file existence, not external authenticity.
The metadata is maintained explicitly; no runtime heuristic infers provenance
from key names or output shapes.

During this refactor all 664 fixed factories were evaluated before and after,
and their string/JSON SHA-256 hashes matched. Temporary comparison data stays
outside version control. The existing parser, source, mutation and browser tests
remain the behavioral oracles. Full HTTP response wrappers and AST-based fixture
guards are deferred.
