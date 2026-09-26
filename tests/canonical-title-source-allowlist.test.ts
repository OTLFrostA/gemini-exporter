export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const canonical = require('../src/core/export/canonical/index.js');
const { normalizeGeminiConversation, validateBundle } = canonical;

const schemaPath = path.join(
    __dirname, '..', 'src', 'core', 'export', 'canonical',
    'resources', 'canonical-conversation-v1.schema.json',
);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

function errorIssues(bundle: unknown): any[] {
    return (validateBundle(bundle) as any[]).filter((d: any) => d.severity === 'error');
}

function schemaSourceEnums(): { title: string[]; candidate: string[] } {
    return {
        title: schema.$defs.ConversationTitle.properties.source.enum,
        candidate: schema.$defs.TitleCandidate.properties.source.enum,
    };
}

test('unknown raw.titles key is coerced to default with a diagnostic', async () => {
    const raw = {
        id: 'title-allowlist-1',
        titles: { rpc: 'Good', 'future-provider-tier': 'Future' },
        messages: [],
    };
    const { bundle, diagnostics } = await normalizeGeminiConversation(raw as any);
    const title = (bundle as any).conversation.title;
    assert.ok(title, 'title exists');
    const future = title.candidates.find((c: any) => c.value === 'Future');
    assert.ok(future, 'Future candidate is kept');
    assert.strictEqual(future.source, 'default');
    const good = title.candidates.find((c: any) => c.value === 'Good');
    assert.strictEqual(good.source, 'rpc');
    const coerced = (diagnostics as any[]).filter((d) => d.code === 'TITLE_SOURCE_COERCED');
    assert.strictEqual(coerced.length, 1);
    assert.ok(coerced[0].message.includes('future-provider-tier'));
});

test('coerced bundle passes JSON Schema title source enums and validateBundle', async () => {
    const raw = {
        id: 'title-allowlist-2',
        titles: { rpc: 'Good', 'future-provider-tier': 'Future' },
        messages: [],
    };
    const { bundle } = await normalizeGeminiConversation(raw as any);
    const enums = schemaSourceEnums();
    const title = (bundle as any).conversation.title;
    assert.ok(enums.title.includes(title.source), `title.source '${title.source}' in schema enum`);
    for (const c of title.candidates) {
        assert.ok(enums.candidate.includes(c.source), `candidate source '${c.source}' in schema enum`);
    }
    assert.deepStrictEqual(errorIssues(bundle), []);
});

test('validateBundle rejects unknown title sources', async () => {
    const raw = { id: 'title-allowlist-3', titles: { rpc: 'Good' }, messages: [] };
    const { bundle } = await normalizeGeminiConversation(raw as any);
    const poisoned = JSON.parse(JSON.stringify(bundle));
    poisoned.conversation.title.source = 'future-provider-tier';
    poisoned.conversation.title.candidates[0].source = 'future-provider-tier';
    const issues = validateBundle(poisoned) as any[];
    const bad = issues.filter((d) => d.code === 'TITLE_BAD_SOURCE');
    assert.strictEqual(bad.length, 2);
    assert.ok(bad.some((d) => d.path === 'conversation.title.source'));
    assert.ok(bad.some((d) => d.path === 'conversation.title.candidates[0].source'));
    assert.ok(bad.every((d) => d.severity === 'error'));
});

test('unknown raw.titleSource still coerces with a diagnostic', async () => {
    const raw = {
        id: 'title-allowlist-4',
        title: 'Plain title',
        titleSource: 'future-provider-tier',
        messages: [],
    };
    const { bundle, diagnostics } = await normalizeGeminiConversation(raw as any);
    const title = (bundle as any).conversation.title;
    assert.strictEqual(title.source, 'default');
    assert.ok((diagnostics as any[]).some((d) => d.code === 'TITLE_SOURCE_COERCED'));
    assert.deepStrictEqual(errorIssues(bundle), []);
});
