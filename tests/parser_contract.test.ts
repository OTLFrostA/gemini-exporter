import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GeminiResponseParserFacade, ListParseResult, DetailParseResult, ParserMessage } from '../src/core/api/geminiParser.js';
import type { GeminiParserAttachmentsModule } from '../src/core/api/parser/attachments.js';
import type { GeminiParserExtractorsModule } from '../src/core/api/parser/extractors.js';
import type { ListParseDiagnostics } from '../src/core/api/parser/parseList.js';
import type { DetailParseDiagnostics, ParserDocument, ParserAttachment } from '../src/core/api/parser/parseDetail.js';
import type { Citation } from '../src/core/api/parser/extractors.js';
import type { GeminiProtocolModule } from '../src/core/protocol/protocol.js';
import type { GeminiUtilsModule } from '../src/core/utils/utils.js';
import { parseList } from '../src/core/api/parser/parseList.js';
import { parseDetail } from '../src/core/api/parser/parseDetail.js';
import { __setModuleOverride, __clearModuleOverrides } from '../src/core/utils/moduleOverrides.js';

// Compile-time regression: the facade must preserve module contracts rather
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
    Assert<Equal<GeminiResponseParserFacade['extractImages'], GeminiParserAttachmentsModule['extractImages']>>,
    Assert<Equal<GeminiResponseParserFacade['parseDocSections'], GeminiParserAttachmentsModule['parseDocSections']>>,
    Assert<Equal<GeminiResponseParserFacade['deepWalk'], GeminiParserExtractorsModule['deepWalk']>>,
    Assert<Equal<ReturnType<GeminiParserExtractorsModule['getProtocol']>, GeminiProtocolModule>>,
    Assert<Equal<ReturnType<GeminiParserExtractorsModule['getUtils']>, GeminiUtilsModule>>,
    Assert<Equal<ReturnType<typeof parseList>, ListParseResult>>,
    Assert<Equal<ReturnType<typeof parseDetail>, DetailParseResult>>,
    Assert<Equal<ReturnType<GeminiResponseParserFacade['parseList']>, ListParseResult>>,
    Assert<Equal<ReturnType<GeminiResponseParserFacade['parseDetail']>, DetailParseResult>>
];
const contracts: OutputContracts = [true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true];
test('parser output and facade contracts remain explicitly typed', () => {
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
            assert.throws(() => parseDetail('[]'), { message: expected });
        }
        // Legacy null/undefined throws fail at the property read itself.
        for (const thrown of [null, undefined]) {
            __setModuleOverride('GeminiUtils', { isDevMode() { throw thrown; } });
            assert.throws(() => parseDetail('[]'), TypeError);
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
