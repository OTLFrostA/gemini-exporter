export {};
const test = require('node:test');
const assert = require('node:assert');

const DialogView = require('../src/ui/views/dialogView.js');

test('dialogView - exports', () => {
    assert.ok(DialogView);
    assert.strictEqual(typeof DialogView.renderExportBanner, 'function');
    assert.strictEqual(typeof DialogView.dismissExportBanner, 'function');
    assert.strictEqual(typeof DialogView.showDirectWritePrompt, 'function');
    assert.strictEqual(typeof DialogView.hideDirectWritePrompt, 'function');
    assert.strictEqual(typeof DialogView.showTakeoutLimitPrompt, 'function');
    assert.strictEqual(typeof DialogView.hideTakeoutLimitPrompt, 'function');
});

test('dialogView - render without DOM element does not crash', () => {
    DialogView.renderExportBanner(null, 'u0', false);
    DialogView.showDirectWritePrompt(100, () => {}, () => {});
    DialogView.hideDirectWritePrompt();
    DialogView.showTakeoutLimitPrompt({ count: 600, onImportTakeout: () => {} });
    DialogView.hideTakeoutLimitPrompt();
});

test('dialogView - renderExportBanner XSS prevention: lastChatTitle is rendered as text node, not HTML', () => {
    const appendedNodes: any[] = [];
    const bannerElem = { style: {} };
    const bannerTextElem = {
        _html: '',
        get innerHTML() { return this._html; },
        set innerHTML(val: any) { this._html = val; appendedNodes.length = 0; },
        appendChild(node: any) { appendedNodes.push(node); }
    };
    const btnResumeElem = { style: {} };

    const oldDoc = (global as any).document;
    const oldI18n = (global as any).I18n;
    try {
        (global as any).I18n = require('../src/core/utils/i18n.js');
        (global as any).document = {
            getElementById: (id: string) => {
                if (id === 'exportSessionBanner') return bannerElem;
                if (id === 'exportSessionText') return bannerTextElem;
                if (id === 'btnResumeExport') return btnResumeElem;
                return null;
            },
            createTextNode: (text: string) => ({ nodeType: 3, textContent: text })
        };

        const maliciousTitle = '<svg onload=alert(1)>';
        DialogView.renderExportBanner({
            status: 'interrupted',
            total: 10,
            current: 3,
            lastChatTitle: maliciousTitle
        }, 'u0', false);

        assert.ok(!bannerTextElem.innerHTML.includes('<svg'), 'innerHTML must not contain unescaped HTML tags');
        assert.strictEqual(appendedNodes.length, 1, 'lastChatTitle must be appended as a text node');
        assert.strictEqual(appendedNodes[0].nodeType, 3, 'Appended child must be a text node');
        assert.ok(appendedNodes[0].textContent.includes(maliciousTitle.slice(0, 20)), 'Text node must contain the sliced raw title safely');
    } finally {
        (global as any).document = oldDoc;
        (global as any).I18n = oldI18n;
    }
});
