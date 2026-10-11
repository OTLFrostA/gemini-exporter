import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import { extractGeneratedFiles } from '../src/core/parsers/gemini/rpc/generatedFiles.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../src/core/renderers/markdown/renderMarkdown.js';

const fixture = JSON.parse(readFileSync('tests/fixtures/provider/gemini_generated_file.json', 'utf8')) as { packet: unknown[]; chip: unknown[] };
const packet = fixture.packet;
function turn(text: string, id: string, document: boolean): unknown[] {
    const candidate: unknown[] = ['rc_' + id, [text], 'en'];
    const payload: unknown[] = [[candidate]];
    if (document) {
        candidate[30] = [packet];
        payload[12] = [[[ [null, [null, 0, 'Before']], fixture.chip, [null, [null, 0, 'After']] ]]];
    }
    return [['r_' + id, 'c_e6dc4e0732ba568b'], [1700000000, 0], [['Prompt']], payload];
}
test('generated file stays on its source turn, retains chip position, and carries exact UTF-8 source bytes', () => {
    const input = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[turn('Before\n\nAfter', 'later', true), turn('Earlier caption', 'earlier', false)]])]]);
    const result = parseGeminiRpcConversation(input, { providerId: 'gemini', targetConvId: 'e6dc4e0732ba568b' });
    const { conversation } = result;
    assert.equal(conversation.assets.length, 1, 'no heuristic duplicate or cross-turn document');
    const asset = conversation.assets[0];
    assert.equal(asset.name, packet[9]);
    const bytes = Uint8Array.from(atob(asset.dataBase64!), value => value.charCodeAt(0));
    assert.equal(new TextDecoder().decode(bytes), (packet[32] as unknown[])[2]);
    const earlier = conversation.messages.find(message => message.id === 'rc_earlier')!;
    assert.equal(earlier.attachmentIds?.length ?? 0, 0);
    assert.deepEqual(earlier.content.map(node => node.type), ['paragraph']);
    const later = conversation.messages.find(message => message.id === 'rc_later')!;
    assert.deepEqual(later.content.map(node => node.type), ['paragraph', 'file', 'paragraph']);
    const output = renderDocumentMarkdown(composeDomainDocument(conversation).document, { [asset.id]: 'files/plant_hydraulic_models.tex' });
    assert.equal(output.match(/\[Plant Hydraulic Network Modeling\]/g)?.length, 1);
    assert.match(output, /Before\n\n\[Plant Hydraulic Network Modeling\].*\n\nAfter/);
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
