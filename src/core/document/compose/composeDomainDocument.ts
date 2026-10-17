import { readAccount, type Account } from '../../domain/accountRegistry.js';
import { sameConversationKey } from '../../domain/conversationKey.js';
import { toIso } from '../../domain/time.js';
import type { ReadonlyDomain } from '../../domain/runtimeValidation.js';
import { collectReferencedAssetIds } from '../../domain/content/collectAssetReferences.js';
import { selectDisplayDate } from './displayDate.js';
import { contentComposer } from './composeContent.js';
import type { DocumentAst } from '../ast/ast.js';

export interface DomainCompositionOptions { documentLanguage?: string }

/** Domain facts -> one format-neutral presentation tree. No resource acquisition or raw parsing. */
export function composeDomainDocument(conversation: ReadonlyDomain, account: Readonly<Account>, options: DomainCompositionOptions = {}): DocumentAst {
    readAccount(account);
    if (account.id !== conversation.index.key.accountId || !sameConversationKey(conversation.index.key, conversation.detail.key)) throw new TypeError('Composition Account/key mismatch');
    const assets = new Map(conversation.detail.assets.map(asset => [asset.id, asset]));
    let citationNumber = 0;
    const messages = conversation.detail.messages.map((message, index) => {
        const id = `msg-${index}`;
        const citations = new Map((message.citations ?? []).map(citation => [citation.id, { ...citation, displayNumber: ++citationNumber }]));
        const source = (ref: string, explicit?: string) => {
            // L2 admission guarantees message-local reference closure.
            const citation = citations.get(ref)!;
            return { id: `${id}:${ref}`, label: explicit && !/^\[\d+\]$/.test(explicit) ? explicit : `[${citation.displayNumber}]`, ...(citation.url ? { href: citation.url } : {}) };
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
            ...(message.model ? { modelLabel: message.model } : {}),
            blocks: [...(message.reasoning ? [{ type: 'disclosure' as const, kind: 'reasoning' as const, blocks: compose(message.reasoning) }] : []), ...compose([...message.content, ...attached])],
            ...(citations.size ? { sources: { type: 'sources' as const, items: [...citations.values()].map(citation => ({ ...source(citation.id), label: citation.title || citation.url || '', number: citation.displayNumber })) } } : {}),
        };
    });
    const date = selectDisplayDate(conversation.index.updatedAt, conversation.index.createdAt);
    return {
        schemaVersion: 2,
        metadata: { id: conversation.index.key.conversationId, provider: account.providerId,
            ...(toIso(conversation.index.createdAt) ? { createdAt: toIso(conversation.index.createdAt)! } : {}),
            ...(toIso(conversation.index.updatedAt) ? { updatedAt: toIso(conversation.index.updatedAt)! } : {}) },
        ...(options.documentLanguage ? { documentLanguage: options.documentLanguage } : {}),
        header: { title: (conversation.index.title || 'Untitled conversation').replace(/[\r\n]+/g, ' ').trim(), providerLabel: account.providerId,
            ...(date ? { date } : {}), messageCount: messages.length },
        messages,
    };
}
