import { getCoverage } from '../src/l2/coverageAdmission.js';
import { withRegistry } from './helpers/registryMock.js';
import { listFixture } from './helpers/listFixture.js';
import { useIndexStorage } from './helpers/indexStorage.js';
useIndexStorage();
import { indexFixture } from './helpers/indexFixture.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

// 2. D2: Narrowed error detection
test('D2: BatchWorker does not delete conversation when error contains 11167 or other non-deletion numbers', async () => {
    const BatchWorker = require('../src/core/engine/export/batchWorker.js');
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/shared/utils/moduleOverrides.js');

    let removedId: string | null = null;
    const mockStorage = {
        removeConversation: async (_slot: string, id: string) => {
            removedId = id;
            return true;
        }
    };
    __setModuleOverride('StorageService', mockStorage);

    try {
        const logs: string[] = [];
        const chatWith11167 = {
            id: 'chat_safe_1',
            title: 'Safe Chat',
            messages: [],
            error: 'Server returned error code 11167',
            _empty: true
        };
        const reqItem = { id: 'chat_safe_1', title: 'Safe Chat' };

        const res = await BatchWorker.resolveChat(
            chatWith11167,
            reqItem,
            null,
            null,
            '10000000-0000-4000-8000-000000000001',
            () => {},
            (msg: string) => logs.push(msg)
        );

        assert.strictEqual(removedId, null, '11167 must NOT trigger removeConversation');
        assert.strictEqual(res.isConfirmedDeleted, false);
    } finally {
        __clearModuleOverrides();
    }
});

test('D2: BatchWorker confirms deletion but retains local metadata on BardErrorInfo: 1167 or 404', async () => {
    const BatchWorker = require('../src/core/engine/export/batchWorker.js');
    const { __setModuleOverride, __clearModuleOverrides } = require('../src/shared/utils/moduleOverrides.js');

    let removedId: string | null = null;
    const mockStorage = {
        removeConversation: async (_slot: string, id: string) => {
            removedId = id;
            return true;
        }
    };
    __setModuleOverride('StorageService', mockStorage);

    try {
        const logs: string[] = [];
        const deletedChat = {
            id: 'chat_del_1',
            title: 'Deleted Chat',
            messages: [],
            error: '会话已在服务端删除 (chat_del_1) [BardErrorInfo: 1167]',
            _empty: true
        };
        const reqItem = { id: 'chat_del_1', title: 'Deleted Chat' };

        const res = await BatchWorker.resolveChat(
            deletedChat,
            reqItem,
            null,
            null,
            '10000000-0000-4000-8000-000000000001',
            () => {},
            (msg: string) => logs.push(msg)
        );

        assert.strictEqual(removedId, null, 'Confirmed deletion must retain the local archive');
        assert.ok(logs.some(message => message.includes('retained')));
        assert.strictEqual(res.isConfirmedDeleted, true);
    } finally {
        __clearModuleOverrides();
    }
});

// Scan cleanup is account-scoped Coverage + ExportRecord deletion, without deleting Domain.
test('D4: clearStoredAccountScanRecords clears both scan ledgers and keeps local history', async () => {
    const { indexStorage } = require('./helpers/indexStorage.js');
    const storage = require('../src/l3a/storageService.js');
    const env = indexStorage();
    try {
        const key = { accountId: '10000000-0000-4000-8000-000000000001', conversationId: 'chat_1' };
        await storage.putIndexes([{ key }]);
        await storage.putExportRecord(key, { format: 'markdown', exportedAt: 0, status: 'ok' });
        await storage.updateCoverageAtomically(key.accountId, 'recent', () => ({ next: { range: null }, result: undefined }));
        await storage.clearStoredAccountScanRecords(key.accountId);
        assert.deepEqual(await storage.listExportRecords(key.accountId), {});
        assert.equal(await storage.getCoverage(key.accountId, 'recent'), null);
        assert.deepEqual(await storage.getIndex(key), { key });
    } finally { env.restore(); }
});

// 4. Page-world deletion notices must be verified by the active content tab, not trusted as deletion commands.
test('MessageBridge rejects malformed deletion IDs and verifies valid events in the active account', async () => {
    const MessageBridge = require('../src/l1/sniffer/gemini/messageBridge.js');
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    const sent: any[] = [];
    let removedCalled = false;
    try {
        (globalThis as any).chrome = {
            runtime: {
                sendMessage: async (message: unknown) => {
                    if ((message as any).action === 'accountRegistry') return { ok: true, value: { id: '10000000-0000-4000-8000-000000000001', providerId: 'gemini', providerAccountId: '10000000001' } };
                    sent.push(message);
                    return { data: { isDeleted: true } };
                }
            }
        };
        const api = MessageBridge.init({
            Storage: { removeConversation: async () => { removedCalled = true; return true; } },
            getAccountSlot: () => 'u0',
            upsertConversations: async () => {}
        });
        const event = (id: string, slot: string) => ({
            origin: typeof location === 'undefined' ? undefined : location.origin,
            source: typeof window === 'undefined' ? null : window,
            data: { type: 'GEMINI_CONVERSATION_DELETED', payload: { id, slot, requestAccountObservation: { providerId: 'gemini', providerAccountId: '10000000001' } } }
        });
        await api.handleWindowMessage(event('../../malicious/path', 'u0'));
        assert.deepStrictEqual(sent, [], 'malformed IDs cannot trigger a background fetch');
        await api.handleWindowMessage(event('c_12345678abcdef', 'u0'));
        assert.deepStrictEqual(sent, [{
            action: 'fetchChat',
            conversationId: 'c_12345678abcdef',
            accountId: '10000000-0000-4000-8000-000000000001'
        }], 'valid page events verify through the captured Registry account');
        assert.strictEqual(removedCalled, false, 'untrusted page-world deletion never removes the local archive');
    } finally {
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else delete (globalThis as any).chrome;
    }
});
