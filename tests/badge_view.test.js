const test = (typeof require !== 'undefined' && require('node:test')) ? require('node:test') : (name, fn) => { try { fn(); } catch (e) { throw new Error(`FAIL: ${name} - ${e.message}`); } };
const assert = (typeof require !== 'undefined' && require('node:assert')) ? require('node:assert') : {
    strictEqual: (a, b) => { if (a !== b) throw new Error(`${a} !== ${b}`); },
    deepStrictEqual: (a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} !== ${JSON.stringify(b)}`); },
    ok: (a) => { if (!a) throw new Error(`Expected truthy, got ${a}`); }
};

const BadgeView = (typeof require !== 'undefined') ? require('../src/content/badgeView.js') : (typeof globalThis.BadgeView !== 'undefined' ? globalThis.BadgeView : null);

test('badgeView - module exports and interface', () => {
    assert.ok(BadgeView);
    assert.strictEqual(typeof BadgeView.applyStoredBadgePosition, 'function');
    assert.strictEqual(typeof BadgeView.makeBadgeDraggable, 'function');
    assert.strictEqual(typeof BadgeView.ensureBadge, 'function');
    assert.strictEqual(typeof BadgeView.ensureBadgeAndText, 'function');
    assert.strictEqual(typeof BadgeView.updateBadge, 'function');
});

test('badgeView - DOM creation and text update', () => {
    let attachedElement = null;
    const mockBadge = {
        id: 'geminiExportBadge',
        innerHTML: '',
        style: {},
        classList: { add: () => {}, remove: () => {} },
        addEventListener: () => {},
        isConnected: true
    };
    const mockTxt = { textContent: '' };

    const fakeDoc = {
        getElementById: (id) => {
            if (id === 'geminiExportBadge') return attachedElement;
            if (id === 'geminiExportBadgeText') return mockTxt;
            return null;
        },
        createElement: (tag) => {
            if (tag === 'div') return mockBadge;
            return {};
        },
        body: {
            appendChild: (el) => { attachedElement = el; }
        }
    };

    const origDoc = globalThis.document;
    const origWindow = globalThis.window;
    try {
        globalThis.document = fakeDoc;
        globalThis.window = {
            innerWidth: 1920,
            innerHeight: 1080,
            addEventListener: () => {}
        };

        const badge = BadgeView.ensureBadge({ isZh: () => true });
        assert.ok(badge);
        assert.strictEqual(badge.id, 'geminiExportBadge');

        BadgeView.updateBadge(15, 0, null, false, { isZh: () => true, getAccountSlot: () => 'u0' });
        assert.strictEqual(mockTxt.textContent, '已同步 15 条');
        assert.strictEqual(BadgeView.getLastKnownCount(), 15);
    } finally {
        globalThis.document = origDoc;
        globalThis.window = origWindow;
    }
});
