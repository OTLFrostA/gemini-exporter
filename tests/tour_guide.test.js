const test = require('node:test');
const assert = require('node:assert');

// Mock browser environment for unit testing TourGuide
global.window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: () => {},
    removeEventListener: () => {},
    open: () => {}
};

const mockElements = new Map();
global.document = {
    createElement: (tag) => {
        const el = {
            tagName: tag.toUpperCase(),
            className: '',
            style: {},
            classList: {
                add: (c) => { el.className += ' ' + c; },
                remove: (c) => { el.className = el.className.replace(c, '').trim(); }
            },
            children: [],
            appendChild: (child) => {
                el.children.push(child);
                return child;
            },
            removeChild: (child) => {
                el.children = el.children.filter(c => c !== child);
            },
            setAttribute: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            getBoundingClientRect: () => ({ top: 100, left: 100, width: 200, height: 50, bottom: 150, right: 300 }),
            scrollIntoView: () => {},
            isConnected: true,
            offsetParent: {}
        };
        return el;
    },
    body: {
        appendChild: () => {},
        removeChild: () => {}
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: (id) => mockElements.get(id) || null,
    querySelector: () => null
};

// Mock StorageService
let tourStatusMock = false;
global.StorageService = {
    isTourCompleted: async () => tourStatusMock,
    setTourCompleted: async (v) => { tourStatusMock = !!v; }
};

// Mock TabService
global.TabService = {
    checkGeminiStatus: async () => ({ status: 'CONNECTED' }),
    openGeminiPage: async () => {},
    reloadGeminiTab: async () => {}
};

// Mock I18n
global.I18n = {
    t: (k) => k
};

const TourGuide = require('../src/ui/tour/tourGuide.js');
const TabService = require('../src/core/utils/tabService.js');
const StorageService = require('../src/core/storage/storageService.js');

test('tourGuide - module structure and steps', () => {
    assert.ok(TourGuide, 'TourGuide should be exported');
    assert.strictEqual(typeof TourGuide.startTour, 'function');
    assert.strictEqual(typeof TourGuide.goToStep, 'function');
    assert.strictEqual(typeof TourGuide.nextStep, 'function');
    assert.strictEqual(typeof TourGuide.prevStep, 'function');
    assert.strictEqual(typeof TourGuide.finishTour, 'function');
    assert.strictEqual(typeof TourGuide.skipTour, 'function');

    assert.strictEqual(TourGuide.STEPS.length, 4, 'Tour should have exactly 4 streamlined steps');
    assert.strictEqual(TourGuide.STEPS[0].id, 'connect');
    assert.strictEqual(TourGuide.STEPS[1].id, 'sync');
    assert.strictEqual(TourGuide.STEPS[2].id, 'select');
    assert.strictEqual(TourGuide.STEPS[3].id, 'export');
    assert.ok(TourGuide.STEPS[3].isFinal, 'Last step should be marked as final');
});

test('tourGuide - step navigation and completion', async () => {
    await TourGuide.startTour(0);
    assert.strictEqual(TourGuide.isActive(), true);
    assert.strictEqual(TourGuide.getCurrentStep(), 0);

    await TourGuide.nextStep();
    assert.strictEqual(TourGuide.getCurrentStep(), 1);

    await TourGuide.nextStep();
    assert.strictEqual(TourGuide.getCurrentStep(), 2);

    await TourGuide.prevStep();
    assert.strictEqual(TourGuide.getCurrentStep(), 1);

    await TourGuide.finishTour();
    assert.strictEqual(TourGuide.isActive(), false);
    assert.strictEqual(tourStatusMock, true, 'StorageService should record tour completed');
});

test('tabService - checkGeminiStatus handles NO_TAB, NEED_REFRESH and CONNECTED', async () => {
    // 1. NO_TAB case
    global.chrome = {
        tabs: {
            query: async () => []
        }
    };
    const resNoTab = await TabService.checkGeminiStatus();
    assert.strictEqual(resNoTab.status, 'NO_TAB');

    // 2. NEED_REFRESH case (sendMessage fails)
    global.chrome = {
        tabs: {
            query: async () => [{ id: 101, url: 'https://gemini.google.com/app' }],
            sendMessage: (tabId, msg, cb) => {
                global.chrome.runtime = { lastError: { message: 'Receiving end does not exist' } };
                cb(null);
            }
        },
        runtime: {}
    };
    const resRefresh = await TabService.checkGeminiStatus();
    assert.strictEqual(resRefresh.status, 'NEED_REFRESH');

    // 3. CONNECTED case
    global.chrome = {
        tabs: {
            query: async () => [{ id: 102, url: 'https://gemini.google.com/app' }],
            sendMessage: (tabId, msg, cb) => {
                global.chrome.runtime = { lastError: null };
                cb({ ok: true, version: '1.4.1' });
            }
        },
        runtime: {}
    };
    const resConnected = await TabService.checkGeminiStatus();
    assert.strictEqual(resConnected.status, 'CONNECTED');
});

test('storageService - isTourCompleted and setTourCompleted', async () => {
    let storageMap = {};
    global.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const res = {};
                    for (const k of keys) res[k] = storageMap[k];
                    return res;
                },
                set: async (obj) => {
                    Object.assign(storageMap, obj);
                }
            }
        }
    };

    assert.strictEqual(await StorageService.isTourCompleted(), false);
    await StorageService.setTourCompleted(true);
    assert.strictEqual(await StorageService.isTourCompleted(), true);
});
