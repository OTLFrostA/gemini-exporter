# Candidate ownership in the detail response

Follow-up to `STRUCTURED_RPC_FINDING.md`, 2026-11-14. The primary-only rule
from PR #705 and later Markdown-based disambiguation were too restrictive.

## Independent protocol evidence

The public frontend decoder for the same captured build
`BardChatUi.en.oaEcnaS9CrQ.2018.O` was inspected with the renderer's dependencies
included. The local bundle SHA-256 is
`f642d6ac662a766dc39a6630ee77b77072f2116e35d64b1f91095453a574054d`.
It is a read-only reference; its implementation is not included in this project.

In that bundle, the conversation response decoder maps the repeated candidate
field with the original candidate index. For each candidate it passes the
document at **that same index** in repeated protobuf field 13 to the response
decoder (`Wmd`). That decoder passes the supplied document to `yK`, which reads
its child nodes. Selection of the displayed candidate is separately by ID,
with the first candidate as fallback. There is no Markdown comparison in this
ownership path.

| Wire field | Meaning |
| --- | --- |
| `turn[3][0][i]` | Candidate at original index `i` |
| `turn[3][3]` | Selected candidate ID |
| `turn[3][12][i]` | Structured document for candidate `i` |
| `turn[3][12][i][0]` | That document's child node list |

This explains why a field containing multiple documents must not be decoded as
one document, searched for similar text, or restricted to candidate zero.
Markdown and native formatting may differ without changing ownership. Identical
draft text also does not make a protocol-bound document ambiguous.

## Regression contract

`gemini_document_ownership.test.ts` independently authors synthetic responses
covering both selected indices, reversed Markdown similarity, CJK delimiter
differences, identical text, missing/empty/rejected selected documents, and
resource isolation. The tests failed before changing the ownership logic.
Unknown nodes still reject the selected document and preserve its raw evidence;
another candidate cannot supply its replacement or attachments.

The evidence establishes this captured schema, not a permanent Google API
guarantee. Schema validation and explicit fallback remain necessary. It also
does not establish a binding for a source reference whose ID has no source
record; in particular, an unbound `"0"` must not be treated as source index zero.
