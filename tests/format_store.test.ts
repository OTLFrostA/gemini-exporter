import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { indexStorage } from './helpers/indexStorage.js';
import { ensureUpgraded } from '../src/migration/upgradeV1.js';
import { getSettings, updateSettings } from '../src/application/settings/index.js';
import { ALLOWED_FORMATS, DEFAULT_FORMAT, FEEDBACK_URL } from '../src/shared/utils/constants.js';
const html = () => readFileSync('src/ui/options/options.html', 'utf8');

test('current export format constants retain the four supported formats and Markdown default', async () => {
    assert.deepEqual(ALLOWED_FORMATS, ['markdown', 'html', 'json', 'pdf']); assert.equal(DEFAULT_FORMAT, 'markdown');
    const env = indexStorage(); try { assert.equal((await getSettings()).defaultFormat, 'markdown'); } finally { env.restore(); }
});
test('current Options format control accepts exactly the four current formats', () => {
    const select = html().match(/<select id="format"[^>]*>(.*?)<\/select>/s)?.[1]; assert.ok(select);
    const values = [...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]);
    for (const format of ['markdown', 'html', 'pdf', 'json']) assert.ok(values.includes(format));
    for (const invalid of ['json_openai', 'json_raw', 'xml', '']) assert.equal(values.includes(invalid), false);
});
test('removed saved formats normalize only through the one-time migration owner', async () => {
    for (const value of ['markdown', 'html', 'json', 'pdf', 'json_openai', 'json_raw', 'invalid']) {
        const env = indexStorage({ gemini_export_format: value }); try {
            await ensureUpgraded(); assert.equal((await getSettings()).defaultFormat, ALLOWED_FORMATS.includes(value as typeof ALLOWED_FORMATS[number]) ? value : 'markdown');
        } finally { env.restore(); }
    }
});
test('format control choices match the ExportRequest formats rather than removed legacy variants', () => {
    const select = html().match(/<select id="format"[^>]*>(.*?)<\/select>/s)?.[1] ?? '';
    assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]).sort(), [...ALLOWED_FORMATS].sort());
});
test('constants - FEEDBACK_URL is configured', () => { assert.equal(FEEDBACK_URL, 'https://tally.so/r/Y56ZBB'); });
for (const stored of ['json_openai', 'json_raw']) for (const developerMode of [false, true]) test(`migration repairs saved ${stored} in developer mode ${developerMode}`, async () => {
    const env = indexStorage({ gemini_export_format: stored, gemini_dev_mode: developerMode }); try {
        await ensureUpgraded(); const settings = await getSettings();
        assert.equal(settings.defaultFormat, 'markdown'); assert.equal(settings.developerMode, developerMode);
        await updateSettings({ defaultFormat: 'html' }); assert.equal((await getSettings()).defaultFormat, 'html');
        assert.equal(env.local.gemini_export_format, stored, 'normal v2 Settings writes do not maintain a legacy preference mirror');
    } finally { env.restore(); }
});
