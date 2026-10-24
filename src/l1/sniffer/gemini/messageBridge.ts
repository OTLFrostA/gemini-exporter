import { parseConfirmedGeminiDeletion } from '../../parsers/gemini/rpc/parseDeletion.js';
import type { ConversationKey } from '../../../l2/conversationKey.js';
import type { SourceResourceContext } from '../../resources/sourceResources.js';
import { getAccount } from '../../../runtime/api/accountRegistry.js';
import { geminiListObservation } from '../../client/gemini/listObservation.js';
import { resolveRequestAccount, resolveCurrentAccount } from '../../../runtime/content/accountContext.js';
import { ingestIndexes, ingestDetail, ingestDeletedConversation } from '../../../runtime/api/domainIngestion.js';
import { parseGeminiRpcConversation } from '../../parsers/gemini/rpc/parseConversation.js';
import { mergeConversationPages } from '../../parsers/gemini/rpc/mergePages.js';
import type { GeminiRpcParseResult } from '../../parsers/gemini/rpc/parseConversation.js';
import { parseGeminiIndexObservation } from '../../parsers/gemini/parseIndexObservation.js';
import { parseGeminiDomIndex } from '../../parsers/gemini/dom/parseIndex.js';
import { isDevMode } from '../../../runtime/devMode.js';
import { parseList } from '../../parsers/gemini/rpc/parseList.js';
import { GeminiProtocol, CrossWorldEvents } from '../../protocol/gemini/protocol.js';
import { extractConversationIdFromUrl, normId } from '../../../shared/utils/pathUtils.js';
import { registerCleanup } from '../../../runtime/content/cleanupRegistry.js';

export interface MessageBridgeDeps {
    resources?: SourceResourceContext;
    onIndexesCommitted?: (accountId: string) => void;
    onStreamStart?: (cid?: string | null, slot?: string) => void;
    onStreamComplete?: (key: ConversationKey, slot?: string) => void;
    onDetailChanged?: (key: ConversationKey) => void;
    onConversationDeleted?: (cid: string, accountId: string) => void;
}
let deps: MessageBridgeDeps | null = null;
let listening = false;
// A commit barrier for already received captures, not a second task executor.
const pendingAdmissions = new Set<Promise<void>>();
// Only source pages from this short-lived capture chain; never read old Domain to fill gaps.
const chains = new Map<string, { pages: GeminiRpcParseResult[]; next: string; requestedAt: number }>();
export function init(dependencies: MessageBridgeDeps = {}) {
    deps = dependencies;
    if (typeof window !== 'undefined' && !listening) {
        window.addEventListener('message', receiveWindowMessage);
        listening = true;
        registerCleanup(() => { window.removeEventListener('message', receiveWindowMessage); listening = false; deps = null; chains.clear(); pendingAdmissions.clear(); });
    }
    return { handleWindowMessage };
}
function receiveWindowMessage(event: MessageEvent): void { void handleWindowMessage(event).catch(() => {}); }
export function handleWindowMessage(event: MessageEvent): Promise<void> {
    const earlier = [...pendingAdmissions];
    const operation = processWindowMessage(event, earlier);
    const raw: unknown = event?.data;
    if (typeof window !== 'undefined' && typeof location !== 'undefined' && event?.source === window
        && event.origin === location.origin && raw && typeof raw === 'object' && 'type' in raw
        && raw.type === CrossWorldEvents.NETWORK_BATCHEXECUTE) {
        pendingAdmissions.add(operation);
        void operation.finally(() => pendingAdmissions.delete(operation)).catch(() => {});
    }
    return operation;
}
async function processWindowMessage(event: MessageEvent, earlier: readonly Promise<void>[]): Promise<void> {
    const capturedDeps = deps;
    if (!capturedDeps || !event || (typeof location !== 'undefined' && event.origin !== location.origin)) return;
    if (typeof window === 'undefined' || event.source !== window) return;
    const raw: unknown = event.data;
    if (!raw || typeof raw !== 'object' || !('type' in raw) || !('payload' in raw)) return;
    const payload = raw.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
    const field = (name: string): unknown => Reflect.get(payload, name);
    const slot = field('slot');
    if (typeof slot !== 'string' || !/^u\d+$/.test(slot)) return;
    try {
        // Validate source and parse useful facts before anything can create a default Account.
        const capturedIdentity = field('requestAccountObservation');
        let parsedList: ReturnType<typeof parseList> | null = null;
        let parsedDetail: GeminiRpcParseResult | null = null;
        if (raw.type === CrossWorldEvents.NETWORK_BATCHEXECUTE) {
            const text = field('text'), truncated = field('truncated'), requestedAt = field('requestedAt'), url = field('url');
            if (typeof text !== 'string' || !text || text.length > 3000000 || typeof truncated !== 'boolean'
                || typeof requestedAt !== 'number' || !Number.isFinite(requestedAt) || requestedAt <= 0 || typeof url !== 'string') return;
            const source = new URL(url);
            if (source.protocol !== 'https:' || !['gemini.google.com', 'bard.google.com'].includes(source.hostname)
                || !source.pathname.endsWith('/batchexecute')) return;
            if (text.includes(GeminiProtocol.RPCS.LIST)) {
                const request = field('listRequest');
                if (request !== undefined && (!request || typeof request !== 'object'
                    || !('streamId' in request) || !('requestCursor' in request)
                    || (request.streamId !== 'recent' && request.streamId !== 'pinned')
                    || (request.requestCursor !== null && typeof request.requestCursor !== 'string'))) return;
                parsedList = parseList(text);
            }
            if (text.includes(GeminiProtocol.RPCS.DETAIL)) {
                const request = field('detailRequest');
                if (request !== undefined && (!request || typeof request !== 'object'
                    || !('conversationId' in request) || typeof request.conversationId !== 'string' || !/^[\w-]{1,128}$/.test(request.conversationId)
                    || !('requestCursor' in request) || (request.requestCursor !== null && typeof request.requestCursor !== 'string'))) return;
                parsedDetail = parseGeminiRpcConversation(text, { providerId: 'gemini' });
                if (request && typeof request === 'object' && 'conversationId' in request
                    && request.conversationId !== parsedDetail.conversationId) return;
            }
            if (!parsedList && !parsedDetail) return;
            if (capturedIdentity === null && !(parsedList && parsedList.conversations.length > 0)
                && !(parsedDetail && parsedDetail.conversation.detail.messages.length > 0)) return;
        } else if (raw.type === CrossWorldEvents.CONVERSATION_DELETED) {
            const id = field('id'), url = field('url'), requestBody = field('requestBody'), responseText = field('responseText');
            if (!capturedIdentity || typeof capturedIdentity !== 'object' || Array.isArray(capturedIdentity)
                || typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)
                || typeof url !== 'string' || typeof requestBody !== 'string' || typeof responseText !== 'string') return;
            const source = new URL(url);
            if (source.protocol !== 'https:' || !['gemini.google.com', 'bard.google.com'].includes(source.hostname)
                || !source.pathname.endsWith('/batchexecute')
                || parseConfirmedGeminiDeletion(requestBody, responseText) !== id) return;
        } else if (raw.type === CrossWorldEvents.STREAM_START || raw.type === CrossWorldEvents.STREAM_COMPLETE) {
            // Unknown Stream signals by themselves are not proof of persistable content.
            if (capturedIdentity === null) return;
        } else return;

        const accountContext = await resolveRequestAccount(capturedIdentity, slot);
        if (!accountContext) return;
        const account = await getAccount(accountContext.accountId);
        if (!account) return;
        if (raw.type === CrossWorldEvents.NETWORK_BATCHEXECUTE) {
            const text = field('text'), truncated = field('truncated'), requestedAt = field('requestedAt'), url = field('url');
            if (typeof text !== 'string' || !text || text.length > 3000000 || typeof truncated !== 'boolean'
                || typeof requestedAt !== 'number' || !Number.isFinite(requestedAt) || requestedAt <= 0 || typeof url !== 'string') return;
            const source = new URL(url);
            if (source.protocol !== 'https:' || !['gemini.google.com', 'bard.google.com'].includes(source.hostname)
                || !source.pathname.endsWith('/batchexecute')) return;
            if (text.includes(GeminiProtocol.RPCS.LIST)) {
                const request = field('listRequest');
                let context: import('../../parsers/gemini/rpc/listRequest.js').GeminiListRequestContext | null = null;
                if (request !== undefined) {
                    if (!request || typeof request !== 'object' || !('streamId' in request) || !('requestCursor' in request)
                        || (request.streamId !== 'recent' && request.streamId !== 'pinned')
                        || (request.requestCursor !== null && typeof request.requestCursor !== 'string')) return;
                    context = { streamId: request.streamId, requestCursor: request.requestCursor };
                }
                const parsed = parsedList!;
                const page = geminiListObservation(parsed, context, account.id, truncated, requestedAt);
                const evidenceKey = capturedIdentity && typeof capturedIdentity === 'object'
                    ? Reflect.get(capturedIdentity, 'providerAccountId') : null;
                const trustedIdentity = typeof evidenceKey === 'string' && evidenceKey !== 'default'
                    && evidenceKey === account.providerAccountId;
                await ingestIndexes(account.id, parsed.conversations.map(item => parseGeminiIndexObservation(item, 'rpc-list')),
                    trustedIdentity && context ? page : undefined);
                if (deps === capturedDeps) capturedDeps.onIndexesCommitted?.(account.id);
            }
            if (text.includes(GeminiProtocol.RPCS.DETAIL)) {
                const request = field('detailRequest');
                if (request !== undefined && (!request || typeof request !== 'object' || !('conversationId' in request)
                    || typeof request.conversationId !== 'string' || !/^[\w-]{1,128}$/.test(request.conversationId)
                    || !('requestCursor' in request) || (request.requestCursor !== null && typeof request.requestCursor !== 'string'))) return;
                const native = parsedDetail!;
                const cid = native.conversationId;
                if (request && typeof request === 'object' && 'conversationId' in request && request.conversationId !== cid) return;
                const key = JSON.stringify([account.id, slot, cid]);
                const now = Date.now();
                for (const [id, chain] of chains) if (now - chain.requestedAt > 120000) chains.delete(id);
                // Uncorrelated pages remain usable facts, but never establish full coverage.
                let pages = [native], complete = false;
                if (request && typeof request === 'object' && 'conversationId' in request && request.conversationId === cid && 'requestCursor' in request && !truncated) {
                    const previous = chains.get(key);
                    if (request.requestCursor === null) chains.delete(key);
                    else if (previous && previous.next === request.requestCursor && requestedAt >= previous.requestedAt
                        && previous.pages.length < 20 && native.sourceVersion !== undefined
                        && previous.pages.every(page => page.sourceVersion === native.sourceVersion)) pages = [...previous.pages, native];
                    const startsAtHead = request.requestCursor === null || pages.length > 1;
                    complete = startsAtHead && native.transport.nextPageToken === null && pages.some(page => page.conversation.detail.messages.length > 0);
                    if (startsAtHead && native.transport.nextPageToken && !pages.slice(0, -1).some(page => page.transport.nextPageToken === native.transport.nextPageToken)) {
                        if (chains.size >= 50) chains.delete(chains.keys().next().value!);
                        chains.set(key, { pages, next: native.transport.nextPageToken, requestedAt });
                    } else chains.delete(key);
                } else chains.delete(key);
                const merged = mergeConversationPages(pages, truncated ? 'capture_truncated' : undefined, complete);
                const index = merged.conversation.index;
                const admission = await ingestDetail(account.id, cid, merged.conversation.detail, index);
                if (deps === capturedDeps) capturedDeps.onIndexesCommitted?.(account.id);
                if (admission.accepted) capturedDeps.resources?.retainParsed({ accountId: account.id, conversationId: cid }, merged);
                if (admission.changed && deps === capturedDeps) capturedDeps.onDetailChanged?.({ accountId: account.id, conversationId: cid });
            }
            return;
        }
        const id = field('id');
        if (id !== null && id !== undefined && (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id))) return;
        if (raw.type === CrossWorldEvents.CONVERSATION_DELETED) {
            const requestBody = field('requestBody'), responseText = field('responseText'), url = field('url');
            const evidenceKey = capturedIdentity && typeof capturedIdentity === 'object'
                ? Reflect.get(capturedIdentity, 'providerAccountId') : null;
            if (typeof id !== 'string' || account.providerAccountId === 'default'
                || evidenceKey !== account.providerAccountId
                || typeof requestBody !== 'string' || typeof responseText !== 'string' || typeof url !== 'string') return;
            const source = new URL(url);
            if (source.protocol !== 'https:' || !['gemini.google.com', 'bard.google.com'].includes(source.hostname)
                || !source.pathname.endsWith('/batchexecute')
                || parseConfirmedGeminiDeletion(requestBody, responseText) !== id) return;
            await Promise.allSettled(earlier);
            await ingestDeletedConversation(account.id, id);
            if (deps === capturedDeps) {
                capturedDeps.onConversationDeleted?.(id, account.id);
                capturedDeps.onIndexesCommitted?.(account.id);
            }
            return;
        }
        if (raw.type !== CrossWorldEvents.STREAM_START && raw.type !== CrossWorldEvents.STREAM_COMPLETE) return;
        const current = await resolveCurrentAccount();
        if (current?.accountId !== account.id || current.slot !== slot) return;
        const cid = typeof id === 'string' ? normId(id) : (typeof location !== 'undefined' ? extractConversationIdFromUrl(location.pathname) : null);
        if (cid) {
            const item = parseGeminiDomIndex(typeof document !== 'undefined' ? document : null, cid);
            const { conversationId, fields } = parseGeminiIndexObservation(item, 'dom');
            await ingestIndexes(account.id, [{ conversationId, fields }]);
            if (deps === capturedDeps) capturedDeps.onIndexesCommitted?.(account.id);
        }
        if (raw.type === CrossWorldEvents.STREAM_START) {
            if (deps === capturedDeps && capturedDeps.onStreamStart) capturedDeps.onStreamStart(typeof id === 'string' ? id : null, slot);
        } else {
            await Promise.all(earlier);
            if (cid && deps === capturedDeps) capturedDeps.onStreamComplete?.({ accountId: account.id, conversationId: cid }, slot);
        }
    } catch (error) {
        if (isDevMode()) console.debug('[MessageBridge] source capture failed', error);
        throw error;
    }
}
export const MessageBridge = { init, handleWindowMessage };
