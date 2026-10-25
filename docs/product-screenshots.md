# Product screenshot capture

The README and user-guide images were refreshed on **October 25, 2026** from
source revision `550852aa`, extension version **2.0.0**, using a running desktop
**Google Chrome 156.0.8078.47** connected at `http://127.0.0.1:9222`.

These are screenshots of the built extension loaded through
`Extensions.loadUnpacked`, with actual Gemini account discovery and conversation
list synchronization. The workbench contains 482 synced conversation records.
No fixture conversations, tab-response stubs, edited DOM text, or image composites
were used. Visible conversation titles and the account display name belong to the
staging account; screenshots do not contain email addresses or conversation bodies.

| Image | Captured state |
| --- | --- |
| [English workbench](../store_assets/screenshot_1_1280x800.png) | Light theme, Markdown, browser download, synced conversations selected |
| [Dark workbench](../store_assets/screenshot_2_1280x800.png) | Local-folder delivery selected; no folder authorized and Live Save off |
| [Chinese workbench](../store_assets/screenshot_3_1280x800.png) | Light theme, browser download, the same synced conversation list |
| [Quick-export popup](../store_assets/screenshot_popup_v2.png) | Actual Chrome action popup opened over an existing Gemini science conversation |
| [Site access](../store_assets/screenshot_site_access_1280x800.png) | Original optional-permission installation, before granting platform access |

Workbench and site-access images are 1280 × 800 pixels. The popup is captured at
its native 360 × 296 pixel size. Captures are direct browser PNGs, without added
marketing text or resizing.

## Refreshing the images

1. Build the intended source revision with `npm ci` and `npm run build`.
2. Start the staging browser with `./scripts/open_test_chrome.sh`, or reuse the
   existing Chrome on port 9222. Load the intended checkout and verify its version.
3. Capture **Site access** before granting any platform access, using the original
   optional manifest. The dialog shows only platforms that still need access.
4. For the signed-in workbench, use the shared local test reinstall entry point
   (`CDPActions.reinstall_extension`) if native authorization would block automation.
   It temporarily promotes optional permissions during installation and restores
   the source manifest immediately. Verify `git diff -- manifest.json` is empty.
5. Open Gemini, let the extension discover the signed-in account, and use **Sync
   All**. Wait for the operation to finish and dismiss the tour. Do not replace
   provider data with fixture records. Review visible titles and account information
   before publishing the images.
6. Set the workbench viewport to 1280 × 800, switch language/theme/delivery using
   the product controls, and capture the three workbench states above. Leave the
   folder unauthorized unless an actual folder has been selected.
7. Open an existing conversation and bring its tab to the foreground. Open the
   actual Chrome action popup, wait for the current conversation title to resolve,
   and capture it at its native dimensions.
8. Visually inspect every PNG, update the date/revision/browser details here, and
   keep README and user-guide captions consistent with the captured states.

This session verifies the documented visible UI and screenshot capture. It does
not constitute the full Tier 2 workflow or validate Chrome's native optional-site
permission approval, denial or revocation prompts. The old opt-in
`tests/e2e/readme_screenshots.spec.ts` uses anonymous fixtures in a separate browser;
its output should not be described as a 9222 staging capture.
