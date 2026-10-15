import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { validateParserDomain } from '../src/core/domain/runtimeValidation.js';
import { DOMAIN_STORAGE_VERSION, DOMAIN_CONTRACT_VERSION } from '../src/core/storage/domain/contracts.js';
import { readStoredAcquisitionHints } from '../src/core/storage/domain/transport.js';
import { saveDomainRequest, __clearDomainMemory, storageIdentity, domainStorageKey, storedParseResult } from '../src/core/storage/domain/domainStore.js';

test('Broker context is selected explicitly; malformed fields cannot be cast into native results', async () => {
    assert.deepEqual(readStoredAcquisitionHints({ image: { url: 'source', resolvedUrl: 'derived', localName: 'export/path' } }), { image: { url: 'source' } });
    for (const value of [null, [], { image: null }, { image: { url: 1 } }, { image: { candidates: ['valid', 1] } }]) {
        assert.throws(() => readStoredAcquisitionHints(value), TypeError);
    }
    const proto = JSON.parse('{"__proto__":{"url":"source"}}');
    assert.deepEqual(Object.keys(readStoredAcquisitionHints(proto)), ['__proto__']);
    __clearDomainMemory();
    await assert.rejects(saveDomainRequest('u0', { conversation: { providerId: 'gemini' }, acquisitionHints: {} }), TypeError);
});
test('writes isolate and validate once; recovery validates once; trusted adaptation does not revisit AST', async () => {
    const bundle = await build({ write: false, bundle: true, platform: 'node', format: 'iife', globalName: 'instrumentedStorage', logLevel: 'silent',
        stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
            import { saveDomainConversation,getStoredDomain,storedParseResult,storageIdentity,__clearDomainMemory } from './src/core/storage/domain/domainStore.ts';
            import { validateParserDomain,countSnapshots } from './src/core/domain/runtimeValidation.ts';
            export async function run() {
                __clearDomainMemory();
                const source={conversation:validateParserDomain({index:{providerId:'gemini',id:'independent',title:'Original',titleSource:'legacy',cloudAvailability:'unknown',hasTakeoutImport:false},detail:{completeness:'unknown',assets:[],messages:[{role:'user',content:[{type:'paragraph',children:[{type:'text',text:'Body'}]}]}]}}),acquisitionHints:{},resourceHints:{},diagnostics:[]};
                await saveDomainConversation('u0',source);
                const write=countSnapshots();
                source.conversation.detail.messages[0].content[0].children[0].text='Mutated source';
                const record=await getStoredDomain(storageIdentity('gemini','u0','independent'));
                const read=countSnapshots();
                const parsed=storedParseResult(record);
                const adaptation=countSnapshots();
                parsed.conversation.index.title='Changed';
                const isolated=record.conversation.index.title;
                await saveDomainConversation('u0',parsed);
                return {counts:[write,read,adaptation,countSnapshots()],isolated,body:record.conversation.detail.messages[0].content[0].children[0].text};
            }` }, plugins: [{ name: 'test-only-storage-counter', setup(builder) {
                builder.onLoad({ filter: /runtimeValidation\.ts$/ }, args => ({ loader: 'ts', contents:
                    readFileSync(args.path, 'utf8').replace('export function restoreDomainSnapshot(value: unknown): TrustedDomain {',
                        'let snapshots=0; export const countSnapshots=()=>snapshots; export function restoreDomainSnapshot(value: unknown): TrustedDomain { snapshots++;') }));
            } }] });
    const api: { run: () => Promise<{ counts: number[]; isolated: string; body: string }> } =
        new Function('module', 'require', bundle.outputFiles[0].text + '; return instrumentedStorage;')(undefined, createRequire(process.cwd() + '/package.json'));
    assert.deepEqual(await api.run(), { counts: [1, 2, 2, 3], isolated: 'Original', body: 'Body' });
});

test('one record copy isolates trusted graph, acquisition candidates and typed resource bytes', async () => {
    const identity = storageIdentity('gemini', 'u0', 'copy-case');
    const conversation = validateParserDomain({ index: { cloudAvailability: 'unknown', hasTakeoutImport: false, titleSource: 'legacy', providerId: 'gemini', id: 'copy-case', title: 'Original' }, detail: { completeness: 'unknown', messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Body' }] }] }], assets: [{ id: 'asset', kind: 'file', sourceUri: 'opaque:original' }] } });
    const original: import('../src/core/storage/domain/contracts.js').TrustedDomainStorageRecord = { key: domainStorageKey(identity), identity, conversation, origin: 'source' as const,
        storageVersion: DOMAIN_STORAGE_VERSION, domainVersion: DOMAIN_CONTRACT_VERSION, revision: 'copy',
        resources: [{ assetId: 'asset', bytes: new Uint8Array([1, 2, 3]) }], acquisitionHints: { asset: { candidates: ['opaque:original'] } } };
    const clone = globalThis.structuredClone; let calls = 0; let copiedBytes: Uint8Array | undefined;
    globalThis.structuredClone = <T>(value: T): T => {
        calls++; const copied = clone(value);
        if (copied && typeof copied === 'object') {
            const resources: unknown = Reflect.get(copied, 'resources');
            if (Array.isArray(resources) && resources[0] && typeof resources[0] === 'object') {
                const bytes: unknown = Reflect.get(resources[0], 'bytes');
                if (bytes instanceof Uint8Array) copiedBytes = bytes;
            }
        }
        return copied;
    };
    let adapted: ReturnType<typeof storedParseResult>;
    try { adapted = storedParseResult(original); } finally { globalThis.structuredClone = clone; }
    assert.equal(calls, 1);
    adapted.conversation.index.title = 'Changed';
    adapted.acquisitionHints.asset.candidates![0] = 'changed';
    assert.equal(original.conversation.index.title, 'Original');
    assert.equal(original.acquisitionHints.asset.candidates![0], 'opaque:original');
    original.resources[0].bytes[0] = 99;
    assert.ok(copiedBytes);
    assert.deepEqual([...copiedBytes], [1, 2, 3]);
});
