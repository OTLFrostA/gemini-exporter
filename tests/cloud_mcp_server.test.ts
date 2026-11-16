import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudServerHandler } from '../cloud-server/src/router.js';
import { createInMemoryVaultStore } from '../cloud-server/src/storage/vaultStore.js';
import { createCloudVaultClient } from '../src/l1/cloud/vaultClient.js';
import { createCloudSyncEngine } from '../src/application/cloud/cloudSyncEngine.js';
import { updateSettings } from '../src/application/settings/index.js';
import { ingestDetail } from '../src/l2/ingestion.js';
import { readConversation } from '../src/l2/readConversation.js';
import { getOrCreateAccount } from '../src/runtime/api/accountRegistry.js';
import { listAccounts } from '../src/l3a/storageService.js';
import { indexStorage } from './helpers/indexStorage.js';

const SECRET_MCP_PATH = '/mcp-9e4f1a2b3c8d7e6f0123456789abcdef';
const MCP_BEARER = 'mcp_priv_778899aabbccddeeff00112233445566';
const SERVER_ORIGIN = 'https://vault-mcp.example.test';

test('Private Zero-Exposure Cloudflare MCP Server: stealth 404 gating + bidirectional E2EE sync between Browser Extension and MCP AI clients', async () => {
    const env = indexStorage();
    try {
        await env.ready;
        const store = createInMemoryVaultStore();
        const handler = createCloudServerHandler({
            store,
            config: {
                sessionHmacSecret: 'mcp-test-session-hmac-secret-at-least-32-bytes!!',
                allowedOrigins: ['chrome-extension://*'],
                privateMcp: {
                    secretPath: SECRET_MCP_PATH,
                    bearerSecret: MCP_BEARER,
                },
            },
        });

        // 1. Stealth security audit: common guessed paths AND unauthenticated probes to SECRET_MCP_PATH all return plain 404!
        for (const probeUrl of [`${SERVER_ORIGIN}/mcp`, `${SERVER_ORIGIN}/.well-known/mcp`]) {
            const r = await handler(new Request(probeUrl, { method: 'POST', body: '{}' }));
            assert.equal(r.status, 404);
        }
        const wrongBearerProbe = await handler(new Request(`${SERVER_ORIGIN}${SECRET_MCP_PATH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer wrong_secret_guess',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        }));
        assert.equal(wrongBearerProbe.status, 404, 'Wrong bearer secret must return indistinguishable 404');
        assert.equal(await wrongBearerProbe.text(), 'Not Found');

        // 2. Browser Extension connects, enables full-body sync, and uploads multi-platform conversations (Gemini + ChatGPT)
        const engine = createCloudSyncEngine({
            client: createCloudVaultClient((url, init) => handler(new Request(url, init))),
        });
        const conn = await engine.connectCloudVault(SERVER_ORIGIN);
        await updateSettings({ cloudSyncIncludeDetail: true });
        await engine.setAutoSyncEnabled(true);

        const gemAcc = await getOrCreateAccount('gemini', 'gaia-mcp-1', 'user@gmail.com', 'User Gemini');
        const gptAcc = await getOrCreateAccount('chatgpt', 'oai-mcp-2', 'user@openai.example', 'User ChatGPT');
        await ingestDetail(gemAcc.id, 'gem_conv_arch', {
            savedAt: 1710000010000,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Design a relativistic consensus clock.' }] }] },
                {
                    role: 'assistant',
                    model: 'Gemini 2.5 Pro',
                    content: [
                        { type: 'paragraph', children: [{ type: 'text', text: 'Use Lamport logical timestamps bounded by drift epsilon.' }] },
                        { type: 'code', language: 'rust', code: 'fn tick(clock: u64) -> u64 { clock + 1 }' },
                    ],
                },
            ],
        }, { title: 'Relativistic Consensus Clock Design', titleSource: 'provider', updatedAt: 1710000010000 });

        await ingestDetail(gptAcc.id, 'gpt_conv_sql', {
            savedAt: 1710000020000,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Optimize SQLite WAL checkpointing.' }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'Set PRAGMA wal_autocheckpoint = 1000;' }] }] },
            ],
        }, { title: 'SQLite WAL Optimization', titleSource: 'provider', updatedAt: 1710000020000 });

        const synced = await engine.syncNow();
        assert.equal(synced.push.uploaded, 2);
        assert.equal(store.inspectRawBlobs().size, 2);

        // 3. Remote MCP Client connects using single composite Authorization header (`Bearer <SECRET>:<GEK1-...>`)
        const compositeAuth = `Bearer ${MCP_BEARER}:${conn.recoveryKey}`;
        const callMcpRpc = async (payload: unknown): Promise<{ status: number; json?: unknown }> => {
            const res = await handler(new Request(`${SERVER_ORIGIN}${SECRET_MCP_PATH}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: compositeAuth,
                },
                body: JSON.stringify(payload),
            }));
            if (res.status === 202) return { status: 202 };
            return { status: res.status, json: await res.json() };
        };

        // 3a. Handshake: initialize + notifications/initialized + tools/list
        const initRes = await callMcpRpc({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'claude-code', version: '1.0' } },
        });
        assert.equal(initRes.status, 200);

        const notifRes = await callMcpRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
        assert.equal(notifRes.status, 202);

        const toolsRes = await callMcpRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
        const toolsPayload = toolsRes.json as { result: { tools: Array<{ name: string }> } };
        assert.deepEqual(
            toolsPayload.result.tools.map(t => t.name),
            ['list_conversations', 'search_conversations', 'get_conversation', 'save_conversation'],
        );

        // 3b. list_conversations across platforms
        const listRes = await callMcpRpc({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: { name: 'list_conversations', arguments: {} },
        });
        const listText = ((listRes.json as { result: { content: Array<{ text: string }> } }).result.content[0])!.text;
        const listed = JSON.parse(listText) as { totalMatching: number; conversations: Array<{ conversationId: string; provider: string }> };
        assert.equal(listed.totalMatching, 2);
        assert.equal(listed.conversations[0]?.conversationId, 'gpt_conv_sql');
        assert.equal(listed.conversations[1]?.conversationId, 'gem_conv_arch');

        // 3c. search_conversations finds deep body keyword ("Lamport") inside encrypted Gemini conversation!
        const searchRes = await callMcpRpc({
            jsonrpc: '2.0',
            id: 4,
            method: 'tools/call',
            params: { name: 'search_conversations', arguments: { query: 'lamport' } },
        });
        const searchText = ((searchRes.json as { result: { content: Array<{ text: string }> } }).result.content[0])!.text;
        const searched = JSON.parse(searchText) as { returned: number; matches: Array<{ conversationId: string; snippet: string }> };
        assert.equal(searched.returned, 1);
        assert.equal(searched.matches[0]?.conversationId, 'gem_conv_arch');
        assert.ok(searched.matches[0]?.snippet.includes('Lamport'));

        // 3d. get_conversation renders clean Markdown including Rust code block
        const getRes = await callMcpRpc({
            jsonrpc: '2.0',
            id: 5,
            method: 'tools/call',
            params: { name: 'get_conversation', arguments: { conversationId: 'gem_conv_arch' } },
        });
        const mdTranscript = ((getRes.json as { result: { content: Array<{ text: string }> } }).result.content[0])!.text;
        assert.ok(mdTranscript.includes('# Relativistic Consensus Clock Design'));
        assert.ok(mdTranscript.includes('### Assistant (Gemini 2.5 Pro)'));
        assert.ok(mdTranscript.includes('```rust\nfn tick(clock: u64) -> u64 { clock + 1 }\n```'));

        // 4. Bidirectional write-back: AI model calls `save_conversation` via MCP -> encrypted as GEE1 in VaultStore -> Browser Extension pulls it!
        const saveRes1 = await callMcpRpc({
            jsonrpc: '2.0',
            id: 6,
            method: 'tools/call',
            params: {
                name: 'save_conversation',
                arguments: {
                    conversationId: 'claude_mcp_note_01',
                    provider: 'claude',
                    title: 'Architecture Follow-up From Claude MCP',
                    messages: [
                        { role: 'user', content: 'Summarize the clock + WAL integration.' },
                        { role: 'assistant', content: 'Persist monotonic ticks before WAL checkpoint.\n\n```sql\nSELECT max(seq) FROM events;\n```' },
                    ],
                },
            },
        });
        const savedMeta1 = JSON.parse(((saveRes1.json as { result: { content: Array<{ text: string }> } }).result.content[0])!.text) as {
            ok: boolean;
            revision: number;
        };
        assert.equal(savedMeta1.ok, true);
        assert.equal(savedMeta1.revision, 1);

        // Updating the same conversationId increments optimistic-concurrency revision to 2 cleanly
        const saveRes2 = await callMcpRpc({
            jsonrpc: '2.0',
            id: 7,
            method: 'tools/call',
            params: {
                name: 'save_conversation',
                arguments: {
                    conversationId: 'claude_mcp_note_01',
                    provider: 'claude',
                    title: 'Architecture Follow-up From Claude MCP (Updated)',
                    messages: [
                        { role: 'user', content: 'Summarize the clock + WAL integration.' },
                        { role: 'assistant', content: 'Updated conclusion with zero plaintext stored at rest.' },
                    ],
                },
            },
        });
        const savedMeta2 = JSON.parse(((saveRes2.json as { result: { content: Array<{ text: string }> } }).result.content[0])!.text) as {
            revision: number;
        };
        assert.equal(savedMeta2.revision, 2);

        // Audit raw server storage: still 100% GEE1 ciphertexts, ZERO plaintext leaked!
        for (const rawBytes of store.inspectRawBlobs().values()) {
            assert.deepEqual([...rawBytes.subarray(0, 4)], [0x47, 0x45, 0x45, 0x31]);
            const rawStr = new TextDecoder('latin1').decode(rawBytes);
            assert.ok(!rawStr.includes('Updated conclusion'));
            assert.ok(!rawStr.includes('Claude MCP'));
        }

        // Browser Extension pulls the MCP-saved conversation into local IndexedDB seamlessly!
        const extPull = await engine.pullChanges();
        assert.equal(extPull.accepted, 1);
        const claudeAcc = (await listAccounts()).find(a => a.providerId === 'claude' && a.providerAccountId === 'mcp-claude-memory');
        assert.ok(claudeAcc, 'Extension automatically created/mapped the MCP Claude account');
        const restoredConv = await readConversation({ accountId: claudeAcc.id, conversationId: 'claude_mcp_note_01' });
        assert.ok(restoredConv);
        assert.equal(restoredConv.index.title, 'Architecture Follow-up From Claude MCP (Updated)');
        assert.equal(restoredConv.detail?.messages.length, 2);
    } finally {
        env.restore();
    }
});
