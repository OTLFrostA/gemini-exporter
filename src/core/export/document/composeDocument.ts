import type { CanonicalConversationBundle } from '../canonical/conversation.js';
import { isHumanMeaningfulFilename } from './resourcePresentation.js';
import { contentComposer } from './composeContent.js';
import { citationDisplayLabel } from '../canonical/citations.js';
import type { DocumentAst, DocumentDiagnostic } from './ast.js';

export interface CompositionOptions { documentLanguage?: string }

/** Compose facts and logical presentation. No output format, units, UI locale or resource paths. */
export function composeDocument(bundle: CanonicalConversationBundle, options: CompositionOptions = {}): { document: DocumentAst; diagnostics: DocumentDiagnostic[] } {
    const citations = new Map(bundle.citations.map((citation, index) => [citation.id, { ...citation, number: index + 1 }]));
    const diagnostics: DocumentDiagnostic[] = [];
    const source = (id: string, explicit?: string) => {
        const citation = citations.get(id);
        return { id, label: citation ? citationDisplayLabel(citation, citation.number, explicit) : explicit ?? id, ...(citation?.url ? { href: citation.url } : {}) };
    };
    const blocks = contentComposer(new Map(bundle.assets.map(asset => [asset.id, { id: asset.id, kind: asset.kind, name: isHumanMeaningfulFilename(asset.name) ? asset.name : asset.kind === 'file' ? asset.storageRef?.split('/').pop() : asset.name, mediaType: asset.mimeType, byteLength: asset.sizeBytes }])), source);
    const messages = bundle.conversation.messages.map((message, index) => ({
        type: 'message' as const,
        id: message.id,
        anchor: `turn-${message.role === 'user' ? 'user' : 'model'}-${index}`,
        variant: message.role === 'user' ? 'bubble' as const : 'flow' as const,
        label: message.role === 'user' ? 'you' as const : message.role,
        ...(message.author?.model && message.role !== 'user' ? { modelLabel: message.author.model } : {}),
        ...(message.role === 'unknown' && message.author?.rawRole ? { heading: { level: 2 as const, text: message.author.rawRole } } : {}),
        blocks: blocks(message.blocks),
        ...(message.citationIds?.length ? { sources: { type: 'sources' as const, items: message.citationIds.map((id, index) => ({ ...source(id), number: index + 1 })) } } : {}),
    }));
    const conversation = bundle.conversation;
    return { document: {
        schemaVersion: 2,
        ...(options.documentLanguage ? { documentLanguage: options.documentLanguage } : {}),
        header: {
            title: (conversation.title || 'Untitled conversation').replace(/[\r\n]+/g, ' ').trim(),
            providerLabel: conversation.key.providerId,
             ...(conversation.updatedAt ?? conversation.createdAt ? { date: (conversation.updatedAt ?? conversation.createdAt)!.slice(0, 10) } : {}), messageCount: messages.length,
        },
        messages,
    }, diagnostics };
}

export function isArchiveResourceRef(ref: string): boolean { return Boolean(ref) && !/(^\/|\\|^[a-z][a-z\d+.-]*:|(^|\/)\.\.(\/|$))/i.test(ref); }
