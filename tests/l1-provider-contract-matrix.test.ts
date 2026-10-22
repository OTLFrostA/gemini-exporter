import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { CommittedListPage } from '../src/l1/client/aiProvider.js';
import { ports } from './helpers/l1V2UnitMocks.js';
import { geminiContractAdapter } from './helpers/providerContract/gemini.js';
import { chatgptContractAdapter } from './helpers/providerContract/chatgpt.js';

/**
 * The SAME public-contract assertions must pass for every registered fixture.
 * Add providers by supplying their native-source adapter; do not branch on
 * provider identity or mock the AIProvider itself in this matrix.
 */
const adapters = [geminiContractAdapter, chatgptContractAdapter] as const;
beforeEach(() => ports.reset());

for (const fixture of adapters) {
    test(`${fixture.id}: trustworthy List commits evidence before progress and reaches source_end`, async () => {
        const progress: CommittedListPage[] = [];
        const provider = fixture.createProvider();
        const result = await provider.listConversations({
            accountId: fixture.account.id, streamId: 'recent',
            onPageCommitted: async info => {
                assert.equal(ports.indexes.length, 1, 'L2 must commit before progress');
                progress.push(info);
                return false;
            },
        });
        assert.equal(provider.id, fixture.id);
        assert.equal(result, 'source_end');
        assert.deepEqual(ports.indexes.map(call => call.accountId), [fixture.account.id]);
        assert.deepEqual(ports.indexes[0]?.items.map(row => row.conversationId), [fixture.conversationId]);
        assert.equal(ports.indexes[0]?.page?.valid, true);
        assert.equal(ports.indexes[0]?.page?.ordered, true);
        assert.equal(progress.length, 1);
        assert.equal(progress[0]?.page, 1);
        assert.equal(progress[0]?.totalObserved, 1);
        assert.equal(progress[0]?.scanHead?.requestCursor, null);
        assert.equal(progress[0]?.scanHead?.valid, true);
        assert.equal('items' in progress[0], false, 'callbacks must not leak native source items');
    });

    test(`${fixture.id}: untrustworthy native List never claims completion`, async () => {
        const provider = fixture.createProvider({ invalidList: true });
        await assert.rejects(
            provider.listConversations({ accountId: fixture.account.id, streamId: 'recent' }),
            /Unverified .* list page/,
        );
        assert.equal(ports.indexes.length, 1, 'decoded rows may still be admitted');
        assert.equal(ports.indexes[0]?.page?.valid, false, 'untrusted Coverage must remain untrusted');
    });

    test(`${fixture.id}: failed Index admission cannot publish committed progress`, async () => {
        ports.indexError = new Error('injected Index failure');
        let callbacks = 0;
        const provider = fixture.createProvider();
        await assert.rejects(provider.listConversations({
            accountId: fixture.account.id, streamId: 'recent',
            onPageCommitted: async () => { callbacks++; return false; },
        }), /injected Index failure/);
        assert.equal(callbacks, 0);
        assert.equal(ports.indexes.length, 0);
    });

    test(`${fixture.id}: Detail commits only to the requested Account and Conversation`, async () => {
        const provider = fixture.createProvider();
        await provider.fetchConversationDetail(fixture.account.id, fixture.conversationId);
        assert.equal(ports.details.length, 1);
        assert.equal(ports.details[0]?.accountId, fixture.account.id);
        assert.equal(ports.details[0]?.conversationId, fixture.conversationId);
        assert.ok(ports.details[0]?.detail.messages.length, 'source Detail must be genuinely parsed');
        assert.equal(ports.details[0]?.indexFields?.titleSource, 'provider');
    });

    test(`${fixture.id}: failed Detail admission propagates without a committed Detail`, async () => {
        ports.detailError = new Error('injected Detail failure');
        const provider = fixture.createProvider();
        await assert.rejects(
            provider.fetchConversationDetail(fixture.account.id, fixture.conversationId),
            /injected Detail failure/,
        );
        assert.equal(ports.details.length, 0);
    });

    test(`${fixture.id}: foreign Provider Account is rejected before source access`, async () => {
        let requests = 0;
        const provider = fixture.createProvider({ onSourceRequest: () => { requests++; } });
        await assert.rejects(
            provider.listConversations({ accountId: fixture.foreignAccount.id, streamId: 'recent' }),
            /Provider account mismatch/,
        );
        await assert.rejects(
            provider.fetchConversationDetail(fixture.foreignAccount.id, fixture.conversationId),
            /Provider account mismatch/,
        );
        assert.equal(requests, 0);
        assert.equal(ports.indexes.length, 0);
        assert.equal(ports.details.length, 0);
    });

    test(`${fixture.id}: pre-aborted List and Detail perform no source IO or admission`, async () => {
        let requests = 0;
        const provider = fixture.createProvider({ onSourceRequest: () => { requests++; } });
        const controller = new AbortController();
        controller.abort(new Error('contract cancellation'));
        await assert.rejects(provider.listConversations({
            accountId: fixture.account.id, streamId: 'recent', signal: controller.signal,
        }), /contract cancellation/);
        await assert.rejects(
            provider.fetchConversationDetail(fixture.account.id, fixture.conversationId, controller.signal),
            /contract cancellation/,
        );
        assert.equal(requests, 0);
        assert.equal(ports.indexes.length, 0);
        assert.equal(ports.details.length, 0);
    });
}
