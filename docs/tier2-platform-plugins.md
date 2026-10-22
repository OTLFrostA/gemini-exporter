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
  subgraphs, failures and blocked dependencies. Both built-in plugins use this.
- `platforms/gemini.py` and `gemini_runtime.py`: existing 25 Gemini cases and
  Gemini environment preparation, including Takeout and extension lifecycle.
- `platforms/chatgpt.py`: the ChatGPT cases now run through the same scheduler;
  `chatgpt_live.py` contains site operations and physical evidence collection.
  Mandatory nested evidence (live save, promotion, image pixels, questionnaires)
  still blocks a case if missing. They are not inferred from a successful scan.
- `driver/PlatformRegistry`: lower-level browser driver registration; distinct
  from acceptance suite plugin registration. A suite may use such a driver.

Platform selectors/URLs, source capture, environment setup, golden fixtures and
specialized acceptance assertions belong to plugins. Shared orchestration does
not assume Gemini or require every platform to implement Takeout. Capabilities
are declarations of the plugin's test scope, not passed assertions or product
feature parity. Missing capabilities are absent from that platform's scope;
they are never inserted as passing tests. This refactor preserves existing
coverage; it does not certify new ChatGPT UI features.

The default output root is `tests/output/tier2/` (override with `--output-dir`).
`tier2-report.json` records every selected platform, declared plan, scheduled
features, actual results, errors and cleanup failures. Pending and blocked cases
are not passes. Targeted runs are marked `scope: targeted`; a successful targeted
run is not a full-suite pass. Each plugin writes evidence under `<root>/<id>/`;
ChatGPT also retains its detailed `report.json`. Reports are checkpointed as
platforms complete; normal test conversations remain retained.

The shared runner owns the process lock through the CLI. Browser interaction is
CDP only. Platform-specific installation and permission steps remain real:
Gemini's clean reinstall can clear optional site grants, and ChatGPT waits for
an actual user-granted connection. A multi-platform run may therefore need that
authorization. No permissions or lifecycle acceptance steps are bypassed.

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
