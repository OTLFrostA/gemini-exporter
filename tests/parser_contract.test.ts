import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ListParseResult } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { DetailParseResult, ParserMessage } from '../src/core/api/client/detailTypes.js';
import type { GeminiDetailEvidence } from '../src/core/parsers/gemini/rpc/detailEvidence.js';
import { createNativeDetailView } from '../src/core/compatibility/gemini/nativeDetailView.js';
import type { GeminiParserExtractorsModule } from '../src/core/parsers/gemini/rpc/extractors.js';
import type { ListParseDiagnostics } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { DetailParseDiagnostics, ParserDocument, ParserAttachment } from '../src/core/api/client/detailTypes.js';
import type { Citation } from '../src/core/parsers/gemini/rpc/extractors.js';
import type { GeminiProtocolModule } from '../src/core/protocol/protocol.js';
import type { GeminiUtilsModule } from '../src/core/utils/utils.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { decodeGeminiDetail } from '../src/core/parsers/gemini/rpc/detailDecoder.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';

// Compile-time regression: native evidence and application views preserve contracts rather
// than widening media/results/dependencies back to an unchecked escape.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type OutputContracts = [
    Assert<Equal<ListParseResult['_raw'], unknown>>,
    Assert<Equal<DetailParseResult['_raw'], unknown>>,
    Assert<Equal<ListParseResult['_debug'], ListParseDiagnostics | undefined>>,
    Assert<Equal<DetailParseResult['_debug'], DetailParseDiagnostics | null | undefined>>,
    Assert<Equal<DetailParseResult['messages'][number], ParserMessage>>,
    Assert<Equal<ParserMessage['documents'], ParserDocument[] | undefined>>,
    Assert<Equal<ParserMessage['citations'], Citation[] | undefined>>,
    Assert<Equal<ParserMessage['attachments'], ParserAttachment[] | undefined>>,
    Assert<Equal<ReturnType<GeminiParserExtractorsModule['getProtocol']>, GeminiProtocolModule>>,
    Assert<Equal<ReturnType<GeminiParserExtractorsModule['getUtils']>, GeminiUtilsModule>>,
    Assert<Equal<ReturnType<typeof parseList>, ListParseResult>>,
    Assert<Equal<ReturnType<typeof createNativeDetailView>, DetailParseResult>>,
    Assert<Equal<ReturnType<typeof decodeGeminiDetail>, GeminiDetailEvidence>>,
];
const contracts: OutputContracts = [true, true, true, true, true, true, true, true, true, true, true, true, true];
test('native parser evidence and application transport contracts remain explicitly typed', () => {
    assert.ok(contracts.every(Boolean));
});

test('detail error narrowing preserves Error and non-Error diagnostic text', () => {
    try {
        for (const [thrown, expected] of [
            [new Error('fixture failure'), 'detail parse fail: fixture failure'],
            [{ message: 'object failure' }, 'detail parse fail: object failure'],
            [{ message: 42 }, 'detail parse fail: 42'],
            ['primitive failure', 'detail parse fail: undefined']
        ] as const) {
            __setModuleOverride('GeminiUtils', { isDevMode() { throw thrown; } });
            assert.throws(() => decodeGeminiDetail('[]'), { message: expected });
        }
        // Legacy null/undefined throws fail at the property read itself.
        for (const thrown of [null, undefined]) {
            __setModuleOverride('GeminiUtils', { isDevMode() { throw thrown; } });
            assert.throws(() => decodeGeminiDetail('[]'), TypeError);
        }
    } finally {
        __clearModuleOverrides();
    }
});

test('list error narrowing preserves Error and non-Error diagnostic text', () => {
    const previousWarn = console.warn;
    const previousError = console.error;
    try {
        console.error = () => {};
        for (const [thrown, expected] of [
            [new Error('fixture failure'), '列表解析失败: fixture failure'],
            [{ message: 'object failure' }, '列表解析失败: object failure'],
            [{ message: 42 }, '列表解析失败: 42'],
            ['primitive failure', '列表解析失败: undefined']
        ] as const) {
            console.warn = () => { throw thrown; };
            assert.throws(() => parseList('[]'), { message: expected });
        }
        for (const thrown of [null, undefined]) {
            console.warn = () => { throw thrown; };
            assert.throws(() => parseList('[]'), TypeError);
        }
    } finally {
        console.warn = previousWarn;
        console.error = previousError;
    }
});
