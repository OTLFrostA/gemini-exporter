import { readAccount, type Account } from '../../domain/accountRegistry.js';
import { sameConversationKey } from '../../domain/conversationKey.js';
import type { ReadonlyDomain } from '../../domain/runtimeValidation.js';
import { readingLabels } from './resourcePresentation.js';
import { contentComposer } from './composeContent.js';
import type { DocumentAst, SourceItem } from '../ast/ast.js';

/** Trusted Domain facts -> one format-neutral reading tree. No I/O or output policy. */
export function composeDomainDocument(conversation: ReadonlyDomain, account: Readonly<Account>): DocumentAst {
    readAccount(account);
    if (account.id !== conversation.index.key.accountId ||
        !sameConversationKey(conversation.index.key, conversation.detail.key)) {
        throw new TypeError('Composition Account/key mismatch');
    }

    const assets = new Map(conversation.detail.assets.map(asset => [asset.id, asset]));
    let nextCitationNumber = 0;
    const messages = conversation.detail.messages.map(message => {
        const citations = (message.citations ?? []).map(citation => ({
            citation,
            number: ++nextCitationNumber,
        }));
        const byId = new Map(citations.map(item => [item.citation.id, item]));
        const source = (id: string, explicit?: string) => {
            // L2 guarantees each reference resolves within this message.
            const item = byId.get(id)!;
            return {
                id,
                label: explicit?.trim() ? explicit : '[' + item.number + ']',
                ...(item.citation.url !== undefined ? { href: item.citation.url } : {}),
            };
        };
        const compose = contentComposer(assets, source);
        const attachments = (message.attachmentIds ?? []).map(id => {
            const asset = assets.get(id)!;
            return asset.kind === 'image'
                ? { type: 'image' as const, assetId: id, alt: asset.name }
                : { type: 'file' as const, assetId: id, label: asset.name };
        });
        const blocks = [
            ...(message.reasoning?.length
                ? [{ type: 'disclosure' as const, kind: 'reasoning', title: readingLabels.reasoning, blocks: compose(message.reasoning) }]
                : []),
            ...compose([...message.content, ...attachments]),
        ];
        const sources: SourceItem[] = citations.map(({ citation, number }) => ({
            id: citation.id,
            label: citation.title || citation.url || '',
            ...(citation.url !== undefined ? { href: citation.url } : {}),
            number,
        }));
        return {
            role: message.role,
            ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
            ...(message.model !== undefined ? { modelLabel: message.model } : {}),
            blocks,
            ...(sources.length ? { sources } : {}),
        };
    });

    return {
        title: conversation.index.title ?? readingLabels.title,
        metadata: {
            id: conversation.index.key.conversationId,
            provider: account.providerId,
            ...(conversation.index.createdAt !== undefined ? { createdAt: conversation.index.createdAt } : {}),
            ...(conversation.index.updatedAt !== undefined ? { updatedAt: conversation.index.updatedAt } : {}),
        },
        messages,
    };
}
