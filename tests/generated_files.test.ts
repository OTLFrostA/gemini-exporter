import { fixtureAccount, fixtureAccountFor } from './helpers/domainFixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeminiRpcConversation } from '../src/l1/parsers/gemini/rpc/parseConversation.js';
import { extractGeneratedFiles } from '../src/l1/parsers/gemini/rpc/generatedFiles.js';
import { detailGen as geminiDetailGen } from './fixtures/providers/geminiDetail.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/provider/gemini_generated_file.json', 'utf8')) as { packet: unknown[]; chip: unknown[] };
const packet = fixture.packet;
test('generated file stays on its source turn, retains chip position, and carries exact UTF-8 source bytes', () => {
    const input = geminiDetailGen('G_GENERATED_FILES_01');
    const result = parseGeminiRpcConversation(input, { account: fixtureAccount('gemini'), providerId: 'gemini', targetConvId: 'e6dc4e0732ba568b' });
    const { conversation } = result;
    assert.equal(conversation.detail.assets.length, 1, 'no heuristic duplicate or cross-turn document');
    const asset = conversation.detail.assets[0];
    assert.equal(asset.name, packet[9]);
    const bytes = Uint8Array.from(atob(result.acquisitionHints[asset.id].dataBase64!), value => value.charCodeAt(0));
    assert.equal(new TextDecoder().decode(bytes), (packet[32] as unknown[])[2]);
    const earlier = conversation.detail.messages.find(message => message.id === 'rc_earlier')!;
    assert.equal(earlier.attachmentIds?.length ?? 0, 0);
    assert.deepEqual(earlier.content.map(node => node.type), ['paragraph']);
    const later = conversation.detail.messages.find(message => message.id === 'rc_later')!;
    assert.deepEqual(later.content.map(node => node.type), ['paragraph', 'file', 'paragraph']);
    assert.equal('key' in conversation.detail, false);
    assert.equal(later.attachmentIds?.[0], asset.id);

});
test('unknown file packet versions and absent content never fabricate an attachment', () => {
    for (const mutate of ['type', 'content'] as const) {
        const row = structuredClone(packet);
        if (mutate === 'type') row[10] = 99; else row[32] = null;
        const candidate: unknown[] = [];
        candidate[30] = [row];
        assert.deepEqual(extractGeneratedFiles(candidate), []);
    }
});
