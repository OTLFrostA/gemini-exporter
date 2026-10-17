import { fixtureAccount } from './helpers/domainFixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ListParseResult } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { DetailParseResult } from '../src/core/api/client/detailTypes.js';
import type { GeminiDetailEvidence } from '../src/core/parsers/gemini/rpc/detailEvidence.js';
import { parseGeminiRpcConversation } from '../src/core/parsers/gemini/rpc/parseConversation.js';
import type { DomainMessage } from '../src/core/domain/conversationDetail.js';
import type { GeminiParserExtractorsModule } from '../src/core/parsers/gemini/rpc/extractors.js';
import type { ListParseDiagnostics } from '../src/core/parsers/gemini/rpc/parseList.js';
import type { Citation } from '../src/core/parsers/gemini/rpc/extractors.js';
import type { GeminiProtocolModule } from '../src/core/protocol/protocol.js';
import type { GeminiUtilsModule } from '../src/core/utils/utils.js';
import { parseList } from '../src/core/parsers/gemini/rpc/parseList.js';
import { decodeGeminiDetail } from '../src/core/parsers/gemini/rpc/detailDecoder.js';

// Compile-time regression: native evidence and application views preserve contracts rather
// than widening media/results/dependencies back to an unchecked escape.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type OutputContracts = [
    Assert<Equal<ListParseResult['_raw'], unknown>>,
    Assert<Equal<DetailParseResult['transport']['decodedPayload'], unknown>>,
    Assert<Equal<ListParseResult['_debug'], ListParseDiagnostics | undefined>>,
    Assert<Equal<DetailParseResult['conversation']['detail']['messages'][number], DomainMessage>>,
    Assert<Equal<ReturnType<GeminiParserExtractorsModule['getProtocol']>, GeminiProtocolModule>>,
    Assert<Equal<ReturnType<GeminiParserExtractorsModule['getUtils']>, GeminiUtilsModule>>,
    Assert<Equal<ReturnType<typeof parseList>, ListParseResult>>,
    Assert<Equal<ReturnType<typeof parseGeminiRpcConversation>, DetailParseResult>>,
    Assert<Equal<ReturnType<typeof decodeGeminiDetail>, GeminiDetailEvidence>>,
];
const contracts: OutputContracts = [true, true, true, true, true, true, true, true, true];
// The tuple already enforces these contracts at TypeScript compile time.
// A runtime .every(Boolean) assertion on literal true values cannot detect a parser bug.
void contracts;

test('malformed list and detail wire inputs fail closed without creating conversation evidence', () => {
    const previousWarn = console.warn;
    try {
        console.warn = () => {};
        const parsed = parseList('[]');
        assert.deepEqual(parsed.conversations, []);
        assert.equal(parsed.nextPageToken, null);
        assert.equal(parsed._debug?.error, 'NO_INNER_STR');
        assert.throws(
            () => parseGeminiRpcConversation('[]', { account: fixtureAccount('gemini'), providerId: 'gemini' }),
            /detail parse fail:/,
        );
    } finally {
        console.warn = previousWarn;
    }
});
