import type { DomainAsset, DomainConversationDetail, DomainMessage } from '../../../domain/conversationDetail.js';
import { assertDomainClosure } from '../../../domain/closure.js';
import { mapContentAssetReferences } from '../../../domain/content/assetReferences.js';
import type { ResourceConversationParseResult } from '../../parsingResult.js';

/** Pages arrive newest first. Asset collisions without shared source identity remain distinct. */
export function mergeConversationPages(pages: readonly ResourceConversationParseResult[], truncatedReason?: string): ResourceConversationParseResult {
    if (!pages.length) throw new TypeError('No conversation pages');
    const first = pages[0].conversation;
    const assets = new Map<string, DomainAsset>();
    const seenMessages = new Set<string>();
    let messages: DomainMessage[] = [];
    const resourceHints: Record<string, ResourceConversationParseResult['resourceHints'][string]> = {};
    const acquisitionHints: Record<string, ResourceConversationParseResult['acquisitionHints'][string]> = {};
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        assertDomainClosure(page.conversation);
        if (page.conversation.id !== first.id || page.conversation.providerId !== first.providerId) throw new TypeError('Cannot merge pages from different conversations');
        const aliases = new Map<string, string>();
        for (const asset of page.conversation.assets) {
            let id = asset.id;
            const previous = assets.get(id);
            const sharedSource = previous?.source?.uri && previous.source.uri === asset.source?.uri && previous.kind === asset.kind;
            if (previous && !sharedSource) {
                id = `${asset.id}_page${pageIndex}`;
                while (assets.has(id)) id += '_';
            }
            aliases.set(asset.id, id);
            assets.set(id, sharedSource ? { ...asset, ...previous } : { ...asset, id });
            if (page.resourceHints[asset.id]) resourceHints[id] = { ...page.resourceHints[asset.id], ...resourceHints[id] };
            if (page.acquisitionHints[asset.id]) acquisitionHints[id] = { ...page.acquisitionHints[asset.id], ...acquisitionHints[id] };
        }
        const fresh = page.conversation.messages.filter(message => {
            if (!message.id) return true;
            if (seenMessages.has(message.id)) return false;
            seenMessages.add(message.id); return true;
        }).map(message => ({ ...message,
            content: mapContentAssetReferences(message.content, id => aliases.get(id) ?? id),
            ...(message.reasoning ? { reasoning: mapContentAssetReferences(message.reasoning, id => aliases.get(id) ?? id) } : {}),
            ...(message.attachmentIds ? { attachmentIds: [...new Set(message.attachmentIds.map(id => aliases.get(id) ?? id))] } : {}) }));
        messages = [...fresh, ...messages];
    }
    const dates = messages.flatMap(m => m.timestamp === undefined ? [] : [m.timestamp]);
    const rejected = pages.some(page => page.diagnostics.some(d => d.code === 'GEMINI_TURNS_REJECTED'));
    const createdAt = dates.length ? Math.min(...dates) : first.createdAt;
    const updatedAt = dates.length ? Math.max(...dates) : first.updatedAt;
    const conversation: DomainConversationDetail = { ...first, messages, assets: [...assets.values()], createdAt, updatedAt,
        timestamp: typeof updatedAt === 'number' ? updatedAt : first.timestamp,
        completeness: truncatedReason || rejected ? { status: 'partial', reason: truncatedReason ?? 'Some source turns could not be decoded' } : { status: 'unknown' } };
    assertDomainClosure(conversation);
    return { conversation, resourceHints, acquisitionHints, diagnostics: [...pages.flatMap(page => page.diagnostics),
        ...(truncatedReason ? [{ severity: 'warning' as const, code: 'GEMINI_PAGINATION_TRUNCATED', message: truncatedReason }] : [])] };
}
