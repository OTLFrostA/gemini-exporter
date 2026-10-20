# Fake Gemini Browser Harness (offline, real extension)

**Purpose:** run the **built Gemini Exporter MV3 extension** inside Chromium against
a controllable synthetic Gemini website at `https://gemini.google.com/app`, without
logging in or accessing Google. Only Gemini's **website and network** are faked.
The extension's actual Content script, MAIN-world hook, Background service worker,
L1 parser, L2, IndexedDB, Popup and Options are **not replaced**.

This is a reusable **test environment**, not a claim that the mocked private
Google protocol is current. The baseline synthetic replies came from this
repository's pre-existing E2E examples.

## Run

From the repository root:

```sh
npm ci
npm run build
npx playwright install chromium
npx playwright test tests/e2e/fake_gemini_browser.spec.ts --workers=1
```

For actual browser windows, interactive debugging and diagnostic screenshots:

```sh
FAKE_GEMINI_SCREENSHOTS=1 npx playwright test tests/e2e/fake_gemini_browser.spec.ts --headed --workers=1
```

Screenshots go to `tests/output/fake-gemini/` (ignored by Git). They are for
human/AI **visual inspection only**. This change does NOT add screenshot
comparison tests or change existing onboarding/production UI.

Playwright's existing `tests/e2e/fixtures.ts` loads the unpacked extension from
the repository root and requires `dist/`, hence `npm run build` first. The
harness uses `BrowserContext.route` before any simulated Gemini tab is opened.
Opening `https://gemini.google.com/app` is entirely offline: Playwright
fulfills the main document with a minimal HTML shell, but Chromium treats its
origin as the real hostname for Manifest V3 match rules. The built extension
can still inject its real content scripts.

## Mock surface

| Surface | Request/response behavior | Synthetic fidelity |
| --- | --- | --- |
| Gemini page / `/app/:id` | HTML with WIZ account bootstrap, sidebar, test controls | Minimal DOM, NOT a pixel replica |
| `MaZiqc` | Recent/pinned lists, source ordering, terminal cursor, multi-page `tC_*` | Based on existing test samples |
| `hNvQHb` | One conversation with prompt and model response; optional combined metadata request | Based on existing test samples; no detail continuation yet |
| `GzXR5e` | Positive deletion acknowledgement, synthetic list removal | Based on repository parser contract |
| `CNgdBe` | Empty Gems list | Placeholder (not yet characterized) |
| `StreamGenerate` | Synthetic streaming completion marker | Placeholder (NOT authenticated-verified streaming) |
| `googleusercontent.com`, `usercontent.google.com`, `gstatic.com` | Deterministic one-pixel PNG | Resource placeholder |
| Unexpected Gemini endpoint / unknown RPC | 501 / 400, recorded structurally | Intentionally fail-closed |

The baseline contains three fake conversations and two-item pages. The test
page has buttons for **Load conversations**, **Load next page**, **Load detail**,
**Load gems**, **Send message** and **Delete conversation**. These trigger
real browser `fetch` calls with `f.req` envelopes; the **actual extension**
observes requests through its existing hooks.

The test asserts at least one realistic pipeline:
page fetch → real MAIN-world capture → real Content → L2 ingestion →
extension IndexedDB → real Options UI. It separately checks that the actual
unpacked Popup renders.

**Important limits:** the DOM is not production-accurate, and StreamGenerate /
image, Gemini Account slot switching, true details pagination, pinned coverage,
rich attachments and advanced media are not yet confirmed against a signed-in
Gemini instance. Browser routing cannot reproduce all Google client behavior,
and Chromium service worker routing is version-sensitive. Browser tests passing
does **not** establish live provider compatibility.

## Local authenticated calibration: instructions for another AI agent

Perform calibration **locally, on the user's computer**, using a normal
signed-in Gemini browser session. **Never upload cookies, authentication tokens,
request headers, HAR files, private prompts, account identifiers or personal
conversations to this repository or any assistant.** Do not request passwords
or copy cookies between profiles.

1. Build and run this offline harness once; note which assertions pass and
   inspect the optional screenshots. Do not modify extension production code
   merely to make the fake network match.
2. In the separate signed-in browser, use DevTools Network or local tooling to
   **inspect** request signatures and positional response layouts for:
   `MaZiqc` recent and pinned (first/next/terminal), `hNvQHb` initial and
   continuation pages, `StreamGenerate` framing/completion, `CNgdBe`,
   and media resource URLs. Check the actual URL path (including `/u/N/`),
   transport method, RPC ID, `f.req` argument structure, response framing,
   pagination markers, and failure categories.
3. **Do not delete real conversations** to test `GzXR5e`. Use the existing
   parser contract or a disposable account with explicit permission.
4. Write *new synthetic fixtures* preserving the **schema**, array positions,
   cursor semantics and frame boundaries. Replace *all* real IDs, timestamps,
   URLs, model text, emails and prompt bodies with artificial equivalents. No
   secret, token, live `at`, `f.sid`, or real conversation content should
   appear anywhere in the new fixture file.
5. Update the harness mapping only when the current real request format has
   been established; remove unsupported assumptions and add new scenarios to
   describe genuine source behavior. Keep production code untouched unless
   a separately verified bug requires a distinct PR.
6. Run `npm run build` and the fake Gemini spec again; also run existing
   related `scan_flow.spec.ts`, `production_v2.spec.ts` and `visual_inspector.spec.ts`
   as appropriate. Summarize *which* source layouts were checked, which
   remain placeholders, and any observed deviations.

### Optional local replay file

A local replay can replace individual synthetic response **bodies** without
editing TypeScript. Place it under `tests/e2e/fake-gemini/private/` (Git ignored):

```json
{
  "provenance": "locally-verified",
  "responses": {
    "list:recent:head": {
      "status": 200,
      "body": ")]}'\n\n[[\"wrb.fr\",\"MaZiqc\",\"[null,null,[]]\"]]"
    }
  }
}
```

The example is synthetic; `provenance` must only be set to
`locally-verified` **after structural verification against the signed-in
provider**. To load a private replay:

```sh
FAKE_GEMINI_REPLAY=tests/e2e/fake-gemini/private/local.json \
  npx playwright test tests/e2e/fake_gemini_browser.spec.ts --workers=1
```

Keys currently supported: `list:recent:head`, `list:recent:tC_2`,
`list:pinned:head`, `detail:<normalized-id>:head`, `delete:<normalized-id>`,
`gems`, `stream:<normalized-id>`. Change the cursor key to match the
synthetic request cursor when replaying pagination.

**A partial replay falls back to synthetic replies for absent keys.** A replay
of one list page is not full protocol verification. If real source cursors
differ from `tC_*`, update the fake pagination logic and fixtures together.

### Privacy and quality boundaries

- The harness saves only `kind`, RPC IDs, stream, cursor, **synthetic**
  conversation ID and status in `harness.requests`; it does **not** log raw
  request bodies, cookies, `at` tokens or response text.
- No raw authenticated recording tool is included. Sanitize locally and
  validate manually *before* creating a replay.
- `private/`, `*.har` and `*.cookies.json` are ignored, but a Git ignore
  entry is not a substitute for checking `git diff --cached` before commit.
- When the fake page or an RPC changes, update **the test harness**, not
  the shipped `src/` implementation, unless real-Gemini evidence establishes
  an actual production defect.

This is intended as a durable local browser sandbox that another AI agent can
calibrate in-place with access to a signed-in session—not a one-off page mock.
