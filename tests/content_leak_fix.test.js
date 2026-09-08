// tests/content_leak_fix.test.js - Verify timer cleanup on repeated injection (Issue A1 fix)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

test('Issue A1 fix: PageObserver cleans up dangling intervals and watchers on re-initialization', () => {
    // Setup simulated browser environment
    global.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => {}
    };
    global.document = {
        querySelector: () => null,
        getElementById: () => null
    };
    global.history = {
        pushState: () => {},
        replaceState: () => {}
    };
    global.location = {
        href: 'https://gemini.google.com/app',
        pathname: '/app'
    };

    const PageObserver = require(path.join(__dirname, '../src/content/pageObserver.js'));
    assert.ok(PageObserver, 'PageObserver must be exported');
    assert.strictEqual(typeof PageObserver.init, 'function', 'PageObserver.init must be function');
    assert.strictEqual(typeof PageObserver.cleanup, 'function', 'PageObserver.cleanup must be function');

    // First init
    let syncCount = 0;
    PageObserver.init({ onSync: () => syncCount++ });

    const firstUrlWatcher = global.window.__gemExporterUrlWatcher;
    const firstSyncInterval = global.window.__gemExporterSyncInterval;

    assert.ok(firstUrlWatcher, '__gemExporterUrlWatcher should be assigned');
    assert.ok(firstSyncInterval, '__gemExporterSyncInterval should be assigned');

    // Second init (simulating re-injection)
    PageObserver.init({ onSync: () => syncCount++ });

    const secondUrlWatcher = global.window.__gemExporterUrlWatcher;
    const secondSyncInterval = global.window.__gemExporterSyncInterval;

    assert.ok(secondUrlWatcher, 'New __gemExporterUrlWatcher should be assigned');
    assert.ok(secondSyncInterval, 'New __gemExporterSyncInterval should be assigned');
    assert.notStrictEqual(secondUrlWatcher, firstUrlWatcher, 'Previous url watcher should have been replaced and cleared');
    assert.notStrictEqual(secondSyncInterval, firstSyncInterval, 'Previous sync interval should have been replaced and cleared');

    // Explicit cleanup
    PageObserver.cleanup();
    assert.strictEqual(global.window.__gemExporterUrlWatcher, null, 'Watcher handle should be nulled out after cleanup');
    assert.strictEqual(global.window.__gemExporterSyncInterval, null, 'Interval handle should be nulled out after cleanup');
});
