import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { assertDocumentAst, assertDocumentAsts } from './helpers/assertDocumentAst.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import type { DomainConversationDetail } from '../src/core/domain/conversationDetail.js';

const valid = () => ({ schemaVersion: 2, header: { title: 'T', providerLabel: 'custom', messageCount: 1 }, messages: [{ type: 'message', id: 'm', variant: 'flow', label: 'assistant', modelLabel: 'Model', blocks: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'image', resourceId: 'i', alt: 'Image' }] }] }] }] });

test('every visual/parity corpus fixture satisfies the exact current DocumentAst definition', () => {
    const entries: Array<{ value: unknown; context: string }> = [];
    for (const directory of ['tests/fixtures/visual-corpus', 'tests/parity-corpus']) {
        for (const file of readdirSync(directory).filter(file => file.endsWith('.json'))) {
            const fixture = JSON.parse(readFileSync(`${directory}/${file}`, 'utf8'));
            entries.push({ value: fixture.document, context: `${directory}/${file}.document` });
        }
    }
    for (const file of readdirSync('tests/fixtures/document-domain').filter(file => file.endsWith('.json'))) {
        const input: DomainConversationDetail = JSON.parse(readFileSync(`tests/fixtures/document-domain/${file}`, 'utf8'));
        entries.push({ value: composeDomainDocument(input).document, context: file });
    }
    assertDocumentAsts(entries);
});

test('contract rejects stale fields, nested extras, missing fields, wrong types and discriminants', () => {
    assertDocumentAst(valid());
    const mutations: Array<(value: ReturnType<typeof valid>) => void> = [
        value => Object.assign(value.messages[0], { anchor: 'legacy' }),
        value => Object.assign(value, { diagnostics: [] }),
        value => Object.assign(value.messages[0].blocks[0].children[0].children[0], { assetId: 'legacy' }),
        value => Object.assign(value.messages[0].blocks[0].children[0].children[0], { alt: 123 }),
        value => { Reflect.deleteProperty(value.messages[0], 'id'); },
        value => Object.assign(value.messages[0].blocks[0], { type: 'note' }),
        value => Object.assign(value.messages[0], { label: 'model' }),
        value => Object.assign(value.header, { messageCount: '1' }),
        value => Object.assign(value, { schemaVersion: 1 }),
        value => Object.assign(value.messages[0], { modelLabel: 42 }),
        value => Object.assign(value.messages[0], { blocks: {} }),
        value => Object.assign(value.messages[0], { sources: { type: 'sources', items: [], anchor: 'legacy' } }),
    ];
    for (const mutate of mutations) {
        const value = valid(); mutate(value);
        assert.throws(() => assertDocumentAst(value), TypeError);
    }
});
