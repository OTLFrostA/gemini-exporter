const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('i18n - check all HTML data-i18n keys are present in i18n.js', () => {
    const i18nPath = path.join(__dirname, '../i18n.js');
    const text = fs.readFileSync(i18nPath, 'utf8');

    const zhDict = {};
    const enDict = {};
    let cur = null;
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('zh: {')) cur = zhDict;
        else if (trimmed.startsWith('en: {')) cur = enDict;
        else if (trimmed.startsWith('}') && cur) { /* keep going */ }
        else if (trimmed.includes(':') && cur) {
            const parts = trimmed.split(':');
            const k = parts[0].trim().replace(/['"]/g, '');
            const v = parts.slice(1).join(':').trim().replace(/,$/, '').replace(/^['"]|['"]$/g, '');
            cur[k] = v;
        }
    }

    assert.ok(Object.keys(zhDict).length > 50, 'zh locale dictionary must not be empty');
    assert.ok(Object.keys(enDict).length > 50, 'en locale dictionary must not be empty');

    for (const htmlFile of ['options.html', 'popup.html']) {
        const htmlPath = path.join(__dirname, '..', htmlFile);
        const htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const matches = htmlContent.matchAll(/data-i18n(?:-title|-placeholder)?=["']([^"']+)["']/g);
        for (const m of matches) {
            const key = m[1];
            assert.ok(key in zhDict, `Key '${key}' used in ${htmlFile} missing in zh locale`);
            assert.ok(key in enDict, `Key '${key}' used in ${htmlFile} missing in en locale`);
        }
    }
});
