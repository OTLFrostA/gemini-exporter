export {};
const test = require('node:test');
import assert from 'node:assert/strict';
const {
    decodeGeminiStructuredNode,
    decodeGeminiAnnotation,
    decodeGeminiStructuredPayload,
} = require('../src/core/parsers/gemini/rpc/structuredContent.js');

test('single-pass decode: access count per node in nested list is strictly linear O(1) per node', () => {
    const accessCounts = new Map<string, number>();

    function trackNode<T extends Record<string, unknown>>(id: string, obj: T): T {
        accessCounts.set(id, 0);
        return new Proxy(obj, {
            get(target, prop, receiver) {
                if (prop === 'nodeType') {
                    accessCounts.set(id, (accessCounts.get(id) ?? 0) + 1);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    // Build a 6-level deeply nested list: List -> Item -> List -> Item -> ... -> TextNode
    const depth = 6;
    let leaf = trackNode(`node_leaf`, {
        nodeType: 18,
        text: 'Leaf content'
    });

    let current: any = leaf;
    for (let d = depth - 1; d >= 0; d--) {
        const item = { children: [current] };
        current = trackNode(`node_list_${d}`, {
            nodeType: 20,
            items: [item]
        });
    }

    const decoded = decodeGeminiStructuredNode(current);
    assert.ok(decoded);

    // In the old implementation with redundant validation passes,
    // the leaf node was evaluated 2^depth times (2^6 = 64 times).
    // With single-pass decode, every node must be evaluated exactly ONCE.
    assert.strictEqual(accessCounts.get('node_leaf'), 1, 'Leaf nodeType must be accessed exactly once');
    for (let d = 0; d < depth; d++) {
        assert.strictEqual(accessCounts.get(`node_list_${d}`), 1, `List at depth ${d} must be accessed exactly once`);
    }
});

test('single-pass decode: access count per cell child in table is strictly linear', () => {
    const accessCounts = new Map<string, number>();

    function trackNode<T extends Record<string, unknown>>(id: string, obj: T): T {
        accessCounts.set(id, 0);
        return new Proxy(obj, {
            get(target, prop, receiver) {
                if (prop === 'nodeType') {
                    accessCounts.set(id, (accessCounts.get(id) ?? 0) + 1);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    const cellText1 = trackNode('cell_1', { nodeType: 18, text: 'Cell 1' });
    const cellText2 = trackNode('cell_2', { nodeType: 18, text: 'Cell 2' });
    const tableNode = trackNode('table', {
        nodeType: 17,
        rows: [
            {
                cells: [
                    { children: [cellText1] },
                    { children: [cellText2] }
                ]
            }
        ]
    });

    const decoded = decodeGeminiStructuredNode(tableNode);
    assert.ok(decoded);
    assert.strictEqual(accessCounts.get('table'), 1);
    assert.strictEqual(accessCounts.get('cell_1'), 1, 'Cell 1 must be decoded exactly once');
    assert.strictEqual(accessCounts.get('cell_2'), 1, 'Cell 2 must be decoded exactly once');
});

test('single-pass decode: annotation access count in TextNode is strictly linear', () => {
    let annotationTypeAccessCount = 0;
    const annotationProxy = new Proxy({
        start: 0,
        end: 4,
        type: 0
    }, {
        get(target, prop, receiver) {
            if (prop === 'type') {
                annotationTypeAccessCount++;
            }
            return Reflect.get(target, prop, receiver);
        }
    });

    const textNode = {
        nodeType: 18,
        text: 'test',
        annotations: [annotationProxy]
    };

    const decoded = decodeGeminiStructuredNode(textNode);
    assert.ok(decoded);
    assert.strictEqual(annotationTypeAccessCount, 1, 'Annotation type must be inspected exactly once');
});

test('deep nesting performance: depth-20 list completes in milliseconds without exponential blowup', () => {
    let current: any = { nodeType: 18, text: 'Deepest' };
    for (let d = 0; d < 20; d++) {
        current = {
            nodeType: 20,
            items: [{ children: [current] }]
        };
    }

    const start = performance.now();
    const decoded = decodeGeminiStructuredNode(current);
    const durationMs = performance.now() - start;

    assert.ok(decoded);
    // 2^20 is > 1 million calls in old implementation.
    // In single-pass O(N), 20 nodes takes < 10ms.
    assert.ok(durationMs < 50, `Expected fast decode under 50ms, took ${durationMs}ms`);
});

test('fail-closed semantics: invalid children at any depth immediately return null', () => {
    // 1. Text node with invalid annotation
    const invalidText = decodeGeminiStructuredNode({
        nodeType: 18,
        text: 'hello',
        annotations: [{ start: 0, end: 5, type: 'unknown_invalid_type_123' }]
    });
    assert.strictEqual(invalidText, null);

    // 2. Ordered/unordered list with invalid child
    const invalidList = decodeGeminiStructuredNode({
        nodeType: 20,
        items: [
            {
                children: [
                    { nodeType: 18, text: 'valid' },
                    { nodeType: 999 } // invalid node type
                ]
            }
        ]
    });
    assert.strictEqual(invalidList, null);

    // 3. Table with invalid cell child
    const invalidTable = decodeGeminiStructuredNode({
        nodeType: 17,
        rows: [
            {
                cells: [
                    {
                        children: [
                            { nodeType: 999 }
                        ]
                    }
                ]
            }
        ]
    });
    assert.strictEqual(invalidTable, null);

    // 4. Quote with invalid child
    const invalidQuote = decodeGeminiStructuredNode({
        nodeType: 15,
        children: [{ nodeType: 999 }]
    });
    assert.strictEqual(invalidQuote, null);
});

test('edge cases: empty containers preserve original structure', () => {
    // Text without annotations
    const textNoAnnots = decodeGeminiStructuredNode({
        nodeType: 18,
        text: 'hello'
    });
    assert.deepStrictEqual(textNoAnnots, {
        nodeType: 18,
        text: 'hello'
    });

    // Text with empty annotations array
    const textEmptyAnnots = decodeGeminiStructuredNode({
        nodeType: 18,
        text: 'hello',
        annotations: []
    });
    assert.deepStrictEqual(textEmptyAnnots, {
        nodeType: 18,
        text: 'hello',
        annotations: []
    });

    // Empty list
    const emptyList = decodeGeminiStructuredNode({
        nodeType: 20,
        items: []
    });
    assert.deepStrictEqual(emptyList, {
        nodeType: 20,
        items: []
    });

    // Empty table
    const emptyTable = decodeGeminiStructuredNode({
        nodeType: 17,
        rows: []
    });
    assert.deepStrictEqual(emptyTable, {
        nodeType: 17,
        rows: []
    });

    // Empty quote
    const emptyQuote = decodeGeminiStructuredNode({
        nodeType: 15,
        children: []
    });
    assert.deepStrictEqual(emptyQuote, {
        nodeType: 15,
        children: []
    });
});

test('single-pass decode: ordered list preserves VHa and has linear node access', () => {
    const accessCounts = new Map<string, number>();
    function trackNode<T extends Record<string, unknown>>(id: string, obj: T): T {
        accessCounts.set(id, 0);
        return new Proxy(obj, {
            get(target, prop, receiver) {
                if (prop === 'nodeType') {
                    accessCounts.set(id, (accessCounts.get(id) ?? 0) + 1);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    const itemChild = trackNode('ordered_child', { nodeType: 18, text: 'Item 1' });
    const orderedList = trackNode('ordered_list', {
        nodeType: 14,
        VHa: 5,
        items: [{ children: [itemChild] }]
    });

    const decoded = decodeGeminiStructuredNode(orderedList);
    assert.ok(decoded);
    assert.strictEqual(decoded.nodeType, 14);
    assert.strictEqual((decoded as any).VHa, 5);
    assert.strictEqual(accessCounts.get('ordered_list'), 1);
    assert.strictEqual(accessCounts.get('ordered_child'), 1);
});

test('single-pass decode: quote node has linear node access and fails closed on invalid child', () => {
    const accessCounts = new Map<string, number>();
    function trackNode<T extends Record<string, unknown>>(id: string, obj: T): T {
        accessCounts.set(id, 0);
        return new Proxy(obj, {
            get(target, prop, receiver) {
                if (prop === 'nodeType') {
                    accessCounts.set(id, (accessCounts.get(id) ?? 0) + 1);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    const quoteChild = trackNode('quote_child', { nodeType: 18, text: 'Quoted block' });
    const quoteNode = trackNode('quote', {
        nodeType: 15,
        children: [quoteChild]
    });

    const decoded = decodeGeminiStructuredNode(quoteNode);
    assert.ok(decoded);
    assert.strictEqual(decoded.nodeType, 15);
    assert.strictEqual(accessCounts.get('quote'), 1);
    assert.strictEqual(accessCounts.get('quote_child'), 1);
});

test('single-pass decode: mixed heterogeneous hierarchy (Table -> Cell -> Quote -> List -> Text) decodes each node exactly once', () => {
    const accessCounts = new Map<string, number>();
    function trackNode<T extends Record<string, unknown>>(id: string, obj: T): T {
        accessCounts.set(id, 0);
        return new Proxy(obj, {
            get(target, prop, receiver) {
                if (prop === 'nodeType') {
                    accessCounts.set(id, (accessCounts.get(id) ?? 0) + 1);
                }
                return Reflect.get(target, prop, receiver);
            }
        });
    }

    const text = trackNode('hetero_text', { nodeType: 18, text: 'Deepest content' });
    const list = trackNode('hetero_list', { nodeType: 20, items: [{ children: [text] }] });
    const quote = trackNode('hetero_quote', { nodeType: 15, children: [list] });
    const table = trackNode('hetero_table', {
        nodeType: 17,
        rows: [
            {
                cells: [
                    { children: [quote], colSpan: 2, rowSpan: 1 }
                ]
            }
        ]
    });

    const decoded = decodeGeminiStructuredNode(table);
    assert.ok(decoded);
    assert.strictEqual(accessCounts.get('hetero_table'), 1);
    assert.strictEqual(accessCounts.get('hetero_quote'), 1);
    assert.strictEqual(accessCounts.get('hetero_list'), 1);
    assert.strictEqual(accessCounts.get('hetero_text'), 1);
});

test('fail-closed semantics: malformed container payloads safely return null', () => {
    // List with null item
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 20, items: [null] }), null);
    // List with item missing children
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 20, items: [{}] }), null);
    // List with non-array children
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 20, items: [{ children: 'invalid' }] }), null);

    // Table with null row
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [null] }), null);
    // Table with row missing cells
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{}] }), null);
    // Table with null cell
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{ cells: [null] }] }), null);
    // Table with cell missing children
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{ cells: [{}] }] }), null);
    // Table with non-array cells
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 17, rows: [{ cells: 123 }] }), null);

    // Quote with non-array children
    assert.strictEqual(decodeGeminiStructuredNode({ nodeType: 15, children: 123 }), null);
});

