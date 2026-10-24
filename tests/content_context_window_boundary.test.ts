import test from 'node:test';
import assert from 'node:assert/strict';
import { ContentContext } from '../src/runtime/content/contentContext.js';

test('ContentContext works without a browser mirror, including cleanup and abort', () => {
    const context = new ContentContext(null);
    const controller = new AbortController();
    context.setDevMode(true);
    context.setCredentials({ at: 'test-at', bl: 'test-bl' });
    context.setAborted(false);
    context.registerTimer('titleObserver', controller);
    assert.equal(context.getTimer('titleObserver'), controller);
    context.clearTimer('titleObserver');
    assert.equal(controller.signal.aborted, true);
    context.setInjected(true);
    context.abort();
    assert.equal(context.isAborted(), true);
    assert.equal(context.getTimer('titleObserver'), undefined);
});

test('ContentContext mirrors debug and timer state to the injected browser only', () => {
    const mirror: Partial<Window> = {};
    const context = new ContentContext(mirror);
    context.setCredentials({ at: 'pre-dev', bl: 'pre-dev' });
    assert.equal(mirror.__gemExporterExtractedAt, undefined, 'credentials are hidden outside dev mode');

    context.setDevMode(true);
    assert.equal(mirror.__gemExporterContentContext, context);
    assert.equal(mirror.__gemExporterAborted, false);
    assert.equal(mirror.__gemExporterDevMode, true);

    context.setCredentials({ at: 'test-at', bl: 'test-bl' });
    assert.equal(mirror.__gemExporterExtractedAt, 'test-at');
    assert.equal(mirror.__geminiAt, 'test-at');
    assert.equal(mirror.__gemExporterExtractedBl, 'test-bl');
    const scan = Promise.resolve();
    context.setDeepScanPromise(scan);
    assert.equal(mirror.__gemExporterDeepScanPromise, scan);

    let aborts = 0;
    const client = { abort: () => { aborts++; } };
    context.setActiveClient(client);
    assert.equal(mirror.__gemExporterActiveClient, client);
    context.setInjected(true);
    assert.equal(mirror.__gemExporterInjected, true);
    context.abort();
    assert.equal(mirror.__gemExporterAborted, true);
    assert.equal(aborts, 1, 'abort must not be invoked twice');

    const timer = setTimeout(() => {}, 60000);
    context.registerTimer('syncInterval', timer);
    assert.equal(mirror.__gemExporterSyncInterval, timer);
    context.clearTimer('syncInterval');
    assert.equal(mirror.__gemExporterSyncInterval, null);

    context.setDevMode(false);
    assert.equal(mirror.__gemExporterDevMode, false);
    context.setInjected(false);
    assert.equal(mirror.__gemExporterInjected, true, 'debug-only mirrors remain unchanged outside dev mode');
});
