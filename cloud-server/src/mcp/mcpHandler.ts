import {
    decodePortableCloudConversation,
    type PortableCloudConversation,
} from '../../../src/l2/cloudPayload.js';
import {
    deriveBlindRecordId,
    deriveVaultKeyring,
    openUtf8Record,
    parseRecoveryKey,
    sealUtf8Record,
    type VaultKeyring,
} from '../../../src/shared/crypto/index.js';
import { CLOUD_DEFAULT_USER_QUOTA_BYTES, type CloudRecordMeta } from '../../../src/shared/types/cloudSync.js';
import { sha256Hex, type VaultStore } from '../storage/vaultStore.js';
import {
    buildValidatedPortableConversationJson,
    extractSearchableText,
    renderPortableConversationMarkdown,
    type McpInputMessage,
} from './mcpFormatter.js';

export interface PrivateMcpConfig {
    /** Unlisted high-entropy path, e.g. `/mcp-8f3c...`. Must start with `/`. */
    readonly secretPath: string;
    /** High-entropy bearer secret required on every MCP call. */
    readonly bearerSecret: string;
    readonly defaultQuotaBytes?: number;
    readonly now?: () => number;
}

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
    readonly jsonrpc: '2.0';
    readonly id?: JsonRpcId;
    readonly method: string;
    readonly params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    readonly jsonrpc: '2.0';
    readonly id: JsonRpcId;
    readonly result?: unknown;
    readonly error?: {
        readonly code: number;
        readonly message: string;
    };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stealthNotFound(): Response {
    return new Response('Not Found', {
        status: 404,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

function mcpCorsHeaders(requestOrigin: string | null): Record<string, string> {
    return {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(requestOrigin ? {
            'Access-Control-Allow-Origin': requestOrigin,
            'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Vault-Recovery-Key, Mcp-Session-Id, MCP-Protocol-Version',
            'Access-Control-Expose-Headers': 'Mcp-Session-Id',
            'Access-Control-Max-Age': '86400',
        } : {}),
    };
}

async function constantTimeSecretMatch(expected: string, actual: string): Promise<boolean> {
    const enc = new TextEncoder();
    const [left, right] = await Promise.all([
        sha256Hex(new Uint8Array(enc.encode(expected))),
        sha256Hex(new Uint8Array(enc.encode(actual))),
    ]);
    let diff = expected.length ^ actual.length;
    for (let i = 0; i < left.length; i++) {
        diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
    }
    return diff === 0;
}

/**
 * Parse credentials from either:
 *  - Single composite header: `Authorization: Bearer <MCP_BEARER_SECRET>:<GEK1-...>`
 *  - Split headers: `Authorization: Bearer <MCP_BEARER_SECRET>` + `X-Vault-Recovery-Key: <GEK1-...>`
 */
function extractMcpCredentials(request: Request): { bearer: string; recoveryKey: string } | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const rawBearer = authHeader.slice('Bearer '.length).trim();
    if (!rawBearer) return null;

    const explicitKeyHeader = request.headers.get('X-Vault-Recovery-Key')?.trim() ?? '';
    const colonIdx = rawBearer.indexOf(':');
    if (colonIdx > 0) {
        return {
            bearer: rawBearer.slice(0, colonIdx).trim(),
            recoveryKey: explicitKeyHeader || rawBearer.slice(colonIdx + 1).trim(),
        };
    }
    return {
        bearer: rawBearer,
        recoveryKey: explicitKeyHeader,
    };
}

const MCP_TOOLS_MANIFEST = [
    {
        name: 'list_conversations',
        description:
            'List conversations in the personal zero-knowledge E2EE chat vault across AI platforms (gemini, chatgpt, claude, grok), ordered from newest to oldest.',
        inputSchema: {
            type: 'object',
            properties: {
                provider: {
                    type: 'string',
                    description: 'Optional platform filter, e.g. "gemini", "chatgpt", "claude", "grok", or "mcp".',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of conversations to return (1..100, default 30).',
                },
            },
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
        },
    },
    {
        name: 'search_conversations',
        description:
            'Full-text keyword search across conversation titles and decrypted message bodies across all synced AI platforms.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'Case-insensitive keyword or phrase to search for.',
                },
                provider: {
                    type: 'string',
                    description: 'Optional platform filter, e.g. "gemini", "chatgpt", "claude", "grok".',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum matching conversations to return (1..50, default 15).',
                },
            },
            required: ['query'],
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
        },
    },
    {
        name: 'get_conversation',
        description:
            'Read the full decrypted Markdown transcript of a specific conversation by conversationId.',
        inputSchema: {
            type: 'object',
            properties: {
                conversationId: {
                    type: 'string',
                    description: 'Exact conversationId returned by list_conversations or search_conversations.',
                },
                provider: {
                    type: 'string',
                    description: 'Optional platform disambiguator if two platforms share the same conversationId.',
                },
            },
            required: ['conversationId'],
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            openWorldHint: false,
        },
    },
    {
        name: 'save_conversation',
        description:
            'Encrypt and save (or update) a conversation note/transcript into the personal E2EE chat vault so other AI models and the browser extension can read and export it.',
        inputSchema: {
            type: 'object',
            properties: {
                title: {
                    type: 'string',
                    description: 'Concise descriptive title of the conversation.',
                },
                messages: {
                    type: 'array',
                    description: 'Ordered conversation turns to store.',
                    items: {
                        type: 'object',
                        properties: {
                            role: { type: 'string', enum: ['user', 'assistant', 'system'] },
                            content: { type: 'string', description: 'Markdown message text.' },
                        },
                        required: ['role', 'content'],
                        additionalProperties: false,
                    },
                },
                provider: {
                    type: 'string',
                    description: 'Source platform identifier (defaults to "claude"; allowed: "gemini", "chatgpt", "claude", "grok").',
                },
                accountName: {
                    type: 'string',
                    description: 'Optional logical account label (defaults to "MCP Shared Memory").',
                },
                conversationId: {
                    type: 'string',
                    description: 'Optional stable conversationId to create or update in place.',
                },
            },
            required: ['title', 'messages'],
            additionalProperties: false,
        },
        annotations: {
            readOnlyHint: false,
            destructiveHint: false,
            openWorldHint: false,
        },
    },
] as const;

async function ensureVaultTenantReady(
    store: VaultStore,
    keyring: VaultKeyring,
    defaultQuotaBytes: number,
    nowMs: number,
): Promise<string> {
    const ownerSubject = `vault:${keyring.keyFingerprint}`;
    const verifierHash = await sha256Hex(
        new Uint8Array(new TextEncoder().encode(`ge-auth-v1:${ownerSubject}:${keyring.authToken}`)),
    );
    const user = await store.authenticateKeyTenant({
        ownerSubject,
        keyFingerprint: keyring.keyFingerprint,
        authVerifierHash: verifierHash,
        defaultQuotaBytes,
        nowMs,
    });
    if (!user) {
        throw new Error('Vault tenant authentication verifier mismatch');
    }
    return ownerSubject;
}

async function loadAllDecryptedConversations(
    store: VaultStore,
    ownerSubject: string,
    keyring: VaultKeyring,
): Promise<Array<{ meta: CloudRecordMeta; conv: PortableCloudConversation }>> {
    const allMeta: CloudRecordMeta[] = [];
    let cursor = 0;
    for (let page = 0; page < 100; page++) {
        const feed = await store.listChanges(ownerSubject, cursor, 200);
        if (feed.items.length === 0) break;
        allMeta.push(...feed.items);
        cursor = feed.nextSince;
        if (!feed.hasMore) break;
    }

    const results: Array<{ meta: CloudRecordMeta; conv: PortableCloudConversation }> = [];
    for (const meta of allMeta) {
        const stored = await store.getRecord(ownerSubject, meta.blindRecordId);
        if (!stored) continue;
        const jsonText = await openUtf8Record(
            keyring,
            stored.ciphertext,
            { ownerSubject, blindRecordId: meta.blindRecordId, revision: stored.meta.revision },
        );
        const conv = decodePortableCloudConversation(jsonText);
        const expectedBlind = await deriveBlindRecordId(
            keyring,
            conv.account.providerId,
            conv.account.providerAccountId,
            conv.conversationId,
        );
        if (expectedBlind !== meta.blindRecordId) continue;
        results.push({ meta: stored.meta, conv });
    }

    results.sort((a, b) => {
        const ta = a.conv.index.updatedAt ?? a.conv.index.activityAt ?? a.conv.index.createdAt ?? a.meta.updatedAt;
        const tb = b.conv.index.updatedAt ?? b.conv.index.activityAt ?? b.conv.index.createdAt ?? b.meta.updatedAt;
        return tb - ta;
    });
    return results;
}

function buildSnippet(fullText: string, needleLower: string): string {
    const lower = fullText.toLowerCase();
    const pos = lower.indexOf(needleLower);
    if (pos < 0) return fullText.slice(0, 180).replace(/\s+/g, ' ').trim();
    const start = Math.max(0, pos - 70);
    const end = Math.min(fullText.length, pos + needleLower.length + 110);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < fullText.length ? '...' : '';
    return `${prefix}${fullText.slice(start, end).replace(/\s+/g, ' ').trim()}${suffix}`;
}

function parseInputMessages(raw: unknown): McpInputMessage[] | null {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) return null;
    const out: McpInputMessage[] = [];
    for (const item of raw) {
        if (!isPlainRecord(item)) return null;
        const role = item.role;
        const content = item.content;
        if ((role !== 'user' && role !== 'assistant' && role !== 'system') || typeof content !== 'string') {
            return null;
        }
        out.push({ role, content });
    }
    return out;
}

async function executeMcpToolCall(options: {
    readonly store: VaultStore;
    readonly keyring: VaultKeyring;
    readonly defaultQuotaBytes: number;
    readonly nowMs: number;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
}): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
    const ownerSubject = await ensureVaultTenantReady(
        options.store,
        options.keyring,
        options.defaultQuotaBytes,
        options.nowMs,
    );

    if (options.toolName === 'list_conversations') {
        const providerFilter = typeof options.args.provider === 'string' && options.args.provider.trim()
            ? options.args.provider.trim().toLowerCase()
            : null;
        const rawLimit = typeof options.args.limit === 'number' && Number.isFinite(options.args.limit)
            ? Math.trunc(options.args.limit)
            : 30;
        const limit = Math.max(1, Math.min(100, rawLimit));

        const items = await loadAllDecryptedConversations(options.store, ownerSubject, options.keyring);
        const filtered = providerFilter
            ? items.filter(x => x.conv.account.providerId.toLowerCase() === providerFilter)
            : items;
        const slice = filtered.slice(0, limit);

        const summary = slice.map(x => ({
            conversationId: x.conv.conversationId,
            title: x.conv.index.title || '(Untitled)',
            provider: x.conv.account.providerId,
            account: x.conv.account.email ?? x.conv.account.displayName ?? x.conv.account.providerAccountId,
            updatedAt: x.conv.index.updatedAt
                ? new Date(x.conv.index.updatedAt).toISOString()
                : new Date(x.meta.updatedAt).toISOString(),
            hasFullBody: Boolean(x.conv.detail),
            messageCount: x.conv.detail ? x.conv.detail.messages.length : 0,
        }));
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ totalMatching: filtered.length, returned: summary.length, conversations: summary }, null, 2),
            }],
        };
    }

    if (options.toolName === 'search_conversations') {
        const query = typeof options.args.query === 'string' ? options.args.query.trim() : '';
        if (!query) {
            return { content: [{ type: 'text', text: 'Parameter "query" must be a non-empty string.' }], isError: true };
        }
        const providerFilter = typeof options.args.provider === 'string' && options.args.provider.trim()
            ? options.args.provider.trim().toLowerCase()
            : null;
        const rawLimit = typeof options.args.limit === 'number' && Number.isFinite(options.args.limit)
            ? Math.trunc(options.args.limit)
            : 15;
        const limit = Math.max(1, Math.min(50, rawLimit));
        const needle = query.toLowerCase();

        const items = await loadAllDecryptedConversations(options.store, ownerSubject, options.keyring);
        const hits = [];
        for (const item of items) {
            if (providerFilter && item.conv.account.providerId.toLowerCase() !== providerFilter) continue;
            const searchable = extractSearchableText(item.conv);
            if (!searchable.toLowerCase().includes(needle)) continue;
            hits.push({
                conversationId: item.conv.conversationId,
                title: item.conv.index.title || '(Untitled)',
                provider: item.conv.account.providerId,
                account: item.conv.account.email ?? item.conv.account.displayName ?? item.conv.account.providerAccountId,
                hasFullBody: Boolean(item.conv.detail),
                snippet: buildSnippet(searchable, needle),
            });
            if (hits.length >= limit) break;
        }
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ query, returned: hits.length, matches: hits }, null, 2),
            }],
        };
    }

    if (options.toolName === 'get_conversation') {
        const convId = typeof options.args.conversationId === 'string' ? options.args.conversationId.trim() : '';
        if (!convId) {
            return { content: [{ type: 'text', text: 'Parameter "conversationId" is required.' }], isError: true };
        }
        const providerFilter = typeof options.args.provider === 'string' && options.args.provider.trim()
            ? options.args.provider.trim().toLowerCase()
            : null;

        const items = await loadAllDecryptedConversations(options.store, ownerSubject, options.keyring);
        const found = items.find(x =>
            x.conv.conversationId === convId
            && (!providerFilter || x.conv.account.providerId.toLowerCase() === providerFilter),
        );
        if (!found) {
            return {
                content: [{ type: 'text', text: `Conversation "${convId}" was not found in this vault.` }],
                isError: true,
            };
        }
        return {
            content: [{
                type: 'text',
                text: renderPortableConversationMarkdown(found.conv),
            }],
        };
    }

    if (options.toolName === 'save_conversation') {
        const title = typeof options.args.title === 'string' ? options.args.title.trim() : '';
        if (!title) {
            return { content: [{ type: 'text', text: 'Parameter "title" must be a non-empty string.' }], isError: true };
        }
        const messages = parseInputMessages(options.args.messages);
        if (!messages) {
            return {
                content: [{ type: 'text', text: 'Parameter "messages" must be a non-empty array of { role, content } turns.' }],
                isError: true,
            };
        }
        const rawProvider = typeof options.args.provider === 'string' && options.args.provider.trim()
            ? options.args.provider.trim().toLowerCase()
            : 'claude';
        const allowedProviders = new Set(['gemini', 'chatgpt', 'claude', 'grok']);
        const providerId = allowedProviders.has(rawProvider) ? rawProvider : 'claude';
        const accountName = typeof options.args.accountName === 'string' && options.args.accountName.trim()
            ? options.args.accountName.trim()
            : 'MCP Shared Memory';
        const providerAccountId = `mcp-${providerId}-memory`;
        const conversationId = typeof options.args.conversationId === 'string' && options.args.conversationId.trim()
            ? options.args.conversationId.trim()
            : `mcp_${options.nowMs.toString(36)}_${crypto.randomUUID().slice(0, 8)}`;

        const blindRecordId = await deriveBlindRecordId(
            options.keyring,
            providerId,
            providerAccountId,
            conversationId,
        );
        const existing = await options.store.getRecord(ownerSubject, blindRecordId);
        const expectedRevision = existing ? existing.meta.revision : 0;
        const nextRevision = expectedRevision + 1;

        const portableJson = buildValidatedPortableConversationJson({
            providerId,
            providerAccountId,
            displayName: accountName,
            conversationId,
            title,
            messages,
            nowMs: options.nowMs,
        });
        const envelope = await sealUtf8Record(
            options.keyring,
            portableJson,
            { ownerSubject, blindRecordId, revision: nextRevision },
        );
        const sha256 = await sha256Hex(envelope);
        const putOutcome = await options.store.putRecord({
            ownerSubject,
            blindRecordId,
            expectedRevision,
            ciphertext: envelope,
            sha256,
            keyFingerprint: options.keyring.keyFingerprint,
            nowMs: options.nowMs,
        });
        if (putOutcome.status !== 'committed') {
            return {
                content: [{ type: 'text', text: `Failed to commit encrypted conversation: ${putOutcome.status}` }],
                isError: true,
            };
        }
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    ok: true,
                    conversationId,
                    provider: providerId,
                    account: accountName,
                    revision: putOutcome.meta.revision,
                    encryptedBytes: putOutcome.meta.byteLength,
                }, null, 2),
            }],
        };
    }

    return {
        content: [{ type: 'text', text: `Unknown MCP tool: ${options.toolName}` }],
        isError: true,
    };
}

function parseJsonRpcRequest(raw: unknown): JsonRpcRequest | null {
    if (!isPlainRecord(raw) || raw.jsonrpc !== '2.0' || typeof raw.method !== 'string') {
        return null;
    }
    const idRaw = raw.id;
    const id: JsonRpcId | undefined = idRaw === undefined
        ? undefined
        : (typeof idRaw === 'string' || typeof idRaw === 'number' || idRaw === null ? idRaw : null);
    const params = isPlainRecord(raw.params) ? raw.params : undefined;
    return {
        jsonrpc: '2.0',
        ...(id !== undefined ? { id } : {}),
        method: raw.method,
        ...(params ? { params } : {}),
    };
}

async function handleSingleRpcMessage(
    msg: JsonRpcRequest,
    store: VaultStore,
    keyring: VaultKeyring,
    defaultQuotaBytes: number,
    nowMs: number,
): Promise<JsonRpcResponse | null> {
    // Notifications carry no `id` and expect no response object in Streamable HTTP
    if (msg.id === undefined) {
        return null;
    }

    if (msg.method === 'initialize') {
        const clientProto = typeof msg.params?.protocolVersion === 'string'
            ? msg.params.protocolVersion
            : '2025-03-26';
        const negotiated = clientProto === '2024-11-05' ? '2024-11-05' : '2025-03-26';
        return {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
                protocolVersion: negotiated,
                capabilities: {
                    tools: { listChanged: false },
                },
                serverInfo: {
                    name: 'personal-e2ee-chat-vault',
                    version: '1.0.0',
                },
            },
        };
    }

    if (msg.method === 'ping') {
        return { jsonrpc: '2.0', id: msg.id, result: {} };
    }

    if (msg.method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: MCP_TOOLS_MANIFEST },
        };
    }

    if (msg.method === 'tools/call') {
        const name = typeof msg.params?.name === 'string' ? msg.params.name : '';
        const args = isPlainRecord(msg.params?.arguments) ? msg.params.arguments : {};
        if (!name) {
            return {
                jsonrpc: '2.0',
                id: msg.id,
                error: { code: -32602, message: 'Missing tool "name" in tools/call params' },
            };
        }
        try {
            const callResult = await executeMcpToolCall({
                store,
                keyring,
                defaultQuotaBytes,
                nowMs,
                toolName: name,
                args,
            });
            return { jsonrpc: '2.0', id: msg.id, result: callResult };
        } catch (err) {
            return {
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                    content: [{
                        type: 'text',
                        text: `Vault tool error: ${err instanceof Error ? err.message : 'Unknown error'}`,
                    }],
                    isError: true,
                },
            };
        }
    }

    return {
        jsonrpc: '2.0',
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
    };
}

/**
 * Zero-exposure Streamable HTTP MCP endpoint handler.
 * Returns `null` when disabled or when `url.pathname` does not match `config.secretPath` so the outer
 * router responds with an ordinary indistinguishable 404.
 */
export async function maybeHandlePrivateMcpRequest(
    request: Request,
    url: URL,
    store: VaultStore,
    config: PrivateMcpConfig | undefined,
): Promise<Response | null> {
    const secretPath = config?.secretPath?.trim();
    const bearerSecret = config?.bearerSecret?.trim();
    if (!secretPath || !bearerSecret || url.pathname !== secretPath) {
        return null;
    }

    const requestOrigin = request.headers.get('Origin');
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: mcpCorsHeaders(requestOrigin) });
    }

    const creds = extractMcpCredentials(request);
    if (!creds || !(await constantTimeSecretMatch(bearerSecret, creds.bearer))) {
        // Stealth mode: unauthenticated probes receive an indistinguishable plain 404
        return stealthNotFound();
    }

    if (request.method === 'DELETE') {
        return new Response(null, { status: 204, headers: mcpCorsHeaders(requestOrigin) });
    }
    if (request.method === 'GET') {
        // Per MCP 2025-03-26 Streamable HTTP spec: 405 signals stateless POST-only JSON-RPC operation
        return new Response('Method Not Allowed', {
            status: 405,
            headers: { Allow: 'POST, DELETE, OPTIONS', ...mcpCorsHeaders(requestOrigin) },
        });
    }
    if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: mcpCorsHeaders(requestOrigin) });
    }

    if (!creds.recoveryKey) {
        return Response.json(
            {
                jsonrpc: '2.0',
                id: null,
                error: {
                    code: -32001,
                    message: 'Missing GEK1 Master Recovery Key (pass via Bearer <SECRET>:<GEK1-...> or X-Vault-Recovery-Key header)',
                },
            },
            { status: 400, headers: mcpCorsHeaders(requestOrigin) },
        );
    }

    let keyring: VaultKeyring;
    try {
        const rawBytes = await parseRecoveryKey(creds.recoveryKey);
        try {
            keyring = await deriveVaultKeyring(rawBytes);
        } finally {
            rawBytes.fill(0);
        }
    } catch {
        return Response.json(
            {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32001, message: 'Invalid GEK1 Master Recovery Key checksum or format' },
            },
            { status: 400, headers: mcpCorsHeaders(requestOrigin) },
        );
    }

    let rawJson: unknown;
    try {
        rawJson = await request.json();
    } catch {
        return Response.json(
            { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
            { status: 400, headers: mcpCorsHeaders(requestOrigin) },
        );
    }

    const nowMs = (config?.now ?? Date.now)();
    const quotaBytes = config?.defaultQuotaBytes ?? CLOUD_DEFAULT_USER_QUOTA_BYTES;

    if (Array.isArray(rawJson)) {
        if (rawJson.length === 0) {
            return Response.json(
                { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid empty batch' } },
                { status: 400, headers: mcpCorsHeaders(requestOrigin) },
            );
        }
        const responses: JsonRpcResponse[] = [];
        for (const entry of rawJson) {
            const parsed = parseJsonRpcRequest(entry);
            if (!parsed) {
                responses.push({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
                continue;
            }
            const res = await handleSingleRpcMessage(parsed, store, keyring, quotaBytes, nowMs);
            if (res) responses.push(res);
        }
        if (responses.length === 0) {
            return new Response(null, { status: 202, headers: mcpCorsHeaders(requestOrigin) });
        }
        return Response.json(responses, { status: 200, headers: mcpCorsHeaders(requestOrigin) });
    }

    const single = parseJsonRpcRequest(rawJson);
    if (!single) {
        return Response.json(
            { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } },
            { status: 400, headers: mcpCorsHeaders(requestOrigin) },
        );
    }
    const reply = await handleSingleRpcMessage(single, store, keyring, quotaBytes, nowMs);
    if (!reply) {
        return new Response(null, { status: 202, headers: mcpCorsHeaders(requestOrigin) });
    }
    return Response.json(reply, { status: 200, headers: mcpCorsHeaders(requestOrigin) });
}
