# Resource delivery failure isolation

A recoverable resource failure must preserve the containing conversation. Local renderer bindings and serialized resource destinations must describe files that the writer accepted, rather than filenames allocated by an export plan.

## Delivery boundary

- `core/resources/resourceResult.ts` supplies a small success/failure result, diagnostic conversion, and cancellable waiting. Resource failures stay outside Domain and Document AST.
- HTML, Markdown and both JSON exports wait for resource writes before rendering. The formatter receives successful delivery receipts explicitly. Native `resourceHints`, source URIs and filename plans cannot independently create export bindings.
- PDF acquisition catches individual transport/decode failures. If the actual Typst compile rejects a magic-valid image, isolated image probes identify the offending resources and the pipeline regenerates the payload once with visible placeholders. Shared content-addressed mounts update every affected resource identity; unrelated compiler failures stay fatal. Its offline resource stage returns results only after validating and mounting image bytes; unresolved images retain visible placeholders. Delivered and ZIP-finalized export records become `partial` when an image is unavailable. MIME/extension correction warnings alone do not change delivery status.
- Takeout imports retain conversations and healthy resource bytes when a bound ZIP entry rejects or contains no bytes. Import resources become available after the Domain repository write succeeds. Repository write failures remain fatal.
- Direct and background live save write attachments before formatting Markdown. The background payload carries asset identities so successful writes can bind the correct Domain resources. Filesystem and ZIP writers both return the actual relative destination, including attachment directories. Filename allocation preserves uniqueness after truncation, including direct live save.
- Complete JSON preserves source facts, including original source URIs. Its separate `resources` map describes delivered files. OpenAI JSON resolves attachment paths from delivery receipts and preserves HTTP/data URIs, while unavailable local sources become placeholders. Explicitly failed remote images become placeholders too, preventing a second failed image request inside multimodal OpenAI content.
- The popup single-file action has no companion writer. It displays a warning and placeholders instead of pretending to have delivered local attachments. Complete JSON retains original Domain source facts.
- Cancellation still stops export and suppresses downloads; it is not reported as a failed conversation.

No Domain schema, Document AST, renderer, native parser grammar or storage schema changes are included.

## Fault injection

`tests/resource-delivery.test.ts` exercises actual ZIP output for HTML, Markdown, complete JSON and OpenAI JSON with acquisition exceptions, empty acquisition results, writer rejection, inline document write rejection and malformed inline data. Every emitted local resource destination is checked against nonempty archive bytes, with body preservation, partial records and input immutability assertions.

PDF tests cover acquisition exceptions, empty bytes and corrupt image bytes, preserving healthy mounts and checking the delivered record. Four real vendored-WASM regressions cover magic-valid truncated PNG, JPEG, WebP and malformed SVG, asserting preserved selectable body text and a healthy embedded image. A real-WASM document-error injection proves unrelated compilation errors remain fatal. Takeout tests inject ZIP entry read exceptions and empty bytes. Live-save tests inject filesystem attachment write failure and check the resulting Markdown. Cancellation tests cover blocked acquisition and transport aborts. Existing PDF resource, pipeline, delivery and byte-validation tests remain active; obsolete queue-counter source-text locks were replaced by these behavioral checks.

## Validation

- `npm test`: scoped zero-any, strict TypeScript, all Python contracts and 239 TypeScript test suites, production build and 63 Playwright cases passed.
- The new resource fault-injection suite passed all 37 cases, including actual ZIP receipts, filesystem paths, shared PDF mounts and real-WASM decoder recovery.
- `npm run package` passed, producing the 12,509.9 KB production archive.
- The release font gate passed: one 1.22 MB bundled math font; no CJK fonts or embedded font data URIs.
- Scenario corpus validation passed at 20/20 after replenishing all consumed cases.

- Final standard `npm run test:tier2`: 24/24 passed, zero failures, skips or warnings. Extension reinstall, onboarding, two live multimodal conversations, old-conversation promotion, transient deletion, Takeout merge/deep scan, live filesystem writes and physical Markdown/HTML/PDF downloads all completed. The earlier successful live run also passed 24/24.
- The final Markdown, HTML and PDF archives each contained all eight selected conversation bodies and passed the physical export assertions.

Final downloaded archive evidence:

| Format | Bytes | SHA-256 |
| --- | ---: | --- |
| Markdown | 1928795 | `0c12a1ed41d56bf5af095d4dc6ab16cdb5fb498d993105d860348f13d5f6bd11` |
| Markdown | 164754 | `5d51865dd22b4417050a703541312cfb3715b97371f5237f721d652e5ccfb703` |
| HTML | 1957870 | `c0ca88e58dd02575fbd0d6ef35f8b723ec986e2ad68700409ef1f86b243995e5` |
| Markdown | 253538 | `bf9426d69683f02ddbf9c4cab4f27c0f32496198ae1079b22d5186a3d192b654` |
| Markdown | 2203937 | `8b4d32703f87035748dab2ceb75921450e85a1456f2e1d8f2a692920b9d6c293` |
| Markdown | 164758 | `30682263fcf7add864d1ae561ab6a08928ccf1fb29acb5a3f00e8a23f7041a92` |
| HTML | 2262672 | `5f0c350d220220a5fe89bec4b865fd96eb638a46e73658b8eabbc0e69a7ac71d` |
| Markdown | 254407 | `173fcae1a36ea973167ddd75b3d8c1cc5bc589c8f248c2c9c4fee8ac1920601d` |
| Markdown | 178869 | `6b4fff01dfc62a2c72e6984eaad01440e5b2166c2b178b362ecd8d6d798da345` |
| Markdown | 2129986 | `6103ff6fe4ce3995802bd3b65b812f929884dee04f3915719c0905ba3f71a1e3` |
| Markdown | 254408 | `a783ab3539f03177f76b91cb6edaedb3def5b88263f26f6b53471294d17ea319` |
| HTML | 2187055 | `7d285446d89cd5d30094e8ae891f13a6a5d3eaaf76bf45259a03f053a47ddd9b` |
| Markdown | 179560 | `ac0f7b25922828d823ac813fee381e268b25cd0088afe4ee244667b0e04b4d12` |
| PDF | 2315987 | `cbb0adf4a38d2587082ecd0891b16a6d0eba7d70cf08d4c3c25350815cd995fd` |
| PDF | 2395993 | `9af691ccd87ba8954fd421b11af3101f9399659c9129e803c595953f65025c57` |
| PDF | 3535726 | `ae0a4052a4e7256124deadba00a5cfc281a1a2c0438f1fc4e835a661489a7fa0` |


## Chrome test environment

The first live attempt stopped during `Extensions.loadUnpacked`, before any feature test. macOS recorded an `EXC_BREAKPOINT` / `SIGTRAP` browser-main-thread crash. Restarting the dedicated test profile with `--enable-unsafe-extension-debugging` allowed the same installation command to succeed, and the full lifecycle then started normally. This establishes a working configuration; the unsymbolicated crash report alone does not establish the exact Chromium assertion.

The three platform launchers now pass the extension debugging flag required by the [Chrome DevTools Extensions protocol](https://chromedevtools.github.io/devtools-protocol/tot/Extensions/). Browser termination is not used as normal test cleanup.

## Live driver targeting

The next live attempt exposed a pre-existing composer selector problem: a broad `div[contenteditable="true"]` fallback selected the Canvas editor when it preceded the chat composer. The shared test-driver selector now requires the textbox inside `rich-textarea`. A browser regression places Canvas and a hidden clipboard before/inside the composer and verifies that only the chat textbox receives the prompt. The failed attempt was not counted as a passed Tier 2 run.
