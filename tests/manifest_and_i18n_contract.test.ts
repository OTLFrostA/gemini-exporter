import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { UI_COPY } from '../src/ui/shared/legacyLabels.js';

const ROOT = resolve(__dirname, '..');

test('tracked JSON configuration and locale files parse cleanly', () => {
    for (const rel of [
        'manifest.json',
        'package.json',
        '_locales/zh_CN/messages.json',
        '_locales/en/messages.json',
        'scripts/test_scenario_pool.json',
    ]) {
        const parsed: unknown = JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
        assert.ok(parsed !== null && typeof parsed === 'object', `Expected JSON object/array in ${rel}`);
    }
});

test('manifest.json enforces MV3 dynamic permission-gated scripts and hook exposure', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'manifest.json'), 'utf8')) as {
        manifest_version: number;
        permissions?: string[];
        host_permissions?: string[];
        content_scripts?: unknown[];
        optional_host_permissions?: string[];
        background?: { service_worker?: string };
        web_accessible_resources?: Array<{ resources?: string[] }>;
    };

    assert.equal(manifest.manifest_version, 3);
    assert.ok(manifest.permissions?.includes('storage'));
    assert.equal(manifest.background?.service_worker, 'dist/background/background.js');
    assert.ok(manifest.permissions?.includes('identity'), 'Drive authorization must be available in the source build');
    assert.deepEqual(manifest.host_permissions, ['https://www.googleapis.com/*'], 'Platform origins must remain optional');
    assert.ok(!manifest.content_scripts?.length, 'Source scripts must be permission-gated dynamic registrations');
    for (const origin of ['https://gemini.google.com/*', 'https://chatgpt.com/*', 'https://claude.ai/*', 'https://grok.com/*']) {
        assert.ok(manifest.optional_host_permissions?.includes(origin), `Missing optional host permission: ${origin}`);
    }
    const resources = manifest.web_accessible_resources?.[0]?.resources ?? [];
    assert.ok(resources.includes('dist/content/hook.js'), 'web_accessible_resources must expose dist/content/hook.js');
});

test('UI static labels in UI_COPY and HTML templates have complete EN/ZH translations', () => {
    const enKeys = Object.keys(UI_COPY.en).sort();
    const zhKeys = Object.keys(UI_COPY.zh).sort();
    assert.deepEqual(enKeys, zhKeys, 'UI_COPY keys must match across en and zh');
    for (const lang of ['en', 'zh'] as const) {
        const dict: Record<string, string> = UI_COPY[lang];
        for (const [key, value] of Object.entries(dict)) {
            assert.ok(typeof value === 'string' && value.trim().length > 0, `Empty UI_COPY.${lang}.${key}`);
        }
    }

    const startTagPattern = /<([a-zA-Z][\w:-]*)(\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\s*\/?>/g;
    const attrPattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

    for (const rel of ['src/ui/options/options.html', 'src/ui/popup/popup.html']) {
        const html = readFileSync(resolve(ROOT, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
        let checked = 0;
        for (const tagMatch of html.matchAll(startTagPattern)) {
            const [, tagName, rawAttrs = ''] = tagMatch;
            const attrs = new Map<string, string>();
            for (const attrMatch of rawAttrs.matchAll(attrPattern)) {
                const name = attrMatch[1].toLowerCase();
                const value = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4] ?? '';
                assert.ok(!attrs.has(name), `Duplicate attribute "${name}" on <${tagName}> in ${rel}`);
                attrs.set(name, value);
            }
            for (const [enAttr, zhAttr] of [['data-en', 'data-zh'], ['data-ui-en', 'data-ui-zh']] as const) {
                if (attrs.has(enAttr) || attrs.has(zhAttr)) {
                    assert.ok(attrs.get(enAttr)?.trim() && attrs.get(zhAttr)?.trim(),
                        `Incomplete inline bilingual label (${enAttr}/${zhAttr}) on <${tagName}> in ${rel}`);
                    checked++;
                }
            }
            for (const i18nAttr of ['data-i18n', 'data-i18n-title', 'data-i18n-placeholder', 'data-i18n-aria-label']) {
                if (!attrs.has(i18nAttr)) continue;
                const key = attrs.get(i18nAttr) ?? '';
                assert.ok(key in UI_COPY.en && key in UI_COPY.zh,
                    `Unknown UI_COPY key "${key}" for ${i18nAttr} in ${rel}`);
                checked++;
            }
        }
        assert.ok(checked > 0, `No bilingual labels checked in ${rel}`);
    }
});
