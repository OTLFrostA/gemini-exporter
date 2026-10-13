import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseLegacyStorageConversation } from '../src/core/parsers/legacyStorage/parseConversation.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';

test('source identity semantics remain separate from nonempty storage identity', () => {
    const source = { providerId: 'future', id: '', title: '', timestamp: null, assets: [], messages: [] };
    assert.equal(validateParserDomain(source), source);
    assert.throws(() => restoreDomainSnapshot(source), /Empty stored conversation identity/);
});
test('legacy coverage corrections are included in the finalized Domain', () => {
    const result = parseLegacyStorageConversation({ metadata: { id: 'old', messageCount: 2 } }, { providerId: 'gemini' });
    assert.equal(result.conversation.completeness?.status, 'partial');
    assert.equal(result.diagnostics[0].code, 'LEGACY_BODY_NOT_STORED');
    const corrected = parseLegacyStorageConversation({ metadata: { id: 'old', messages: [{ role: 'user', content: 'Preserved' }] } },
        { providerId: 'gemini', completenessOverride: { status: 'partial', reason: 'Ambiguous account' } });
    assert.deepEqual(corrected.conversation.completeness, { status: 'partial', reason: 'Ambiguous account' });
    assert.equal(corrected.conversation.messages.length, 1);
});
test('direct parser and dispatcher establish trust once; page merge validates only the new graph', async () => {
    // Instrument a separately bundled test module; no counters or telemetry in production.
    const bundle = await build({ write: false, bundle: true, platform: 'node', format: 'iife', globalName: 'instrumentedParsers', logLevel: 'silent',
        stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
            import { parseGeminiRpcConversation } from './src/core/parsers/gemini/rpc/parseConversation.ts';
            import { parseConversation } from './src/core/parsers/parseConversation.ts';
            import { parseLegacyStorageConversation } from './src/core/parsers/legacyStorage/parseConversation.ts';
            import { mergeConversationPages } from './src/core/parsers/gemini/rpc/mergePages.ts';
            import { count } from './src/core/domain/runtimeValidation.ts';
            export function run() {
                const wire = JSON.stringify([['wrb.fr', 'hNvQHb', JSON.stringify([[[['c_test', 'r_turn'], [1700000000,0], [['Question']], [[['rc_answer', [['Answer']]]]]]]])]]);
                const direct = parseGeminiRpcConversation(wire, { providerId:'gemini' });
                const afterDirect = count();
                const dispatched = parseConversation({ format:'gemini-rpc', providerId:'gemini', data:wire });
                const afterDispatcher = count();
                const merged = mergeConversationPages([direct, dispatched]);
                const afterMerge = count();
                const legacy = parseLegacyStorageConversation({ metadata:{id:'old',messageCount:2} }, { providerId:'gemini' });
                return { counts:[afterDirect,afterDispatcher,afterMerge,count()], roles:merged.conversation.messages.map(m=>m.role), coverage:legacy.conversation.completeness.status };
            }` },
        plugins: [{ name: 'test-only-validator-counter', setup(builder) {
            builder.onLoad({ filter: /runtimeValidation\.ts$/ }, args => ({ loader: 'ts', contents:
                readFileSync(args.path, 'utf8').replace('export function validateParserDomain(value: DomainConversationDetail): TrustedDomain {',
                    'let calls = 0; export const count = () => calls; export function validateParserDomain(value: DomainConversationDetail): TrustedDomain { calls++;') }));
        } }] });
    const instrumented: { run: () => { counts: number[]; roles: string[]; coverage: string } } =
        new Function('module', 'require', bundle.outputFiles[0].text + '; return instrumentedParsers;')(undefined, createRequire(process.cwd() + '/package.json'));
    assert.deepEqual(instrumented.run(), { counts: [1, 2, 3, 4], roles: ['user', 'assistant'], coverage: 'partial' });
});
