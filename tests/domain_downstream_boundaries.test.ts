import { fixtureKey } from './helpers/domainFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosticSnapshot } from '../src/core/diagnostics/diagnosticSnapshot.js';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { contentComposer } from '../src/core/document/compose/composeContent.js';
import type { DomainConversationIndex } from '../src/core/domain/conversationIndex.js';

const index: DomainConversationIndex = { key: fixtureKey(String('review123'), 'gemini'),   title: 'Review fixture', titleSource: "provider",   updatedAt: 1700000000000 };

test('diagnostic acquisition rejects bad records individually before typed state calculation', async () => {
    for (const record of [null, [], 1, { chatTime: { toString: null } }, { messageCount: 'many' }, { status: {} }, { hasFailedAssets: 'yes' }, { chatTime: Infinity }]) {
        const snapshot = await buildDiagnosticSnapshot({
            conversations: [index, { ...index, key: { ...index.key, conversationId: 'valid' } }],
            exportedIds: { review123: record, valid: { exportedAt: 1700000000000, format: 'markdown', status: 'ok', chatTime: index.updatedAt } },
        });
        assert.deepEqual(snapshot.exportRecoveryIssues, ['Rejected export record: review123']);
        assert.equal(snapshot.conversationsStateMirror[0].derivedState.state, 'unexported');
        assert.equal(snapshot.conversationsStateMirror[1].derivedState.state, 'exported_ok');
        assert.equal(snapshot.storageOverview.totalExportedRecords, 1);
    }
    const snapshot = await buildDiagnosticSnapshot({ conversations: [index], exportedIds: [] });
    assert.deepEqual(snapshot.exportRecoveryIssues, ['Invalid export record container']);
});

test('validated tables compose across header rowspans without changing Domain data', () => {
    const input = validateParserDomain({ index, detail: { key: index.key, quality: { status: 'complete' }, assets: [], messages: [{ role: 'assistant', content: [{ type: 'table', headerRows: [{ cells: [{ children: [], rowSpan: 2 }] }], rows: [{ cells: [{ children: [], colSpan: 2 }] }, { cells: [] }] }] }] } });
    const original = JSON.stringify(input);
    const blocks = contentComposer(new Map(), id => ({ id, label: id }))(input.detail.messages[0].content);
    assert.equal(JSON.stringify(input), original);
    const table = blocks[0];
    assert.equal(table.type, 'table');
    if (table.type !== 'table') throw new Error('Expected table');
    assert.deepEqual(table.columnAlignments, ['default', 'default', 'default']);
    assert.equal(table.rows[0][0].column, 1);
    assert.equal(table.rows[0][0].colSpan, 2);
    assert.deepEqual(table.rows[1], []);
});
