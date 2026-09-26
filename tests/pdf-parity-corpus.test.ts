/**
 * tests/pdf-parity-corpus.test.ts
 *
 * Tier 1 harness for the HTML/PDF parity corpus (Phase F, §17).
 *
 * What runs TODAY (framework, not a placeholder):
 *   1. every fixture in tests/parity-corpus/*.json passes the canonical
 *      runtime validator with zero errors;
 *   2. every fixture conforms to the versioned canonical JSON Schema
 *      (src/core/export/canonical/resources/canonical-conversation-v1.schema.json),
 *      evaluated by a small reader that EXECUTES the actual schema resource --
 *      no hand-written field assertions, no new validator dependency.
 *
 * What is SKIPPED on purpose:
 *   the HTML-vs-PDF text comparison per fixture. It cannot run yet because
 *   its two inputs do not exist in this repo state:
 *     (a) #552 (HTML canonical renderer) has not merged, and
 *     (b) the Phase D real compiler has not landed.
 *   The skipped tests spell out these enable conditions so enabling them is a
 *   mechanical flip once (a) and (b) are true -- not a rewrite.
 */
export {};
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const canonical = require('../src/core/export/canonical/index.js');
const { validateBundle } = canonical;

const corpusDir = path.join(__dirname, 'parity-corpus');
const schemaPath = path.join(
    __dirname, '..', 'src', 'core', 'export', 'canonical',
    'resources', 'canonical-conversation-v1.schema.json',
);
const schema: Record<string, any> = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

const fixtureNames: string[] = fs
    .readdirSync(corpusDir)
    .filter((f: string) => f.endsWith('.json'))
    .sort();

const loadFixture = (name: string): any =>
    JSON.parse(fs.readFileSync(path.join(corpusDir, name), 'utf8'));

// ---------------------------------------------------------------------------
// Small JSON-Schema evaluator (reads and executes the real schema resource).
// Supports every keyword the canonical v1 schema uses: $ref, oneOf, type,
// required, properties, additionalProperties, items, enum, const, minimum,
// maximum, exclusiveMinimum. Same philosophy as
// tests/canonical-schema-conformance.test.ts: the repo carries no JSON-Schema
// validator dependency, and this file must not add one.
// ---------------------------------------------------------------------------

type Schema = Record<string, any>;

function kindOf(v: unknown): string {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
}

function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (kindOf(a) !== kindOf(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
    }
    if (a !== null && typeof a === 'object' && b !== null && typeof b === 'object') {
        const ao = a as Record<string, unknown>;
        const bo = b as Record<string, unknown>;
        const ka = Object.keys(ao);
        const kb = Object.keys(bo);
        return ka.length === kb.length && ka.every((k) => k in bo && deepEqual(ao[k], bo[k]));
    }
    return false;
}

function checkType(v: unknown, t: string): boolean {
    switch (t) {
        case 'string': return typeof v === 'string';
        case 'number': return typeof v === 'number';
        case 'integer': return typeof v === 'number' && Number.isInteger(v);
        case 'boolean': return typeof v === 'boolean';
        case 'object': return v !== null && typeof v === 'object' && !Array.isArray(v);
        case 'array': return Array.isArray(v);
        case 'null': return v === null;
        default: throw new Error(`parity schema evaluator: unsupported type '${t}'`);
    }
}

function resolveRef(ref: string, root: Schema): Schema {
    if (ref === '#') return root;
    const m = /^#\/\$defs\/([^/]+)$/.exec(ref);
    if (!m) throw new Error(`parity schema evaluator: unsupported $ref '${ref}'`);
    const def = root.$defs?.[m[1]];
    if (!def) throw new Error(`parity schema evaluator: unknown $defs entry '${ref}'`);
    return def;
}

interface EvalCtx {
    seen: Set<string>;
    ids: WeakMap<object, number>;
    nextId: number;
}

function valueId(value: unknown, ctx: EvalCtx): string {
    if (value !== null && typeof value === 'object') {
        let id = ctx.ids.get(value);
        if (id === undefined) {
            id = ctx.nextId++;
            ctx.ids.set(value, id);
        }
        return `obj${id}`;
    }
    return `${typeof value}:${String(value)}`;
}

function evaluate(
    s: Schema,
    value: unknown,
    root: Schema,
    path: string,
    ctx: EvalCtx,
): string[] {
    if (s.$ref !== undefined) {
        const ref = s.$ref as string;
        // Circularity is (ref, value-identity) based: re-entering the same ref
        // for a strictly smaller subvalue (e.g. BlockNode -> quote.blocks ->
        // BlockNode) always terminates on finite values and is NOT a cycle.
        const key = `${ref}@${valueId(value, ctx)}`;
        if (ctx.seen.has(key)) return [`${path}: circular $ref ${ref}`];
        ctx.seen.add(key);
        try {
            return evaluate(resolveRef(ref, root), value, root, path, ctx);
        } finally {
            ctx.seen.delete(key);
        }
    }
    const errors: string[] = [];
    if (s.const !== undefined && !deepEqual(value, s.const)) {
        errors.push(`${path}: expected const ${JSON.stringify(s.const)}, got ${JSON.stringify(value)?.slice(0, 80)}`);
    }
    if (s.enum !== undefined && !(s.enum as unknown[]).some((e) => deepEqual(e, value))) {
        errors.push(`${path}: value not in enum ${JSON.stringify(s.enum)}`);
    }
    if (s.type !== undefined) {
        const types = (Array.isArray(s.type) ? s.type : [s.type]) as string[];
        if (!types.some((t) => checkType(value, t))) {
            errors.push(`${path}: expected type ${types.join('|')}, got ${kindOf(value)}`);
            return errors;
        }
    }
    if (s.oneOf !== undefined) {
        const results = (s.oneOf as Schema[]).map((sub) => evaluate(sub, value, root, path, ctx));
        const matches = results.filter((r) => r.length === 0);
        if (matches.length !== 1) {
            errors.push(`${path}: oneOf matched ${matches.length} branches, want exactly 1`);
            results.forEach((r, i) => {
                if (r.length > 0) errors.push(`${path} ~branch${i}: ${r.slice(0, 3).join(' | ')}`);
            });
        }
    }
    if (typeof value === 'number') {
        if (s.minimum !== undefined && value < s.minimum) errors.push(`${path}: ${value} < minimum ${s.minimum}`);
        if (s.maximum !== undefined && value > s.maximum) errors.push(`${path}: ${value} > maximum ${s.maximum}`);
        if (s.exclusiveMinimum !== undefined && value <= s.exclusiveMinimum) {
            errors.push(`${path}: ${value} <= exclusiveMinimum ${s.exclusiveMinimum}`);
        }
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const obj = value as Record<string, unknown>;
        for (const req of (s.required ?? []) as string[]) {
            if (!(req in obj)) errors.push(`${path}: missing required property '${req}'`);
        }
        const props = (s.properties ?? {}) as Record<string, Schema>;
        for (const [k, v] of Object.entries(obj)) {
            if (k in props) {
                errors.push(...evaluate(props[k], v, root, path ? `${path}.${k}` : k, ctx));
            } else if (s.additionalProperties === false) {
                errors.push(`${path}: additional property '${k}' not allowed`);
            }
        }
    }
    if (Array.isArray(value) && s.items !== undefined) {
        value.forEach((item, i) => {
            errors.push(...evaluate(s.items as Schema, item, root, `${path}[${i}]`, ctx));
        });
    }
    return errors;
}

function schemaErrors(bundle: unknown): string[] {
    const ctx: EvalCtx = { seen: new Set<string>(), ids: new WeakMap(), nextId: 0 };
    return evaluate(schema, bundle, schema, '$', ctx);
}

// ---------------------------------------------------------------------------
// Gate 1 (active): runtime validator
// ---------------------------------------------------------------------------

test('parity corpus: every fixture passes the canonical runtime validator', () => {
    assert.ok(fixtureNames.length >= 4, `expected >= 4 parity fixtures, found ${fixtureNames.length}`);
    for (const name of fixtureNames) {
        const diags = validateBundle(loadFixture(name)) as Array<{ severity: string; code: string; message: string }>;
        const errors = diags.filter((d) => d.severity === 'error');
        assert.deepStrictEqual(errors, [], `${name}: validator errors: ${JSON.stringify(errors)}`);
        const warnings = diags.filter((d) => d.severity === 'warning');
        assert.deepStrictEqual(warnings, [], `${name}: validator warnings (keep fixtures clean): ${JSON.stringify(warnings)}`);
    }
});

test('parity corpus: long-conversation fixture really is a long conversation', () => {
    const bundle = loadFixture('long-conversation-121.json');
    const messages = bundle.conversation.messages as Array<{ id: string }>;
    assert.strictEqual(messages.length, 121, 'long-conversation fixture must carry 121 messages');
    assert.strictEqual(bundle.conversation.selectedLeafMessageId, messages[messages.length - 1].id);
    const blockIds = new Set<string>();
    for (const m of messages) {
        for (const b of (m as any).blocks as Array<{ id: string }>) {
            assert.ok(!blockIds.has(b.id), `duplicate block id ${b.id}`);
            blockIds.add(b.id);
        }
    }
});

// ---------------------------------------------------------------------------
// Gate 2 (active): JSON Schema conformance against the real schema resource
// ---------------------------------------------------------------------------

test('parity corpus: every fixture conforms to canonical-conversation-v1.schema.json', () => {
    for (const name of fixtureNames) {
        const errs = schemaErrors(loadFixture(name));
        assert.deepStrictEqual(errs, [], `${name}: schema errors:\n${errs.slice(0, 10).join('\n')}`);
    }
});

// ---------------------------------------------------------------------------
// Gate 3 (SKIPPED): HTML-vs-PDF text parity per fixture.
//
// ENABLE CONDITIONS (both required; flipping the skip is then mechanical):
//   1. PR #552 (HTML canonical renderer) is merged, so a fixture can be
//      rendered to canonical HTML in-process; and
//   2. the Phase D real compiler has landed, so the same fixture can be
//      compiled to PDF in-process and its text extracted.
// Until then these tests stay skipped -- they assert nothing about a
// pipeline that does not exist yet.
// ---------------------------------------------------------------------------

for (const name of fixtureNames) {
    test.skip(`parity corpus (pending #552 + Phase D compiler): HTML-vs-PDF text parity for ${name}`, () => {
        // Planned assertion once enabled:
        //   const htmlText = extractText(renderCanonicalHtml(loadFixture(name)));
        //   const pdfText  = extractText(await compileCanonicalPdf(loadFixture(name)));
        //   assert.deepStrictEqual(normalizeForParity(pdfText), normalizeForParity(htmlText));
        throw new Error('not enabled: #552 HTML canonical renderer + Phase D compiler required');
    });
}
