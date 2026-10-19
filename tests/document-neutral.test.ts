import { fixtureAccountFor } from './helpers/domainFixture.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';

function fixture(): DomainConversationWithDetail {
    return JSON.parse(readFileSync('tests/fixtures/document-domain/document-neutral.json', 'utf8'));
}

function freeze(value: unknown): void { if (!value || typeof value !== 'object') return; Object.freeze(value); Object.values(value).forEach(freeze); }

test('AST: neutral tree has no output controls and renderers do not import source models', () => {
    const document = composeDomainDocument(validateParserDomain(fixture()), fixtureAccountFor(validateParserDomain(fixture())));
    const forbidden = new Set(['pdfLayout', 'layout', 'gapBeforePt', 'gapAfterPt', 'measurementText', 'minWidthCards', 'profile', 'theme', 'frontMatter', 'copy', 'repeatHeader', 'locale', 'badge', 'openLabel', 'showHeader', 'initiallyCollapsed', 'emptyNotice']);
    function check(value: unknown): void { if (!value || typeof value !== 'object') return; for (const [key, child] of Object.entries(value)) { assert.ok(!forbidden.has(key), key); check(child); } }
    check(document);
    // Inspect import/export declarations, not unrelated implementation tokens.
    // TypeScript 7 no longer exposes preProcessFile; keep this guard test-only.
    const importSources = (file: string): string[] =>
        [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)\s+(?:(?:type\s+)?[^;]*?\bfrom\s+)?(['"])([^'"]+)\1/gm)]
            .map(match => match[2]);
    for (const name of ['html/renderHtml', 'markdown/renderMarkdown', 'typst/renderTypst', 'shared/backendPresentation', 'shared/renderOptions', 'shared/renderStrings']) {
        for (const source of importSources(`src/core/renderers/${name}.ts`)) {
            assert.doesNotMatch(source, /(^|\/)(?:canonical|domain|provider|content)\//,
                `Renderer ${name} cannot import source-model module ${source}`);
        }
    }
    const composerImports = importSources('src/core/document/compose/composeDomainDocument.ts');
    assert.ok(composerImports.every(source => !source.includes('/renderers/')),
        'Document composition must not import an output backend');
});
