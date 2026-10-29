# ChatGPT attachment download routes

Checked on 2026-10-28 using the project debug Chrome and CDP. The loaded native frontend bundle was:

- URL: https://chatgpt.com/cdn/assets/7078.6cca9159bc.js
- SHA-256: `edff1fc039af2a408c0be578173d1df447cb910f2d4e6d9d94e0189c7a9c4cf7`

The native image URL exchange replaces every `#` in the file identifier with `*` before passing the identifier to `/files/download/{file_id}`. URL-encoding an unchanged composite identifier as `%23` does not perform this protocol conversion. The Domain source pointer stays unchanged; only the request path is normalized.

Uploaded attachments have a separate native exchange: `/conversation/{id}/attachment/{file_id}/download`. Native library-backed files can also use the scoped file exchange. Since older stored locators do not identify library-backed files, an uploaded-file exchange that returns 403/404 gets one scoped file-exchange fallback; HTTP 401, throttling and unrelated failures do not trigger this fallback. The image exchange remains in use for `sediment://` and `file-service://` image pointers. Download responses can carry `download_url` without a `status` field; explicit retry/error statuses must not be treated as success.

## Live verification and limits

For one existing test-account image, the old image exchange, conversation-scoped image exchange, and conversation attachment exchange all returned HTTP 200. The three signed URLs were downloaded to disk: each produced the same decodable 2,159,772-byte PNG with an identical SHA-256. No signed URLs, session credentials, or private response bodies are committed.

The production `ChatGPTProvider` was also exercised with a CDP-backed fetch function and an isolated in-memory Account registry. Its sediment image, legacy file-service image, and conversation-attachment acquisition paths each wrote identical PNG bytes to disk. This was a focused acquisition check, not a full Tier 2 run.

This verifies successful acquisition through the routes, not resolution of the reporter’s 403/404 failures. The debug profile uses a different account. Its sample did not have a composite image identifier or a failing uploaded attachment. Composite normalization and uploaded-file route selection have regression tests grounded in the native frontend implementation; those exact failing resources have not been retested.

Sandbox-generated files use a further native interpreter download endpoint requiring message identity. This change does not implement that separate acquisition path.
