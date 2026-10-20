# v1 → v2 one-time upgrade

[Design](https://app.notion.com/p/3fb5d4d759e18186b2eaf4041d711b92).
`ensureUpgraded()` copies Accounts, Indexes, convertible ExportRecords, retained
preferences and the directory handle. It never reads bodies or deletes legacy
keys/databases. Storage owns the physical initialized-marker write; only Migration
interprets it. The final marker gates completion; failed calls reject and retry.

Background runs migration before business access, with listeners registered
synchronously. Runtime then fills missing feature baselines from previousVersion
or currentVersion, preserving existing values. Tour is installation URL intent;
neither Tour flags nor the retired ZIP preference are migrated into v2 Settings.

`node -r ./tests/ts_register.js --test tests/upgrade_v1.test.cjs` runs deterministic
fake-indexeddb migration regressions. Runtime tests exercise readiness and lifecycle
against real migration functions. These tests do not establish real profile upgrade
behavior or cloning a historical native handle across browser restarts.
