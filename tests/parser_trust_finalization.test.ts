import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacyStorageConversation } from '../src/core/parsers/legacyStorage/parseConversation.js';
import { validateParserDomain, restoreDomainSnapshot } from '../src/core/domain/runtimeValidation.js';

test('source identity semantics remain separate from nonempty storage identity', () => {
    const source = { index: { cloudAvailability: 'unknown' as const, hasTakeoutImport: false, titleSource: 'default' as const, providerId: 'future', id: '', title: '' }, detail: { completeness: 'unknown' as const, assets: [], messages: [] } };
    assert.throws(() => validateParserDomain(source), /index/);
    assert.throws(() => restoreDomainSnapshot(source), /index/);
});
test('legacy coverage corrections are included in the finalized Domain', () => {
    const result = parseLegacyStorageConversation({ metadata: { id: 'old', messageCount: 2 } }, { providerId: 'gemini' });
    assert.equal(result.conversation.detail.completeness, 'partial');
    assert.equal(result.diagnostics[0].code, 'LEGACY_BODY_NOT_STORED');
    const corrected = parseLegacyStorageConversation({ metadata: { id: 'old', messages: [{ role: 'user', content: 'Preserved' }] } },
        { providerId: 'gemini', completenessOverride: 'partial' });
    assert.deepEqual(corrected.conversation.detail.completeness, 'partial');
    assert.equal(corrected.conversation.detail.messages.length, 1);
});
