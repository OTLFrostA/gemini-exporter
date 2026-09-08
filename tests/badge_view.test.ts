export {};
const test = require('node:test');
const assert = require('node:assert');

const BadgeView = require('../src/content/badgeView.js');

test('badgeView - module exports and interface', () => {
    assert.ok(BadgeView);
    assert.strictEqual(typeof BadgeView.applyStoredBadgePosition, 'function');
    assert.strictEqual(typeof BadgeView.makeBadgeDraggable, 'function');
    assert.strictEqual(typeof BadgeView.ensureBadge, 'function');
    assert.strictEqual(typeof BadgeView.ensureBadgeAndText, 'function');
    assert.strictEqual(typeof BadgeView.updateBadge, 'function');
});

test('badgeView - DOM creation and text update', () => {
    let attachedElement: any = null;
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
        getElementById: (id: string) => {
            if (id === 'geminiExportBadge') return attachedElement;
            if (id === 'geminiExportBadgeText') return mockTxt;
            return null;
        },
        createElement: (tag: string) => {
            if (tag === 'div') return mockBadge;
            return {};
        },
        body: {
            appendChild: (el: any) => { attachedElement = el; }
        }
    };

    const origDoc = (globalThis as any).document;
    const origWindow = (globalThis as any).window;
    try {
        (globalThis as any).document = fakeDoc;
        (globalThis as any).window = {
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
        (globalThis as any).document = origDoc;
        (globalThis as any).window = origWindow;
    }
});
