# Domain type boundaries

L1 owns provider interpretation: raw JSON/JSPB, source-specific shapes, timestamp
strings and unsupported-payload formatting. `src/l1/parsers/shared/time.ts` converts
source timestamps to safe epoch-millisecond integers. Domain and downstream code
consume those numbers; they do not interpret provider time strings.

L2 does not depend on L1, directly or through runtime helpers. Its admission/read
operations may use L3a persistence ports. The semantic-layer architecture gate
walks those dependencies and rejects paths back into L1.

## Validation and evidence

Persistence and IPC are separate trust boundaries. They cannot preserve an
in-memory proof, so their L2 decoders deliberately accept `unknown`. Removing those
checks or asserting a raw transport value to a Domain type would weaken the
contract. Semantic variants named `unknown` also remain valid content facts.

`runtimeValidation.ts` describes every Domain field using `Check<T>` and a mapped
`Fields<T>` schema. Required schema entries include optional model fields; a new
field or an incompatible field validator causes a compile error. Recursive AST
variants have individual schemas, and schema checks precede reference closure.

Optional-field canonicalization returns `unknown`, rather than claiming a generic
transformation preserves every possible `T`. Changed graphs are checked before
use. Recovery retains the canonical Index returned by its decoder, omits undefined
optional fields and leaves the input untouched. Already canonical graphs retain
their references.

A private WeakSet records validated body identity only after schema, closure and
conversation identity checks. A lookup predicate consumes that runtime evidence;
there are no casts to a trusted Domain type. Clone/IPC copies must validate again.

## Downstream contracts and gates

L2, L3b and Application have no type-cast expressions or non-null assertions.
Compiler-based architecture tests reject their reintroduction, including ordinary
casts unrelated to the Domain brand. Type-aware lint rejects implicit `any` flow
through these three owners as well as explicit `any`.

Application uses a discriminated pending-export type: JSON has no reading AST;
Markdown, HTML and PDF require one. Composer relationships use typed references,
with explicit failures for violated reference invariants. PDF font mounting is an
optional compiler capability declared in `IPdfCompiler`, not a cast to another
interface. File System Access preserves ordinary byte views and copies shared
memory views only when required by its native write contract.

Compile-time `typeof`, literal `as const`, native capability detection, and
validation of actual external input are not interchangeable with unchecked casts.
This change does not claim zero such tokens throughout the repository. Remaining
native IndexedDB result assertions in L3a, dynamic JSZip/Node module loading, and
PDF sandbox IPC decoding are separate adapter boundaries; generated third-party
WASM declarations are excluded from the owned-source zero-any gate.
