# Resource metadata type cleanup

Baseline: `2f32fd5f`. This continues the internal type-contract cleanup from
[the first batch](weak-type-debt-cleanup.md).

## Root cause and repairs

Provider adapters already produce typed resource evidence. The shared resource
resolver discarded its field relationships through `Object.entries`, `Reflect.get`
and computed `Object.assign`. Domain generation and acquisition projection used
`Object.fromEntries` dictionaries, including an `as unknown` on a reflected field.
The list merger also mixed string arrays with link-object arrays and wrote them
back without checking the destination element type.

- Known-field copying now links the destination type, source field and selected
  key through `copyDefinedField<T, K extends keyof T>`. Five real uses share this
  operation: normalized scalars, merged scalars, merged generation, Domain
  generation and acquisition hints. The existing field whitelists remain explicit.
- List merging retains the same occurrence-count algorithm in `mergeValues<T>`;
  sections, links and candidates are assigned separately with their own element
  types. No type recovery assertion is needed.
- Source tokens are optional strings, matching their existing producer contract
  (`ImageAttachment.token` and the wire parser's string check). The shared resolver
  no longer widens them to `unknown` or rechecks their primitive type.
- Byte decoding uses the existing buffer/view union directly; it removes a redundant
  view cast and repeated primitive checks on typed base64/Markdown fields. Native
  Buffer detection and actual input decoding remain in place.

There are five repaired type-loss sites (scalar normalization, scalar merge,
generation merge, Domain generation projection, acquisition-hint projection), plus
the list element relationship. Two downstream casts disappear. Public resource
models, output fields, alias resolution and timestamp normalization are retained.
No new `unknown`, decoder, state, or exception was introduced.

## Complexity and proof

Production diff: +51/-50 lines (net +1). No interfaces or state are added
or deleted. Two helpers replace unchecked dynamic operations and preserve actual
input/output type relationships. Their cost is justified by compiler rejection
of wrong field values and cross-field writes, and separate list element types.
The generic list merge is a real generic algorithm, so its unconstrained generic
syntax is retained deliberately; a syntax count is not a defect count.

Tests retain the generated-source precedence, immutable input and round-trip
export cases. A new focused case checks ordinary empty-field fill, retained empty
generation prompts, zero ordinals, and multiset behavior for all three list types.
Four negative type cases reject a string timestamp, source-only Domain field,
string image ordinal and non-string provider token.

The existing six-rule unsafe-flow gate now covers all shared resource files and
`attachmentBytes.ts`, including future files in the resource directory.

## Comparable AST inventory

Both inventories use skill `audit-types.cjs --roots src,tests,scripts`, with an
explicit TypeScript 5.9.3 Compiler API sidecar. Source columns are the production
subset; all columns also include tests and scripts. Legitimate `as const`,
constraints, primitive boundary checks and generic algorithms are reported as-is.

| Category | Source before | Source after | All before | All after |
| --- | ---: | ---: | ---: | ---: |
| any | 0 | 0 | 1129 | 1129 |
| unknown | 526 | 524 | 1339 | 1337 |
| object | 7 | 8 | 20 | 21 |
| broad-record | 123 | 123 | 350 | 350 |
| as-assertion | 46 | 44 | 1025 | 1023 |
| angle-assertion | 0 | 0 | 0 | 0 |
| as-const | 24 | 26 | 368 | 370 |
| non-null | 32 | 32 | 422 | 422 |
| generic-unconstrained | 11 | 12 | 46 | 47 |
| generic-constrained | 22 | 24 | 43 | 45 |
| runtime-typeof | 837 | 830 | 1048 | 1041 |
| type-query-typeof | 44 | 44 | 228 | 228 |

The complementary `audit-type-flow.cjs` scan uses the same roots (`src`), tsconfig
and analyzer before/after. The baseline is a read-only archive of `main` with the
same installed dependencies. Parameter-widening candidates change 228→226; there
are no new generic assertion or generic-return-from-any candidates. Both scans
retain one existing TS5 compatibility diagnostic in `credStorage.ts`, so this is
partial cross-version candidate evidence. Native TS7 checks and negative type
cases provide compiler verification; no candidate baseline is auto-approved.

Generic JSON fingerprinting still has a local `unknown` input and replacer callback;
its job is to serialize structured values, and it does not claim a Domain output.
Raw provider/IPC/IDB validation remains outside this typed merge/projection path.
Remaining repository debt (UI DOM generics, Background ingestion casts and browser
capabilities) is not claimed fixed by this batch.

## Verification

- Native TS7 `npm run type-check`: passed, including four negative type cases.
- `node scripts/check-zero-any.cjs`: passed with expanded resource coverage.
- Focused resource identity, alias and persistence regression: 35 passed.
- Focused merge and Domain metadata tests after the new case: 20 passed.
- `npm run lint`: no warnings in the changed resource files; debt remains elsewhere.
- Full Tier 1 `npm test`: passed (369 unit test files, build and font gates;
  Playwright 169 passed, 1 existing skip).
- Tier 2/3 live tests are not run: this changes typed metadata transfer, not the
  Protobuf/JSPB decoder, interception, history order, Takeout interpretation or UI.
