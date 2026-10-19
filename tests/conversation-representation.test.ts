
import { fixtureAccountFor } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalFixture } from './helpers/nativeFixture.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';

const captured = () => historicalFixture({ id: 'upgraded', title: 'Snapshot title', messages: [{ role: 'assistant', content: 'Saved body' }] });

test('AST: Index owns exported metadata while the body version remains capture evidence', () => {
    const parsed = {   ...captured(), sourceVersion: 100 };
    parsed.conversation.index.title = 'Current rename';
    parsed.conversation.index.updatedAt = 200;
    const document = composeDomainDocument(parsed.conversation, fixtureAccountFor(parsed.conversation));
    assert.equal(document.header.title, 'Current rename');
    assert.equal(document.metadata?.updatedAt, new Date(200).toISOString());
});
