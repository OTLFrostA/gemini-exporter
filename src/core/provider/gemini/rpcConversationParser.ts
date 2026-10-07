import { decodeGeminiDetail } from '../../api/parser/parseDetail.js';
import type { GeminiDetailDebugEvidence, GeminiMessageEvidence } from '../../api/parser/detailEvidence.js';
import type { DomainCitation, DomainConversationDetail, DomainGeneratedMediaIdentity, DomainMessage } from '../../domain/conversationDetail.js';
import type { ConversationParseContext } from '../../domain/parsing.js';
import { assertDomainClosure } from '../../domain/closure.js';
import type { Diagnostic } from '../../content/diagnostics.js';
import { closeLegacyCitations } from '../domainCitationAdapter.js';
import { closeDomainResources } from '../domainResourceAdapter.js';
import { parseGeminiBody, parseLegacyReasoning, structuredBodyAttachments } from './contentAdapter.js';
import type { ResourceConversationParseResult } from '../parsingResult.js';

export interface GeminiRpcParseContext extends ConversationParseContext {
    targetConvId?: string;
}

export interface GeminiRpcParseResult extends ResourceConversationParseResult {
    /** Pagination and wire/debug evidence are acquisition context, never Domain fields. */
    transport: {
        nextPageToken: string | null;
        turnsRejected?: number;
        schemaDrift?: string[];
        decodedPayload?: unknown;
        debug?: GeminiDetailDebugEvidence | null;
    };
}

function citationsOf(message: GeminiMessageEvidence): DomainCitation[] {
    const citations: DomainCitation[] = [];
    const urls = new Set<string>();
    for (const source of message.citations ?? []) {
        if (!source.url?.trim() || urls.has(source.url)) continue;
        urls.add(source.url);
        citations.push({ id: `citation-${citations.length}`, url: source.url, ...(typeof source.title === 'string' ? { title: source.title } : {}) });
    }
    return citations;
}

/** Raw Gemini detail RPC -> a closed Domain graph. No persisted Conversation or record parser. */
export function parseGeminiRpcConversation(text: string, context: GeminiRpcParseContext): GeminiRpcParseResult {
    if (context.providerId !== 'gemini') throw new TypeError('Gemini RPC parser requires providerId gemini');
    if (typeof text !== 'string') throw new TypeError('Gemini RPC input must be raw response text');
    const evidence = decodeGeminiDetail(text, context.targetConvId);
    const contentDiagnostics: Diagnostic[] = [];
    const messages: DomainMessage[] = evidence.messages.map((message, index) => {
        const sourceRef = { providerId: 'gemini', providerMessageId: message.id, locator: `messages[${index}]` };
        const reasoning = parseLegacyReasoning(message.thoughts, { diagnostics: contentDiagnostics, sourceRef });
        const citations = citationsOf(message);
        return closeLegacyCitations({
            ...(typeof message.id === 'string' && message.id.trim() ? { id: message.id } : {}),
            role: message.role === 'model' ? 'assistant' : 'user',
            content: parseGeminiBody(message.content, message.structuredContent, { diagnostics: contentDiagnostics, sourceRef }),
            ...(typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? { timestamp: message.timestamp } : {}),
            ...(message.model ? { model: message.model } : {}),
            ...(message.rawProviderRequestId ? { provenance: { providerRequestId: message.rawProviderRequestId } } : {}),
            ...(reasoning !== undefined ? { reasoning } : {}),
            ...(citations.length ? { citations } : {}),
        }, message.groundingCitationMarkers);
    });
    const resources = closeDomainResources('gemini', messages, evidence.messages.map(message => {
        // These resources were explicitly extracted from this turn; preserve its original token.
        const sourceGeneration = <T extends { isGenerated?: boolean; providerRequestId?: string; generation?: DomainGeneratedMediaIdentity }>(asset: T): T =>
            asset.isGenerated && message.rawProviderRequestId ? { ...asset, providerRequestId: message.rawProviderRequestId,
                ...(asset.generation ? { generation: { ...asset.generation, providerRequestId: message.rawProviderRequestId } } : {}) } : asset;
        return { input: { ...message, images: message.images?.map(sourceGeneration), attachments: message.attachments?.map(sourceGeneration) }, bodyAttachments: structuredBodyAttachments(message) };
    }));
    const hasMore = Boolean(evidence.nextPageToken?.trim());
    const rejected = (evidence.turnsRejected ?? 0) > 0;
    const metadata = evidence.metadataConversation;
    const conversation: DomainConversationDetail = {
        providerId: 'gemini', provenance: { source: 'gemini-rpc' },
        completeness: { status: hasMore || rejected ? 'partial' : 'unknown' },
        id: metadata?.id ?? evidence.id, title: metadata?.title ?? evidence.title,
        titleSource: metadata ? 'rpc' : evidence.titleSource, titles: metadata ? { rpc: metadata.title } : { ...evidence.titles },
        timestamp: evidence.updatedAt ?? evidence.createdAt,
        createdAt: evidence.createdAt, updatedAt: evidence.updatedAt,
        url: metadata ? `https://gemini.google.com/app/${metadata.id.replace(/^c_/, '')}` : evidence.url,
        assets: resources.assets, messages: resources.messages,
    };
    assertDomainClosure(conversation);
    return {
        conversation, resourceHints: resources.resourceHints, acquisitionHints: resources.acquisitionHints,
        diagnostics: [
            ...(evidence.schemaDrift ?? []).map(message => ({ severity: 'warning' as const, code: 'GEMINI_SCHEMA_DRIFT', message })),
            ...(rejected ? [{ severity: 'warning' as const, code: 'GEMINI_TURNS_REJECTED', message: `Rejected ${evidence.turnsRejected} unrecognized source turns` }] : []),
            ...contentDiagnostics.map(d => ({ severity: d.severity, code: d.code, message: d.message, path: d.path })),
        ],
        transport: {
            nextPageToken: evidence.nextPageToken,
            ...(evidence.turnsRejected !== undefined ? { turnsRejected: evidence.turnsRejected } : {}),
            ...(evidence.schemaDrift !== undefined ? { schemaDrift: [...evidence.schemaDrift] } : {}),
            ...(evidence._raw !== undefined ? { decodedPayload: evidence._raw } : {}),
            ...(evidence._debug !== undefined ? { debug: evidence._debug } : {}),
        },
    };
}
