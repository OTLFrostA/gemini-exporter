/**
 * tests/canonical-schema-conformance.test.ts
 *
 * Real conformance tests against the versioned canonical JSON Schema.
 *
 * Structural validation is owned by the Ajv-generated standalone validator
 * (src/core/export/canonical/resources/validateCanonicalStructure.generated.js),
 * compiled at build time from canonical-conversation-v1.schema.json — never by
 * a hand-written interpreter, and never compiled at runtime. Project semantic
 * validation stays in validateBundle().
 *
 * Every conformance test below runs the SAME bundle through both the generated
 * structural validator and validateBundle() (structural + semantic) so the two
 * layers can never drift apart silently again.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const canonical = require('../src/core/export/canonical/index.js');
const { normalizeGeminiConversation, validateBundle } = canonical;

const generatedModule = require('../src/core/export/canonical/resources/validateCanonicalStructure.generated.js');
const validateStructure = (generatedModule && generatedModule.default) || generatedModule;
assert.strictEqual(typeof validateStructure, 'function', 'generated validator must be a function');

const fixtureDir = path.join(__dirname, 'fixtures', 'canonical');
const clone = (o: any): any => JSON.parse(JSON.stringify(o));

/** Run the generated structural validator; returns its Ajv errors (empty = valid). */
function structuralErrors(bundle: unknown): any[] {
    const valid = validateStructure(bundle);
    if (valid) {
        assert.ok(!validateStructure.errors || validateStructure.errors.length === 0, 'no errors when valid');
        return [];
    }
    return (validateStructure.errors ?? []).slice();
}

function bundleErrors(bundle: unknown): string[] {
    return validateBundle(bundle)
        .filter((d: any) => d.severity === 'error')
        .map((d: any) => `${d.code}: ${d.message}`);
}

function bundleCodes(bundle: unknown): string[] {
    return validateBundle(bundle).map((d: any) => d.code);
}

/** Assert a bundle satisfies BOTH contracts; fail loudly with the first errors. */
function assertBothContracts(bundle: unknown, label: string): void {
    const tsErrors = bundleErrors(bundle);
    assert.deepStrictEqual(tsErrors, [], `validateBundle errors for ${label}:\n${tsErrors.join('\n')}`);
    const structErrors = structuralErrors(bundle);
    assert.deepStrictEqual(
        structErrors.map((e: any) => `${e.instancePath} ${e.keyword}: ${e.message}`),
        [],
        `structural validator errors for ${label}`,
    );
}

async function loadBundle(name: string): Promise<any> {
    const raw = JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
    // Fixtures are either canonical bundles already, or raw Gemini inputs
    // (gemini-normalizer-*) that must be normalized first.
    return raw && typeof raw === 'object' && 'conversation' in raw && 'schemaVersion' in raw
        ? raw
        : (await normalizeGeminiConversation(raw)).bundle;
}

// ---------------------------------------------------------------- tests

test('every canonical fixture satisfies both the generated validator and validateBundle', async () => {
    const files = fs.readdirSync(fixtureDir).filter((f: string) => f.endsWith('.json'));
    assert.ok(files.length > 0, 'fixtures exist');
    for (const f of files) {
        assertBothContracts(await loadBundle(f), f);
    }
});

test('GeminiNormalizer output satisfies both contracts (incl. first-class inline images)', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    assertBothContracts(bundle, 'gemini-normalizer-sample output');
    // The output really exercises the new ImageInline schema branch.
    const user = (bundle as any).conversation.messages.find((m: any) => m.id === 'm-u1');
    const img = user.blocks[6].children.find((c: any) => c.type === 'image');
    assert.ok(img, 'output contains an ImageInline node');
});

test('generated validator is plain code: no eval, no new Function, no network (CSP/MV3 safe)', () => {
    const src = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'core', 'export', 'canonical', 'resources', 'validateCanonicalStructure.generated.js'),
        'utf8',
    );
    // Strip comments: the header documents the absence of dynamic code.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.ok(!/new Function\s*\(/.test(code), 'generated validator must not use new Function');
    assert.ok(!/(^|[^_.a-zA-Z$])eval\s*\(/.test(code), 'generated validator must not use eval');
    assert.ok(!/require\s*\(/.test(code), 'generated validator must be dependency-free');
});

test('rpc title with candidates and history satisfies both contracts', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    (bundle as any).conversation.title = {
        value: 'Live title',
        source: 'rpc',
        candidates: [
            { value: 'Old DOM title', source: 'dom', observedAt: '2026-09-20T00:00:00.000Z' },
            { value: 'Live title', source: 'rpc', observedAt: '2026-09-26T00:00:00.000Z' },
        ],
    };
    assertBothContracts(bundle, 'rpc title with candidates');
});

test('title without candidates is rejected as a structural required violation', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    (bundle as any).conversation.title = { value: 'No candidates', source: 'rpc' };
    const errors = structuralErrors(bundle);
    assert.ok(
        errors.some((e: any) => e.keyword === 'required' && String(e.params?.missingProperty).includes('candidates')),
        `generated validator must require title.candidates, got:\n${JSON.stringify(errors.slice(0, 5), null, 1)}`,
    );
    const codes = bundleCodes(bundle);
    assert.ok(codes.includes('STRUCT_REQUIRED'), `validateBundle must surface STRUCT_REQUIRED, got: ${codes}`);
});

test('thought block with initiallyCollapsed is rejected as an unknown extra property', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    const model = (bundle as any).conversation.messages.find((m: any) => m.id === 'm-a1');
    const thought = model.blocks.find((b: any) => b.type === 'thought');
    assert.ok(thought, 'fixture has a thought block to poison');
    thought.initiallyCollapsed = true;
    const errors = structuralErrors(bundle);
    assert.ok(
        errors.some((e: any) => e.keyword === 'additionalProperties' && String(e.params?.additionalProperty) === 'initiallyCollapsed'),
        `generated validator must reject initiallyCollapsed, got:\n${JSON.stringify(errors.slice(0, 5), null, 1)}`,
    );
    // The semantic layer still flags it too (renderer-only key leak).
    const allIssues = validateBundle(bundle);
    assert.ok(
        allIssues.some((d: any) => d.code === 'RENDERER_KEY_LEAK'),
        'validateBundle also flags initiallyCollapsed',
    );
});

test('invalid enum value maps to the stable TITLE_BAD_SOURCE diagnostic', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    (bundle as any).conversation.title.source = 'future-provider-tier';
    (bundle as any).conversation.title.candidates[0].source = 'future-provider-tier';
    const errors = structuralErrors(bundle);
    assert.ok(errors.some((e: any) => e.keyword === 'enum'), 'generated validator must flag the bad enum');
    const bad = validateBundle(bundle).filter((d: any) => d.code === 'TITLE_BAD_SOURCE');
    assert.strictEqual(bad.length, 2, `expected 2 TITLE_BAD_SOURCE, got ${JSON.stringify(bad.map((d: any) => d.path))}`);
    assert.ok(bad.some((d: any) => d.path === 'conversation.title.source'));
    assert.ok(bad.some((d: any) => d.path === 'conversation.title.candidates[0].source'));
    assert.ok(bad.every((d: any) => d.severity === 'error'));
});

test('wrong oneOf branch is rejected structurally', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    const user = (bundle as any).conversation.messages.find((m: any) => m.id === 'm-u1');
    user.blocks[6].children.push({ type: 'mystery-inline', id: 'bad-inline-1' });
    const errors = structuralErrors(bundle);
    assert.ok(
        errors.some((e: any) => e.keyword === 'oneOf'),
        `generated validator must reject the unknown inline branch, got:\n${JSON.stringify(errors.slice(0, 5), null, 1)}`,
    );
    assert.ok(bundleCodes(bundle).includes('STRUCT_ONEOF'), 'validateBundle must surface STRUCT_ONEOF');
});

test('numeric constraints are enforced structurally', async () => {
    const bundle = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'rich-conversation.json'), 'utf8'));
    const heading = (bundle as any).conversation.messages[1].blocks[1];
    assert.strictEqual(heading.type, 'heading', 'poison target is a heading block');
    heading.level = 7; // schema: integer, minimum 1, maximum 6
    const errors = structuralErrors(bundle);
    assert.ok(
        errors.some((e: any) => e.keyword === 'maximum' && e.instancePath.endsWith('/level')),
        `generated validator must enforce heading level maximum, got:\n${JSON.stringify(errors.slice(0, 5), null, 1)}`,
    );
    assert.ok(bundleCodes(bundle).includes('STRUCT_MAXIMUM'), 'validateBundle must surface STRUCT_MAXIMUM');
});

test('semantic-only errors are still detected on structurally valid bundles', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    // Duplicate asset ids: not expressible in JSON Schema, must stay project-owned.
    const asset = (bundle as any).assets[0];
    assert.ok(asset, 'fixture has an asset to duplicate');
    (bundle as any).assets.push(clone(asset));
    assert.deepStrictEqual(structuralErrors(bundle), [], 'duplicate ids are structurally valid');
    const codes = bundleCodes(bundle);
    assert.ok(codes.includes('ASSET_DUP_ID'), `expected ASSET_DUP_ID in ${codes}`);
});

test('unresolved citation refs are still detected on structurally valid bundles', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    const user = (bundle as any).conversation.messages.find((m: any) => m.id === 'm-u1');
    const para = user.blocks.find((b: any) => b.type === 'paragraph' && Array.isArray(b.children));
    assert.ok(para, 'fixture has a paragraph block to poison');
    para.children.push({ type: 'citationRef', citationId: 'no-such-citation' });
    assert.deepStrictEqual(structuralErrors(bundle), [], 'dangling refs are structurally valid');
    const codes = bundleCodes(bundle);
    assert.ok(codes.includes('CITATION_UNRESOLVED'), `expected CITATION_UNRESOLVED in ${codes}`);
});

test('no double-reporting: one structural failure yields one stable diagnostic', async () => {
    const bundle = await loadBundle('gemini-normalizer-sample.json');
    (bundle as any).schemaVersion = 2;
    const diags = validateBundle(bundle).filter((d: any) => d.severity === 'error');
    assert.strictEqual(
        diags.filter((d: any) => d.code === 'SCHEMA_VERSION').length,
        1,
        `schemaVersion=2 must yield exactly one SCHEMA_VERSION, got: ${JSON.stringify(diags.map((d: any) => d.code))}`,
    );

    const bundle2 = await loadBundle('gemini-normalizer-sample.json');
    delete (bundle2 as any).conversation.key.conversationId;
    const diags2 = validateBundle(bundle2).filter((d: any) => d.severity === 'error');
    assert.strictEqual(
        diags2.filter((d: any) => d.code === 'KEY_BAD').length,
        1,
        `missing conversationId must yield exactly one KEY_BAD, got: ${JSON.stringify(diags2.map((d: any) => d.code))}`,
    );

    // A bundle with several independent structural faults stays bounded.
    const bundle3 = await loadBundle('gemini-normalizer-sample.json');
    (bundle3 as any).schemaVersion = 2;
    delete (bundle3 as any).conversation.key.providerId;
    (bundle3 as any).assets = 'not-an-array';
    const diags3 = validateBundle(bundle3).filter((d: any) => d.severity === 'error');
    assert.ok(diags3.length <= 50, `structural diagnostics must stay bounded, got ${diags3.length}`);
});
