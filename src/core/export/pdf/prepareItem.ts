import { BatchWorker, type FetchChatDetailResult } from '../../engine/export/batchWorker.js';
import { normId } from '../../utils/pathUtils.js';
import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import type { Diagnostic } from '../canonical/diagnostics.js';
import { normalizeGeminiConversation } from '../canonical/index.js';
import type { RenderDiagnostic } from '../canonical/rendering.js';
import type { InlineByteStore } from '../assets/index.js';

export const PDF_NO_MESSAGES = 'PDF_NO_MESSAGES';
export const PDF_DETAIL_FETCH_FAILED = 'PDF_DETAIL_FETCH_FAILED';

export function toRenderDiagnostic(d: Diagnostic): RenderDiagnostic {
    return {
        severity: d.severity,
        code: d.code,
        message: d.message,
        path: d.path,
    };
}

export function hasUsableMessages(chat: any): boolean {
    if (!chat || typeof chat !== 'object') return false;
    if (Array.isArray(chat.messages) && chat.messages.length > 0) return true;
    if (Array.isArray(chat.turns) && chat.turns.length > 0) return true;
    return false;
}

/**
 * Extract the chat from a fetchChatDetail result using the exact contract
 * ExportOrchestrator uses: results[0] wins, then chat. Never invent fields.
 */
export function extractChatFromDetailResult(res: FetchChatDetailResult, nid: string, fallback: any): any {
    const chunkResults = res.results || (res.chat ? [res.chat] : []);
    const chat = chunkResults[0] || fallback;
    if (chat && typeof chat === 'object') chat.id = nid;
    return chat;
}

/**
 * Resolve a full conversation for a metadata-only list item via the same
 * BatchWorker.fetchChatDetail path the normal export uses. The normalizer
 * stays a pure data transform — no network fetch is ever put inside it.
 */
export async function resolveFullChatDetail(args: {
    id: string;
    title: string;
    index: number;
    total: number;
    currentSlot: string;
    skip: boolean;
    signal: AbortSignal;
    fetchChatDetail: typeof BatchWorker.fetchChatDetail;
    onLog: (msg: string, level?: string) => void;
}): Promise<{ ok: true; chat: any } | { ok: false; error: string }> {
    const { id, title, index, total, currentSlot, skip, signal, fetchChatDetail, onLog } = args;
    const nid = normId(id);
    let res: FetchChatDetailResult | null = null;
    try {
        res = await fetchChatDetail({ id: nid, title }, index, total, currentSlot, skip, 'pdf', signal);
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
    if (!res || !res.success) {
        return { ok: false, error: (res && res.error) || 'unknown error' };
    }
    const chat = extractChatFromDetailResult(res, nid, { id: nid, title });
    const msgCount = Array.isArray(chat?.messages) ? chat.messages.length : 0;
    onLog(`[PDF] ${title || nid}: resolved full conversation detail (${msgCount} messages)`, 'info');
    return { ok: true, chat };
}

export interface PreparedPdfItemSuccess {
    ok: true;
    id: string;
    title: string;
    bundle: CanonicalConversationBundle;
    byteStore: InlineByteStore;
    diagnostics: RenderDiagnostic[];
}

export interface PreparedPdfItemFailure {
    ok: false;
    id: string;
    title: string;
    error: string;
    diagnostics: RenderDiagnostic[];
}

export type PreparedPdfItemResult = PreparedPdfItemSuccess | PreparedPdfItemFailure;

export interface PreparePdfItemContext {
    conversations?: any[];
    fetchChatDetail?: typeof BatchWorker.fetchChatDetail;
    index: number;
    total: number;
    currentSlot: string;
    skip: boolean;
    signal: AbortSignal;
    onLog: (msg: string, level?: string) => void;
}

export async function preparePdfItem(
    selectedItem: any,
    context: PreparePdfItemContext,
): Promise<PreparedPdfItemResult> {
    const rawId = selectedItem?.id ?? '';
    const id = normId(rawId);
    const title = selectedItem?.title || id;

    const listChat = Array.isArray(context.conversations)
        ? context.conversations.find((c: any) => normId(c?.id) === id)
        : null;
    const selectedChat = typeof selectedItem === 'object' ? selectedItem : { id, title };

    const diagnostics: RenderDiagnostic[] = [];
    let chat: any = listChat ?? selectedChat;

    if (!hasUsableMessages(chat)) {
        if (!context.fetchChatDetail) {
            return {
                ok: false,
                id,
                title,
                error: `[${PDF_DETAIL_FETCH_FAILED}] fetchChatDetail function not provided`,
                diagnostics,
            };
        }
        const fetched = await resolveFullChatDetail({
            id,
            title,
            index: context.index,
            total: context.total,
            currentSlot: context.currentSlot,
            skip: context.skip,
            signal: context.signal,
            fetchChatDetail: context.fetchChatDetail,
            onLog: context.onLog,
        });
        if (context.signal.aborted) {
            return { ok: false, id, title, error: 'aborted', diagnostics };
        }
        if (!fetched.ok) {
            return {
                ok: false,
                id,
                title,
                error: `[${PDF_DETAIL_FETCH_FAILED}] ${fetched.error}`,
                diagnostics,
            };
        }
        chat = fetched.chat;
    }

    const { bundle, diagnostics: normDiags, byteStore } = await normalizeGeminiConversation(chat as any);
    for (const d of normDiags) diagnostics.push(toRenderDiagnostic(d));

    if ((bundle?.conversation?.messages?.length ?? 0) === 0) {
        return {
            ok: false,
            id,
            title,
            error: `[${PDF_NO_MESSAGES}] Conversation detail resolved without any messages; refusing to generate an empty PDF.`,
            diagnostics,
        };
    }

    return {
        ok: true,
        id,
        title,
        bundle,
        byteStore,
        diagnostics,
    };
}
