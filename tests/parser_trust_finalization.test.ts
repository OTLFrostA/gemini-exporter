import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyStorageConversation } from '../src/core/parsers/legacyStorage/parseConversation.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';

test('source identity semantics remain separate from nonempty storage identity', () => {
    const source = { providerId: 'future', id: '', title: '', completeness: 'unknown' as const, assets: [], messages: [] };
    assert.equal(validateParserDomain(source), source);
    assert.throws(() => restoreDomainSnapshot(source), /Empty stored conversation identity/);
});
test('legacy coverage corrections are included in the finalized Domain', () => {
    const result = parseLegacyStorageConversation({ metadata: { id: 'old', messageCount: 2 } }, { providerId: 'gemini' });
    assert.equal(result.conversation.completeness, 'partial');
    assert.equal(result.diagnostics[0].code, 'LEGACY_BODY_NOT_STORED');
    const corrected = parseLegacyStorageConversation({ metadata: { id: 'old', messages: [{ role: 'user', content: 'Preserved' }] } },
        { providerId: 'gemini', completenessOverride: 'partial' });
    assert.deepEqual(corrected.conversation.completeness, 'partial');
    assert.equal(corrected.conversation.messages.length, 1);
});
