import test from 'node:test';
import assert from 'node:assert/strict';
import type { Conversation } from '../src/types/conversation.js';
import { parseLegacyConversation } from '../src/core/domain/legacyConversationAdapter.js';
import { prepareDomainResources } from '../src/core/export/document/prepareDomainResources.js';

const base = { id: 'resource-sources', title: '', timestamp: null };

test('renaming export paths changes prepared bindings but not Domain facts or identity', async () => {
    const input: Conversation = { ...base, messages: [{ role: 'model', content: '![caption](old/photo.png)', attachments: [{
        type: 'image', name: 'Authored photo', url: 'https://example.test/photo', localName: 'old/photo.png',
        isGenerated: true, generation: { chatId: base.id, generationOrdinal: 1, imageOrdinal: 0 },
    }] }] };
    const before = structuredClone(input);
    const renamed = structuredClone(input);
    renamed.messages![0].content = '![caption](new/photo.webp)';
    renamed.messages![0].attachments![0].localName = 'new/photo.webp';
    const first = parseLegacyConversation(input), second = parseLegacyConversation(renamed);
    assert.deepEqual(first.conversation, second.conversation);
    assert.deepEqual(input, before);
    const asset = first.conversation.assets[0];
    assert.deepEqual(asset.source, { uri: 'https://example.test/photo' });
    assert.equal(asset.name, 'Authored photo');
    assert.equal((await prepareDomainResources(first.conversation, first.resourceHints))[asset.id], 'assets/old/photo.png');
    assert.equal((await prepareDomainResources(second.conversation, second.resourceHints))[asset.id], 'assets/new/photo.webp');
    const restored = JSON.parse(JSON.stringify(first.conversation));
    assert.deepEqual(restored, first.conversation);
    assert.deepEqual(await prepareDomainResources(restored, first.resourceHints), await prepareDomainResources(first.conversation, first.resourceHints));
});

test('same export destination cannot collapse resources from different sources', () => {
    const { conversation } = parseLegacyConversation({ ...base, messages: [{ role: 'user', content: '', attachments: [
        { type: 'image', url: 'https://example.test/one', localName: 'assets/same.png' },
        { type: 'image', url: 'https://example.test/two', localName: 'assets/same.png' },
    ] }] });
    assert.equal(conversation.assets.length, 2);
    assert.notEqual(conversation.assets[0].id, conversation.assets[1].id);
});

test('one source remains one resource across renamed legacy destinations', () => {
    const { conversation } = parseLegacyConversation({ ...base, messages: [
        { role: 'user', content: '![one](one.png)', attachments: [{ type: 'image', url: 'https://example.test/shared', localName: 'one.png' }] },
        { role: 'model', content: '![two](two.png)', images: [{ type: 'image', url: 'https://example.test/shared', localName: 'two.png' }] },
    ] });
    assert.equal(conversation.assets.length, 1);
    assert.deepEqual(conversation.messages[0].attachmentIds, conversation.messages[1].attachmentIds);
    assert.ok(conversation.messages.every(message => JSON.stringify(message.content).includes(conversation.assets[0].id)));
});

test('destination-only resources retain distinct occurrence identities without path/name/kind leakage', () => {
    const input: Conversation = { ...base, messages: [{ role: 'user', content: '', attachments: [
        { type: 'file', localName: 'old/report.pdf' }, { type: 'file', localName: 'old/report.pdf' },
    ] }] };
    const renamed = structuredClone(input);
    renamed.messages![0].attachments!.forEach(item => { item.localName = 'new/image.png'; });
    const first = parseLegacyConversation(input).conversation;
    assert.deepEqual(first, parseLegacyConversation(renamed).conversation);
    assert.equal(first.assets.length, 2);
    assert.ok(first.assets.every(asset => asset.kind === 'file' && !asset.source && !asset.name));
});

test('ambiguous export aliases remain unresolved instead of becoming acquisition sources', () => {
    const { conversation } = parseLegacyConversation({ ...base, messages: [{
        role: 'user', content: '![caption](same.png)', attachments: [
            { type: 'image', url: 'https://example.test/one', localName: 'same.png' },
            { type: 'image', url: 'https://example.test/two', localName: 'same.png' },
        ],
    }] });
    assert.equal(conversation.assets.length, 3);
    assert.equal(conversation.assets[2].source, undefined);
});
