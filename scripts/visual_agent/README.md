# Tier 3 visual test workflow

Use the isolated Chrome debugging endpoint (9222), never a personal browser profile.
The explorer sees screenshots only and operates through the seven visual CLI primitives.
The host prepares the browser; the explorer must not read DOM or application source.

## Fresh install / disconnected onboarding

Stop the previous isolated debugging browser before switching profiles. Preserve its profile
and database for the historical-conversation regression. Start a separate, empty profile:

```bash
GEMINI_EXPORTER_TEST_PROFILE=/absolute/path/to/new-test-profile bash scripts/open_test_chrome.sh --no-gemini
```

Do not open Gemini during preparation. Verify the target inventory contains no Gemini
page. Let the extension installation open its own onboarding Options page. Capture and
verify step 1. The explorer must click the visible “Open Gemini” action itself, verify
the real connection and automatic step advancement, and then continue the guide. Manually
clicking Next is not evidence of a successful connection. If connecting requires a
login, report that prerequisite; do not count later steps as proof of step 1. Use a fresh,
context-free visual explorer and save screenshots, a scorecard, and an HTML report.

For a complete first-connect test without an interactive login prerequisite, clone the
signed-in isolated test profile while Chrome is closed, preserve its login cookies, and
cleanly reinstall the extension only in the clone. Start that clone with `--no-gemini` as
well. The explorer must still perform the first Open Gemini action and verify connection.
Never uninstall or clear the original history profile just to repeat onboarding.

## Page and screenshot readiness

Requested targets are matched to the selected extension and exact page path. An unavailable
target must time out explicitly, never fall back to another website or to Options when Popup
was requested. A Popup opened as a tab does not prove real toolbar-popup context binding.

PNG dimensions must equal the coordinates' viewport. The screenshot primitive retries
resize/compositor races with a bounded limit and fails if they persist. Do not act on an
image that failed this check. The CDP screenshot contains page-rendered pixels, not every browser/OS surface. A native
select picker can be open while absent from this image. CDP keyboard events also do not
reliably reach that picker. Changing `fromSurface` or enabling emulated focus does not
establish native-menu coverage. Native menus and OS file pickers require a separately
authorized native screenshot/input driver through the visual interface. Until it is
verified, report the path as blocked; do not inject JavaScript, use DOM selectors, or
replace the product control solely to manufacture a passing visual test. Keyboard
selection is a separate path and does not prove mouse-based menu expansion works.

The format selector now uses CSS `appearance: base-select` on engines that support
it, following the user's UI redesign request. Its themed picker is rendered in the
page top layer; the format-picker E2E check records actual viewport screenshots and
exercises pointer selection, keyboard selection, Escape and outside dismissal. Older
engines retain the native fallback and its capture limitation. This does not unblock
OS file dialogs or constitute a completed live Tier 3 run.

## Downloads and export checks

Use `click --wait-download --timeout 60` on the actual export button. It keeps routing alive
and waits for a newly written, nonempty, stable supported export file, without `.crdownload`.
A single conversation without delivered attachments can produce `.md`, `.json`, `.html`, or
`.pdf` directly; a ZIP is not always expected. ZIP candidates must also be valid archives.
`wait-on --condition download_complete --min-mtime <timestamp>` supports either form;
`zip_downloaded` remains a ZIP-only compatibility alias.

```bash
python3 scripts/visual_agent/cli.py evaluate-export --file '/path/to/conversation.md' --min 1
python3 scripts/visual_agent/cli.py evaluate-export --file '/path/to/export.zip' --min 1
```

Standalone Markdown uses the same content/frontmatter/turn/asset assertions as packaged
Markdown. JSON, HTML, and PDF need format-specific verification; unsupported input must
return an explicit result, never a BadZipFile traceback or a false pass.

Separate download initiation, persisted export completion, actual file delivery, and asset
completeness. A Markdown file can exist while an image failed. Record HTTP status, UI
attachment details, placeholders, and whether the image still displays on the source page.
HTTP 403 alone does not prove an expired image or a logged-out user. A small export that
finishes before the next screenshot cannot prove busy-state locking or cancellation.

Restore viewport/download overrides at the end and preserve all evidence outside tracked
product files. Do not claim uncovered or blocked items passed.
