import type { DomainAsset, DomainMessage } from '../../../domain/conversationDetail.js';
import { validateParserDomain } from '../../../domain/runtimeValidation.js';
import { mapContentAssetReferences } from '../../../domain/content/assetReferences.js';
import type { ResourceConversationParseResult } from '../../parsingResult.js';
import type { GeminiRpcParseResult } from './parseConversation.js';

type ConversationPage = ResourceConversationParseResult & { transport?: Pick<GeminiRpcParseResult['transport'], 'turnsRejected'> };

/** Pages arrive newest first. Asset collisions without shared source identity remain distinct. */
export function mergeConversationPages(pages: readonly ConversationPage[], truncatedReason?: string): ResourceConversationParseResult {
    if (!pages.length) throw new TypeError('No conversation pages');
    const first = pages[0].conversation;
    const assets = new Map<string, DomainAsset>();
    const seenMessages = new Set<string>();
    let messages: DomainMessage[] = [];
    const resourceHints: Record<string, ResourceConversationParseResult['resourceHints'][string]> = {};
    const acquisitionHints: Record<string, ResourceConversationParseResult['acquisitionHints'][string]> = {};
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        if (page.conversation.index.id !== first.index.id || page.conversation.index.providerId !== first.index.providerId) throw new TypeError('Cannot merge pages from different conversations');
        const aliases = new Map<string, string>();
        for (const asset of page.conversation.detail.assets) {
            let id = asset.id;
            const previous = assets.get(id);
            const sharedSource = previous?.sourceUri && previous.sourceUri === asset.sourceUri && previous.kind === asset.kind;
            if (previous && !sharedSource) {
                id = `${asset.id}_page${pageIndex}`;
                while (assets.has(id)) id += '_';
            }
            aliases.set(asset.id, id);
            assets.set(id, sharedSource ? { ...asset, ...previous } : { ...asset, id });
            if (page.resourceHints[asset.id]) resourceHints[id] = { ...page.resourceHints[asset.id], ...resourceHints[id] };
            if (page.acquisitionHints[asset.id]) acquisitionHints[id] = { ...page.acquisitionHints[asset.id], ...acquisitionHints[id] };
        }
        const fresh = page.conversation.detail.messages.filter(message => {
            if (!message.id) return true;
            if (seenMessages.has(message.id)) return false;
            seenMessages.add(message.id); return true;
        }).map(message => ({ ...message,
            content: mapContentAssetReferences(message.content, id => aliases.get(id) ?? id),
            ...(message.reasoning ? { reasoning: mapContentAssetReferences(message.reasoning, id => aliases.get(id) ?? id) } : {}),
            ...(message.attachmentIds ? { attachmentIds: [...new Set(message.attachmentIds.map(id => aliases.get(id) ?? id))] } : {}) }));
        messages = [...fresh, ...messages];
    }
    const rejected = pages.some(page => (page.transport?.turnsRejected ?? 0) > 0);
    const versionMismatch = pages.some(page => page.sourceVersion !== undefined
        && page.conversation.detail.messages.some(message => message.timestamp !== undefined && message.timestamp > page.sourceVersion!));
    const versionChanged = pages.some(page => page.sourceVersion !== pages[0].sourceVersion);
    const conversation = { index: { ...first.index, messageCount: messages.length }, detail: { messages, assets: [...assets.values()],
        completeness: truncatedReason || rejected || versionMismatch || versionChanged ? 'partial' as const : 'unknown' as const } };
    return { ...(pages[0].sourceVersion !== undefined ? { sourceVersion: pages[0].sourceVersion } : {}), conversation: validateParserDomain(conversation), resourceHints, acquisitionHints, diagnostics: [...pages.flatMap(page => page.diagnostics),
        ...(truncatedReason ? [{ severity: 'warning' as const, code: 'GEMINI_PAGINATION_TRUNCATED', message: truncatedReason }] : []),
        ...(versionChanged ? [{ severity: 'warning' as const, code: 'CONVERSATION_VERSION_CHANGED', message: 'Conversation version changed or became unknown during pagination' }] : [])] };
}
