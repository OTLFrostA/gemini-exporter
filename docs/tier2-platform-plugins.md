# Tier 2 platform plugins

Tier 2 has one scheduler and lifecycle for all platforms. Select one or several
registered plugins; platforms run sequentially on the same CDP Chrome (9222 by
default), with isolated artifact directories. A failed platform does not prevent
independent platforms from running. The overall exit code is nonzero if any
selected platform fails or cannot finish.

```bash
# Backward compatible: no selector still selects Gemini
npm run test:tier2
npm run test:tier2 -- --provider chatgpt

# Multi-select (space-separated, comma-separated, or repeated selectors)
npm run test:tier2 -- --platforms gemini chatgpt
npm run test:tier2 -- --platforms gemini,chatgpt
npm run test:tier2 -- --platform gemini --platform chatgpt
npm run test:tier2 -- --platforms all

# Offline discovery and dependency planning; no browser or pool mutations
npm run test:tier2 -- --list-platforms
npm run test:tier2 -- --platforms all --plan
npm run test:tier2 -- --platform chatgpt --list-features
npm run test:tier2 -- --platform chatgpt --features full_reply_fidelity --plan
npm run test:tier2 -- --platforms all --domain export --plan

# Options are scoped: ChatGPT does not receive the Gemini archive path
npm run test:tier2 -- --platforms all --platform-option gemini.takeout_zip=/path/input.zip
```

`--features` and `--domain` apply to every selected platform. Unknown features,
unsupported domains/options, undeclared dependencies and cyclic plans fail
preflight before any browser mutation. IDs may differ between plugins: select
one platform for a platform-specific feature ID. `--takeout-zip` remains an alias
for `--platform-option gemini.takeout_zip=...`. `--dataset` is supplied to each
platform; without a dataset each platform consumes its own two scenarios from
the shared pool. Replenish the pool after live runs per AGENTS.md.

## Boundaries

- `platforms/core.py`: registration contracts, offline plan validation and
  dependency closure, serial platform orchestration, preparation/finalization/
  cleanup, aggregate status and physical JSON reporting. No provider branches.
- `scheduler.py`: shared case execution, prerequisites, ordering, targeted
  subgraphs, failures and blocked dependencies. All built-in plugins use this.
- `platforms/gemini.py` and `gemini_runtime.py`: existing 25 Gemini cases and
  Gemini environment preparation, including Takeout and extension lifecycle.
- `platforms/chatgpt.py`: the ChatGPT cases now run through the same scheduler;
  `chatgpt_live.py` contains site operations and physical evidence collection.
  Mandatory nested evidence (live save, promotion, image pixels, questionnaires)
  still blocks a case if missing. They are not inferred from a successful scan.
- `platforms/claude.py`: Claude cases and acceptance dependencies; `claude_live.py`
  supplies site operations and `claude_evidence.py` reads independent disk evidence.
- `driver/PlatformRegistry`: lower-level browser driver registration; distinct
  from acceptance suite plugin registration. A suite may use such a driver.

Platform selectors/URLs, source capture, environment setup, golden fixtures and
specialized acceptance assertions belong to plugins. Shared orchestration does
not assume Gemini or require every platform to implement Takeout. Capabilities
are declarations of the plugin's test scope, not passed assertions or product
feature parity. Missing capabilities are absent from that platform's scope;
they are never inserted as passing tests. The ChatGPT plugin schedules 22 cases:
native onboarding and badge; passive sidebar collection; 5/8-turn live chats;
independent golden capture; active history scan and account ownership; keyword,
ID and clear-search controls, selection and language; an initial physical export;
live save and older-chat promotion with export advancement; confirmed remote
deletion; physical Markdown/HTML/PDF/JSON and full-reply comparison; golden image
pixels and static questionnaire fidelity; popup export; complete/partial skip;
image export with a stale tab; explicit local cleanup and rescan; and actual
uninstall/reinstall. A declared case is not evidence that a live run passed.
Gemini Takeout import/title promotion and Gemini wire-format comparison remain
Gemini-specific, rather than fake ChatGPT passes. Questionnaire exports preserve
the available static content; executing questionnaire controls in an exported
document is outside this acceptance contract.

Passive collection must work without clicking Sync or issuing a test-generated
list request: after a native page reload, every visible sidebar conversation
must exist under the current Account in L2. ChatGPT currently supplies the first
page through its router's workspace-bound `sidebarHistory.chats` loader; later
`GET /backend-api/conversations` pages are observed separately. The first page
does not create full-history Coverage. Active scan remains a separate gate.

ChatGPT evidence collection does not fetch the full source after every turn.
Each turn waits on the native rendered reply and freezes new loaded-image pixels
from browser resources before older turns are paginated away. Local progress
checkpoints allow an interrupted conversation to resume after one remote prefix
verification. A fresh 5/8-turn scenario pair needs two independent final source
reads instead of thirteen; a partial resume adds one prefix read for that
conversation, and the lifecycle append adds one updated final read. Final reads
still require every expected prompt in order and a completed assistant reply for
every turn.
Markdown/HTML/PDF/JSON physical fidelity and image comparisons remain mandatory.
Source HTTP 429 fails the gate immediately with Retry-After recorded; the test
does not retry that request. Native golden-page load errors also fail without
automatic reloads. Declared coverage and failed runs never become passes by
reusing local evidence alone. These rules govern the test harness; the shipping
provider's bounded, cancellable rate-limit recovery remains separate.

The default output root is `tests/output/tier2/` (override with `--output-dir`).
`tier2-report.json` records every selected platform, declared plan, scheduled
features, actual results, errors and cleanup failures. Pending and blocked cases
are not passes. Targeted runs are marked `scope: targeted`; a successful targeted
run is not a full-suite pass. Each plugin writes evidence under `<root>/<id>/`;
ChatGPT also retains its detailed `report.json`. Reports are checkpointed as
platforms complete; normal test conversations remain retained.

The shared runner owns the process lock through the CLI. Browser interaction is
CDP only. Local Tier 2/3 clean installs use required permissions to avoid native
optional-permission prompts. The shared Gemini/Tier 3 reinstall temporarily merges
optional permissions into their required lists while loading, then restores the
source manifest byte for byte in `finally`, including failures. The running
extension keeps the loaded permissions; reinstall through the harness after a
manual reload or browser restart. If the process is forcibly killed, inspect and
restore the source manifest before committing or packaging.

`npm run test:tier2 -- --platform chatgpt` now builds an unpacked copy in the
ignored `temp/tier2-chatgpt-required-hosts/` directory by default. That copy makes
ChatGPT's two page hosts and image attachment host required. Claude likewise uses
`temp/tier2-claude-required-hosts/` with `https://claude.ai/*` required. Reports
record `testInstallMode: required-chatgpt-hosts` or `required-claude-hosts`.
The source/release manifest is unchanged; normal packaging never reads these
ignored directories. Temporary required permission manifests must never be
committed or included in release packages.

These runs exercise the workflow with installed site access and do not validate
native optional-permission prompts, denial, or revocation. For dedicated native
permission checks, set `TIER2_CHATGPT_REQUIRED_HOSTS=0` or
`TIER2_CLAUDE_REQUIRED_HOSTS=0` to install the ordinary optional-permission build;
those runs may need user authorization. Gemini permission UX checks likewise
require the original optional manifest outside the shared reinstall override.

## Adding a platform

A plugin provides `id`, `capabilities`, `accepted_options`, `features()` and
`open(config)`. `features()` returns case metadata via `feature_spec(case)` without
opening Chrome, consuming scenarios or creating test conversations. `open()`
returns a `PlatformSession` with a DAG, a context containing an initially empty
`FeatureRegistry(standard=False)`, and `prepare`, `finalize`, `close` hooks.
Hooks must release every acquired connection even when preparation fails.
Cases implement `FeatureTestCase.execute(ctx)` and return actual evidence;
false returns and exceptions fail the case. The framework owns target selection
and expands dependencies. Plugin declarations and runtime case IDs must agree.

Register the plugin in `platforms/__init__.py`, or expose an explicit Python
module with this function:

```python
# my_team/tier2_provider.py
from .provider import MyPlatformPlugin

def register(registry):
    registry.register(MyPlatformPlugin())
```

```bash
npm run test:tier2 -- --plugin my_team.tier2_provider --platform my_platform --plan
```

Only explicitly requested modules are imported; there is no directory crawling
or implicit third-party plugin execution. Adding a plugin requires no changes to
the CLI, common runner or scheduler. Contract tests exercise a third plugin,
platform failure isolation, dependency blocking, option scoping, preflight,
cleanup failure and platform-specific discovery.

## Claude

```bash
npm run test:tier2 -- --platform claude --plan
npm run test:tier2 -- --platform claude
# Another test account can supply its own native-interaction golden conversations:
npm run test:tier2 -- --platform claude --platform-option claude.golden=/path/golden.json
```

Claude Tier 2 selects **Haiku** before every new prompt, including lifecycle
prompts and historical-conversation appends. It uses the native model menu
(including “More models”) and confirms the selected family again at dispatch.
Only an available model radio item is eligible: missing/locked Haiku blocks the
send, without selecting an upgrade or another model. The report records the
Haiku policy and each attempted prompt's selected model. Native model-menu checks
on both an existing conversation and a new conversation passed without sending
messages; this does not establish that the current account quota permits Haiku
generation. Historical golden conversations keep their original models.

Claude is registered alongside Gemini and ChatGPT; `--platforms all` now selects
all three. Its 22-case plan uses the same scheduler, workbench cases, session
finalization and CDP installation/download helpers. The golden JSON has a
`conversationIds` array; the default identifies the test account's three-round
backup conversation containing real AskUserQuestion and Write → Artifact tools.
Golden source must actually contain these tools. Missing, inaccessible or
incomplete golden source fails the gate.

Live generation requires two scenarios with at least 5 and 8 turns. The reserved
pair is written to `scenarios.json`; rerunning that output directory reuses the
pair without consuming two more pool entries. Every submitted prompt is saved
locally after the native reply settles. Source APIs are never polled: a fresh
pair needs two final detail reads; resuming verifies each saved remote prefix
once and never replays a divergent prompt. An open native questionnaire fails
with an input-required error instead of being recorded as a completed response.
The runner does not select questionnaire answers automatically. The fixed golden
checks previously answered native questions and their exported static content.
HTTP 429 stops further Claude gate operations; uninstall restoration remains
available. No source request is automatically retried.

The independent oracle reads physical Markdown, HTML, JSON and tagged PDF files.
It checks branch/message identity, complete parser quality, every authored text
fragment, native question headers/options/descriptions/answers, Artifact source
code and exact code indentation. PDF prose/code order and formula structure use
the shared PDF oracle; this is not visual PDF inspection. One terminal code line
ending is normalized across Markdown fences and HTML, never indentation. Private
memory tool bodies are not expected in exported authored content. Binary/image
pixel fidelity and stale-tab attachment recovery are not part of this Claude
plan; they must not be inferred from its text/Artifact checks. Its skip gate
currently covers the all-unchanged case, not the mixed changed/unchanged case.

Full-run gates include page badge, passive sidebar capture, explicit scan
coverage, live disk save, older-chat promotion/receipt advancement, confirmed
remote deletion, popup, local cleanup/rescan and uninstall/reinstall. Ordering
edges let independent scan/export audits run after passive or coverage failures;
those failures still make the complete suite fail. They are not waived or
turned into supported-product claims. Claude's current list endpoint does not
provide a trusted exhaustion marker, and its production integration lacks the
passive capture and popup context needed by several gates. **A full Claude Tier 2
pass is not claimed.** Fresh installation also clears the optional Claude grant;
the real Connect Claude permission step remains required.

Validation of this adapter used the existing authorized 9222 installation, one
independent detail read and one real list scan. Five existing conversations were
downloaded in all four formats; the six-message questionnaire/Artifact golden
passed the physical oracle (three code blocks, six PDF pages). That targeted
check exposed and fixed Workbench links incorrectly pointing Claude IDs at
Gemini. It was not a clean-install 5/8-turn full run, and does not establish
coverage of the remaining lifecycle gates. Local account response bodies and
exported files remain ignored under `tests/output/`.

For local Claude iteration, use `npm run test:tier2 -- --platform claude`. The harness rebuilds an ignored unpacked copy under
`temp/tier2-claude-required-hosts/` with `https://claude.ai/*` required. Shipping
`manifest.json` and ordinary release packaging retain optional permissions. The
report records `testInstallMode: required-claude-hosts`; this mode does not test
the shipping optional-permission prompt. Set `TIER2_CLAUDE_REQUIRED_HOSTS=0` to use
the ordinary install and real native permission prompt again.

### Claude full-plan run, 2026-10-22

The required-host local install completed clean installation and onboarding.
The first 5-turn scene completed. Native Claude Docs output exposed a waiter bug:
virtualization reduced visible assistant-node counts after a new reply, so count
growth could not prove completion. The waiter now uses Claude's native
`data-turn-key` identity; a regression covers five old visible nodes shrinking
to one new reply. A resumed full plan verified the five-turn source once and did
not resend any completed prompt or consume another scenario pair.

The second scene completed 4 of 8 planned turns, then Claude Free displayed its
five-hour message-quota notice with a 02:00 reset. The next prompt remained in
the composer; waiting for an enabled send button timed out. This is an observed
account quota, not an observed HTTP 429. The final matrix is **1 PASS, 3 FAIL,
18 dependency SKIP**: missing page badge, passive sidebar capture and incomplete
multi-turn generation failed; real uninstall/reinstall passed. Connection and
onboarding passed outside the case matrix. Export, golden and lifecycle cases
were blocked, so this run does not validate their physical outputs. There were
no source-API polling loops; the resumed run used one independent prefix read.
The scenario pool was replenished from 18 to 20 with new optics and queueing
scenes. Reports, interruption history and quota observations remain local under
`tests/output/tier2-claude-full-required-20261022/`.


### Claude follow-up fixes and evidence

The passive bridge now has optional-permission dynamic MAIN/ISOLATED scripts,
request-bound organization routing, native list/detail/stream capture, confirmed
DELETE receipts and a server-rendered sidebar fallback. Badge, Popup and current
account routing include Claude. A real clean-install attempt passed Badge and
all seven then-visible sidebar rows. Its final matrix was 3 PASS / 1 FAIL /
18 dependency SKIP; quota remained the blocking full-flow gate.

The original second scene's fourth reply was *submitted*, but its final source
`stop_reason` was `error`; only three replies finished. The former DOM waiter
incorrectly recorded its visible partial code as complete. Native quota notices
now fail before further sends, and explicit source interruption always stays
partial. Incomplete resume evidence is saved separately without overwriting a
previous completed snapshot. Account quota is not labelled HTTP 429.

Scans now use the observed `chat_conversations_v2` strong-consistency offset
endpoint, admitting Coverage only for ordered/nonrepeating complete pages with
an explicit `has_more` terminal fact. A targeted eight-row scan verified source
exhaustion. Two complete existing conversations (five-round acoustic example
and three-round questionnaire/Artifact golden) passed separate four-format disk
checks: 16 messages, 27 exact code bodies, two generated file originals, and
full source fragments. Generated file bytes are compared across every format.
This targeted run does not replace full generation, live-save/promotion or
confirmed-deletion acceptance.

PDF inspection also exposed an optional Local Font Access prompt blocking
export. Exports now use already-granted device fonts or bundled offline fonts,
without waiting for a permission prompt. Native interactive widgets are retained
as inert SVG/HTML source; Docs edits are chronological authored content rather
than a guessed final remote document. Local reports and page/contact-sheet
renders are under `tests/output/claude-fixes-physical-20261022/`.

The quota-detection diagnostic attempt consumed a separate reserved pair and
submitted one new first prompt before the site's quota notice appeared; no
completed reply was recorded and no independent source request was made.
Send attempts are now recorded before dispatch separately from completed
`records`, so interrupted replies cannot hide actual attempted traffic. No
further live prompts were sent during the targeted export checks.

The final targeted follow-up also passed current-conversation Popup download
with original attachments and unchanged-content skipping for both exported
conversations (no download and no receipt rewrite). Popup had omitted the ZIP
library used for attached files; it now loads the same library as Options,
with a browser regression covering actual ZIP contents. These additional gates
still do not substitute for quota-blocked generation and lifecycle acceptance.

### Claude non-posting acceptance (2026-10-23)

At the user's request, independent source snapshots and physical four-format
exports were checked for all eight existing conversations, including interrupted
and empty history. `assert_existing_exports` validates those states explicitly;
the full-generation oracle still rejects unfinished replies. The Markdown
evidence grammar now preserves spaced dollar price spans as prose, fixing a
false formula mismatch without changing product output. The L3 probe's optional
provider argument also permits the same storage/document contract checks on Claude.

Search by title/ID, selection, language, initial export receipts, Popup downloads,
unchanged skipping, clear/cancel/rescan, historical-visit Live Save and same-key
native deletion were checked independently of message generation. Deletion used
only a source-backed prior test conversation. Local artifacts, source snapshots,
all 53 PDF page renders and eight HTML screenshots are under
`tests/output/claude-existing-20261023/`. This is scoped acceptance, never a full
Tier 2 pass: new multi-turn generation, completed-stream capture, reply-triggered
promotion and export advancement were not exercised.

Uninstall/reinstall and the fresh seven-step tour also passed. The restored
install was reconnected and scanned the seven remaining conversations (the
eighth was the disposable deletion target). With Live Save disabled, the SSR
visit did not acquire local Detail; enabling it and revisiting produced the
Markdown plus both unchanged original attachment files. Exactly one local
required-Claude-host install remains enabled. Final Tier 1 passed, including
164 Playwright tests with one existing skip; Python platform contracts passed
41 tests. The local report records scoped acceptance separately from full Tier 2.


### Claude full-run quota retry (2026-10-23)

The next unfiltered full run completed all five turns of its first scenario.
The sixth dispatched prompt, which started the eight-turn scenario, produced
Claude's native five-hour message-limit notice instead of a completed reply.
The run stopped without retrying: six sends, five completed replies, and one
independent source snapshot. No HTTP 429 was recorded by the quota evidence.
The first source contains ten messages and thirteen native tool calls, including
file creation and code execution; this was not a five-message short-text quota
measurement. The final matrix remains 3 PASS / 1 FAIL / 18 dependency SKIP,
not a full Tier 2 pass. Evidence and resumable first-scenario progress are in
`tests/output/tier2-claude-full-20261023-retry/claude/`.

The two consumed scenarios were replaced with new generalized-CRT and WGS84
coordinate-transform scenarios, restoring the pool to 20/20. Full Tier 1 passed
again with 164 Playwright tests passing and the opt-in documentation screenshot
capture skipped. No product-code change was needed for this account-quota stop.
