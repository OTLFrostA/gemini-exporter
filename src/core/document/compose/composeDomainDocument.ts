import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import { assertDomainClosure } from '../../domain/closure.js';
import { collectReferencedAssetIds } from '../../domain/content/collectAssetReferences.js';
import { selectDisplayDate } from './displayDate.js';
import { contentComposer } from './composeContent.js';
import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';
import type { DocumentAst } from '../ast/ast.js';

export interface DomainCompositionOptions { documentLanguage?: string }

/** Domain facts -> one format-neutral presentation tree. No resource acquisition or raw parsing. */
export function composeDomainDocument(conversation: DomainConversationDetail, options: DomainCompositionOptions = {}): { document: DocumentAst; diagnostics: DocumentDiagnostic[] } {
    assertDomainClosure(conversation);
    const assets = new Map(conversation.assets.map(asset => [asset.id, asset]));
    const ids = new Set<string>();
    let citationNumber = 0;
    const messages = conversation.messages.map((message, index) => {
        const id = message.id ?? `msg-${index}`;
        if (!id.trim()) throw new TypeError(`[MSG_BAD_ID] Empty message identity`);
        if (ids.has(id)) throw new TypeError(`[MSG_DUP_ID] Duplicate message identity: ${id}`);
        ids.add(id);
        const citations = new Map((message.citations ?? []).map(citation => [citation.id, { ...citation, displayNumber: ++citationNumber }]));
        const source = (ref: string, explicit?: string) => {
            const citation = citations.get(ref);
            return { id: `${id}:${ref}`, label: explicit ?? citation?.title ?? `[${citation?.number ?? citation?.displayNumber ?? 1}]`, ...(citation?.url ? { href: citation.url } : {}) };
        };
        const compose = contentComposer(assets, source);
        const placed = collectReferencedAssetIds([...(message.reasoning ?? []), ...message.content]);
        const attached = (message.attachmentIds ?? []).filter(id => !placed.has(id)).map(id => {
            const asset = assets.get(id)!;
            return asset.kind === 'image' ? { type: 'image' as const, assetId: id, alt: asset.name }
                : { type: 'file' as const, assetId: id, label: asset.name };
        });
        return {
            type: 'message' as const, id,
            variant: message.role === 'user' ? 'bubble' as const : 'flow' as const,
            label: message.role === 'user' ? 'you' as const : message.role,
            ...(message.role === 'unknown' && message.provenance?.rawRole ? { heading: { level: 2 as const, text: message.provenance.rawRole } } : {}),
            ...(message.model ? { modelLabel: message.model } : {}),
            blocks: [...(message.reasoning ? [{ type: 'disclosure' as const, kind: 'reasoning' as const, blocks: compose(message.reasoning) }] : []), ...compose([...message.content, ...attached])],
            ...(citations.size ? { sources: { type: 'sources' as const, items: [...citations.keys()].map((ref, index) => ({ ...source(ref), number: index + 1 })) } } : {}),
        };
    });
    const date = selectDisplayDate(conversation.updatedAt, conversation.lastSeen, conversation.createdAt, conversation.timestamp, conversation.chatTime);
    return { document: {
        schemaVersion: 2,
        ...(options.documentLanguage ? { documentLanguage: options.documentLanguage } : {}),
        header: { title: (conversation.title || 'Untitled conversation').replace(/[\r\n]+/g, ' ').trim(), providerLabel: conversation.providerId,
            ...(date ? { date } : {}), messageCount: messages.length },
        messages,
    }, diagnostics: [] };
}
