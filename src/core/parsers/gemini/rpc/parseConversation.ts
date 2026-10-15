import type { GeminiStructuredNode } from './structuredContent.js';
import { contentQuality } from '../../../domain/quality.js';
import { parseIndexMetadata } from '../../shared/parseIndexMetadata.js';
import { normId } from '../../../utils/pathUtils.js';
import { decodeGeminiDetail } from './detailDecoder.js';
import type { GeminiDetailDebugEvidence, GeminiMessageEvidence } from './detailEvidence.js';
import type { DomainCitation, DomainMessage } from '../../../domain/conversationDetail.js';
import type { ConversationParseContext } from '../../contracts.js';
import { validateParserDomain } from '../../../domain/runtimeValidation.js';
import type { Diagnostic } from '../../../diagnostics/diagnostic.js';
import { closeLegacyCitations } from '../../shared/resources/domainCitationAdapter.js';
import { closeDomainResources } from '../../shared/resources/domainResourceAdapter.js';
import { parseGeminiBody, parseGeminiPrompt, parseLegacyReasoning, structuredBodyAttachments } from '../shared/contentAdapter.js';
import type { ResourceConversationParseResult } from '../../parsingResult.js';

export interface GeminiRpcParseContext extends ConversationParseContext {
    targetConvId?: string;
}

export interface GeminiRpcParseResult extends ResourceConversationParseResult {
    /** Pagination and wire/debug evidence are acquisition context, never Domain fields. */
    transport: {
        nextPageToken: string | null;
        decodedPayload?: unknown;
        debug?: GeminiDetailDebugEvidence | null;
    };
}

function citationsOf(message: GeminiMessageEvidence): { citations: DomainCitation[]; legacyCitations: DomainCitation[]; sourceCitations: Map<string, DomainCitation[]> } {
    const citations: DomainCitation[] = [];
    const byUrl = new Map<string, DomainCitation>();
    const addSource = (source: { url: string; title?: string }): DomainCitation => {
        const existing = byUrl.get(source.url);
        if (existing) return existing;
        const citation = { id: `citation-${byUrl.size}`, url: source.url, ...(typeof source.title === 'string' ? { title: source.title } : {}) };
        byUrl.set(source.url, citation);
        citations.push(citation);
        return citation;
    };
    for (const source of message.citations ?? []) if (source.url?.trim()) addSource(source);
    const legacyCitations = [...citations];
    const sourceCitations = new Map<string, DomainCitation[]>();
    for (const attribution of message.sourceAttributions ?? []) {
        sourceCitations.set(attribution.sourceId, attribution.sources.map(addSource));
    }
    const files = new Map<number, Set<string>>();
    const visit = (nodes: GeminiStructuredNode[]): void => {
        for (const node of nodes) {
            if (node.nodeType === 'citation') {
                const titles = files.get(node.number) ?? new Set<string>();
                titles.add(node.title);
                files.set(node.number, titles);
            } else if ('children' in node) visit(node.children);
            else if ('items' in node) node.items.forEach(item => visit(item.children));
            else if ('rows' in node) node.rows.forEach(row => row.cells.forEach(cell => visit(cell.children)));
        }
    };
    if (message.structuredContent) visit(message.structuredContent.children);
    for (const [number, titles] of files) {
        const citation = { id: `grounding-${number}`, title: [...titles].join('; ') };
        citations.push(citation);
        sourceCitations.set(citation.id, [citation]);
    }
    return { citations, legacyCitations, sourceCitations };
}

/** Raw Gemini detail RPC -> a closed Domain graph. No persisted Conversation or record parser. */
export function parseGeminiRpcConversation(text: string, context: GeminiRpcParseContext): GeminiRpcParseResult {
    if (context.providerId !== 'gemini') throw new TypeError('Gemini RPC parser requires providerId gemini');
    if (typeof text !== 'string') throw new TypeError('Gemini RPC input must be raw response text');
    const evidence = decodeGeminiDetail(text, context.targetConvId);
    const contentDiagnostics: Diagnostic[] = [];
    const messages: DomainMessage[] = evidence.messages.map((message, index) => {
        const sourceRef = { providerId: 'gemini', providerMessageId: message.id, locator: `messages[${index}]` };
        const extraction = message.structuredExtraction;
        if (extraction && extraction.status !== 'decoded') contentDiagnostics.push({
            severity: extraction.status === 'decode_rejected' ? 'warning' : 'info',
            code: 'GEMINI_STRUCTURED_FALLBACK',
            message: 'Native structured body unavailable; using Markdown fallback',
            sourceRef,
            details: { reason: extraction.status, ...(extraction.status === 'decode_rejected' ? { issue: { ...extraction.issue } } : {}) },
        });
        const reasoning = parseLegacyReasoning(message.thoughts, { diagnostics: contentDiagnostics, sourceRef });
        const { citations, legacyCitations, sourceCitations } = citationsOf(message);
        const closed = closeLegacyCitations({
            ...(typeof message.id === 'string' && message.id.trim() ? { id: message.id } : {}),
            role: message.role === 'model' ? 'assistant' : 'user',
            content: message.role === 'user' ? parseGeminiPrompt(message.content)
                : parseGeminiBody(message.content, message.structuredContent, { diagnostics: contentDiagnostics, sourceRef, sourceCitations }),
            ...(typeof message.timestamp === 'number' && Number.isFinite(message.timestamp) ? { timestamp: message.timestamp } : {}),
            ...(message.model ? { model: message.model } : {}),
            ...(reasoning !== undefined ? { reasoning } : {}),
            ...(legacyCitations.length ? { citations: legacyCitations } : {}),
        }, message.groundingCitationMarkers);
        // Newly bound native sources are not evidence that literal [1] prose is a citation.
        const allCitations = [...citations, ...(closed.citations ?? []).filter(item => !citations.some(c => c.id === item.id))];
        return { ...closed, ...(allCitations.length ? { citations: allCitations } : {}) };
    });
    const resources = closeDomainResources('gemini', messages, evidence.messages.map(message => {
        // These resources were explicitly extracted from this turn; preserve its original token.
        const sourceGeneration = <T extends { isGenerated?: boolean; providerRequestId?: string; generation?: object }>(asset: T): T =>
            asset.isGenerated && message.rawProviderRequestId ? { ...asset, providerRequestId: message.rawProviderRequestId,
                ...(asset.generation ? { generation: { ...asset.generation, providerRequestId: message.rawProviderRequestId } } : {}) } : asset;
        return { input: { ...message, images: message.images?.map(sourceGeneration), attachments: message.attachments?.map(sourceGeneration) }, bodyAttachments: structuredBodyAttachments(message) };
    }), { sourceReferences: true });
    const hasMore = Boolean(evidence.nextPageToken?.trim());
    const rejected = (evidence.turnsRejected ?? 0) > 0;
    const updatedAt = evidence.updatedAt;
    const versionMismatch = updatedAt !== null && messages.some(message => message.timestamp !== undefined && message.timestamp > updatedAt);
    const metadata = evidence.metadataConversation;
    const conversation = {
        index: parseIndexMetadata({ providerId: 'gemini',
            id: normId(metadata?.id ?? evidence.id), title: metadata?.title ?? evidence.title,
            titleSource: metadata ? 'rpc' : evidence.titleSource,
            url: metadata ? `https://gemini.google.com/app/${metadata.id.replace(/^c_/, '')}` : evidence.url,
            ...(updatedAt !== null ? { updatedAt } : {}), messageCount: resources.messages.length }),
        detail: { quality: contentQuality({ status: versionMismatch ? 'partial' : 'unknown', rejectedTurns: evidence.turnsRejected,
            ...(hasMore ? { truncation: 'pagination_pending' } : {}), heuristicDocumentIds: resources.heuristicDocumentIds }),
            assets: resources.assets, messages: resources.messages },
    };
    return {
        ...(updatedAt !== null ? { sourceVersion: updatedAt } : {}),
        conversation: validateParserDomain(conversation), resourceHints: resources.resourceHints, acquisitionHints: resources.acquisitionHints,
        diagnostics: [
            ...(evidence.schemaDrift ?? []).map(message => ({ severity: 'warning' as const, code: 'GEMINI_SCHEMA_DRIFT', message })),
            ...(rejected ? [{ severity: 'warning' as const, code: 'GEMINI_TURNS_REJECTED', message: `Rejected ${evidence.turnsRejected} unrecognized source turns` }] : []),
            ...(versionMismatch ? [{ severity: 'warning' as const, code: 'CONVERSATION_VERSION_MISMATCH', message: 'Detail contains activity newer than its metadata version' }] : []),
            ...contentDiagnostics,
        ],
        transport: {
            nextPageToken: evidence.nextPageToken,
            ...(evidence._raw !== undefined ? { decodedPayload: evidence._raw } : {}),
            ...(evidence._debug !== undefined ? { debug: evidence._debug } : {}),
        },
    };
}
