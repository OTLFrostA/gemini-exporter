const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const I18n = require('../i18n.js');

test('i18n - check dictionary parity between zh and en', () => {
    const zhKeys = Object.keys(I18n.LOCALES.zh);
    const enKeys = Object.keys(I18n.LOCALES.en);

    assert.ok(zhKeys.length >= 70, `zh locale dictionary should have at least 70 keys (got ${zhKeys.length})`);
    assert.ok(enKeys.length >= 70, `en locale dictionary should have at least 70 keys (got ${enKeys.length})`);

    for (const k of zhKeys) {
        assert.ok(k in I18n.LOCALES.en, `Key '${k}' in zh locale is missing in en locale`);
    }
    for (const k of enKeys) {
        assert.ok(k in I18n.LOCALES.zh, `Key '${k}' in en locale is missing in zh locale`);
    }
});

test('i18n - check all HTML data-i18n attributes are present in i18n.js', () => {
    for (const htmlFile of ['options.html', 'popup.html']) {
        const htmlPath = path.join(__dirname, '..', htmlFile);
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const matches = htmlContent.matchAll(/data-i18n(?:-title|-placeholder|-html)?=["']([^"']+)["']/g);
        for (const m of matches) {
            const key = m[1];
            assert.ok(key in I18n.LOCALES.zh, `Key '${key}' used in ${htmlFile} missing in zh locale`);
            assert.ok(key in I18n.LOCALES.en, `Key '${key}' used in ${htmlFile} missing in en locale`);
        }
    }
});

test('i18n - parametric interpolation and language switching', async () => {
    await I18n.setLang('zh');
    assert.strictEqual(I18n.getLang(), 'zh');
    assert.strictEqual(I18n.t('syncedBadge', 42), '已同步 42 条');
    assert.strictEqual(I18n.t('exportFinished', 10, 2, 12), '导出完成！成功: 10，失败: 2，总计: 12');

    await I18n.setLang('en');
    assert.strictEqual(I18n.getLang(), 'en');
    assert.strictEqual(I18n.t('syncedBadge', 42), '42 synced');
    assert.strictEqual(I18n.t('exportFinished', 10, 2, 12), 'Export completed! Success: 10, Failed: 2, Total: 12');
});

test('i18n - language change event listener', async () => {
    let triggeredLang = null;
    I18n.onLanguageChange((lang) => {
        triggeredLang = lang;
    });

    await I18n.setLang('zh');
    assert.strictEqual(triggeredLang, 'zh');

    await I18n.setLang('en');
    assert.strictEqual(triggeredLang, 'en');
});
