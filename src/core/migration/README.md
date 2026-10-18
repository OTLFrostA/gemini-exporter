# v1 → v2 one-time upgrade

Design: https://app.notion.com/p/3fb5d4d759e18186b2eaf4041d711b92

`upgradeV1.ts` exports `ensureUpgraded(): Promise<void>`. It copies only Accounts,
ConversationIndexes, convertible ExportRecords, stored preferences and the directory
handle. It retains every legacy key/database and never reads conversation bodies.
The final initialized marker gates completion; failed calls reject and can retry.

Browser Runtime integration belongs to the Runtime module: execute this function
only in Background/Service Worker and block normal v2 data access in every context
until it resolves. Register MV3 listeners synchronously. Apply install/update
Settings lifecycle rules after readiness: fill a missing feature baseline from
`previousVersion` on update, preserve migrated baselines, and leave fresh installs
eligible for Tour. This module cannot obtain `previousVersion` from its no-argument
entry point.

The frozen Settings field is `tourAutoHandled`, even while the adjacent Settings
implementation still names `tourShown`. Migration writes the frozen field without
changing that module. It does not implement Runtime readiness or lifecycle events.

Module Tier 1:

```sh
node -r ./tests/ts_register.js --test tests/upgrade_v1.test.cjs
node_modules/.bin/tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --lib ES2022,DOM,DOM.Iterable --types chrome,node src/core/migration/upgradeV1.ts
```

Tests use fake-indexeddb for deterministic persistence failures. Real Chrome
profile upgrades and native directory handle cloning require later integration
validation; they are not claimed by this module's Tier 1 suite.
