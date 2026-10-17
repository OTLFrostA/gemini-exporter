import { semanticTitleSource } from '../../../src/core/parsers/shared/parseIndexMetadata.js';
import { contentQuality, type ContentQuality } from '../../../src/core/parsers/qualityEvidence.js';
import { parseIndexMetadata } from '../../../src/core/parsers/shared/parseIndexMetadata.js';
import { normalizeConversationTimes } from '../../../src/core/domain/time.js';
import { structuredBodyAttachments } from './contentAdapter.js';
import { closeLegacyCitations } from '../../../src/core/parsers/shared/resources/domainCitationAdapter.js';
import { closeDomainResources } from '../../../src/core/parsers/shared/resources/domainResourceAdapter.js';
import { resolveTitle, isTitleSource } from '../../../src/core/domain/titleAuthority.js';
import { validateParserDomain } from '../../../src/core/domain/runtimeValidation.js';
import type { BlockNode } from '../../../src/core/domain/content/blocks.js';
import { parseImportedBody } from '../../../src/core/parsers/shared/importedContentAdapter.js';
import { parseGeminiBody, parseLegacyReasoning } from '../../../src/core/parsers/gemini/shared/contentAdapter.js';
import { supplementLegacyGeneratedMedia } from './generatedMediaReconciliation.js';
import type { ConversationRecordInput, ConversationRecordMessage, ConversationRecordAttachment } from './conversationRecord.js';
import type { ConversationParseContext } from '../../../src/core/parsers/contracts.js';
import type { ResourceConversationParseResult } from '../../../src/core/parsers/parsingResult.js';
import type { Diagnostic } from '../../../src/core/diagnostics/diagnostic.js';
import { isObjectRecord } from '../../../src/core/utils/messageResponses.js';
import type {
    DomainCitation,
    DomainConversationDetail,
    DomainMessage,
} from '../../../src/core/domain/conversationDetail.js';

function copyAttachment(value: ConversationRecordAttachment): ConversationRecordAttachment {
    return { ...value, ...(value.generation ? { generation: { ...value.generation } } : {}) };
}

function copyTimestamp(value: unknown): { timestamp?: number } {
    return typeof value === 'number' && Number.isFinite(value) ? { timestamp: value } : {};
}

/** Preserve provider text and the legacy nullish precedence, including empty thoughts. */
function normalizeReasoning(value: ConversationRecordMessage): string | undefined {
    const raw = value.thoughts ?? value.thinking;
    const text = Array.isArray(raw) ? raw.join('\n\n') : raw;
    return typeof text === 'string' && text.trim() ? text : undefined;
}

function normalizeCitations(value: ConversationRecordMessage): DomainCitation[] | undefined {
    const citations: DomainCitation[] = [];
    const urls = new Set<string>();
    for (const entry of [...(value.citations ?? []), ...(value.sources ?? [])]) {
        const url = typeof entry === 'string' ? entry
            : isObjectRecord(entry) && 'url' in entry ? entry.url : undefined;
        if (typeof url !== 'string' || !url.trim() || urls.has(url)) continue;
        const title = isObjectRecord(entry) && 'title' in entry ? entry.title : undefined;
        citations.push({ id: `citation-${citations.length}`, url, ...(typeof title === 'string' ? { title } : {}) });
        urls.add(url);
    }
    return citations.length ? citations : undefined;
}

function copyMessage(value: ConversationRecordMessage, parseContent: (body: unknown, structured?: unknown) => BlockNode[], parseReasoning: (body: string) => BlockNode[] | undefined): DomainMessage {
    const { id, content, timestamp } = value;
    const role = value.role === 'model' ? 'assistant' : ['user', 'assistant', 'system', 'developer'].includes(value.role ?? '') ? value.role as 'user' | 'assistant' | 'system' | 'developer' : 'unknown';
    const model = [value.model, value.author?.model].find((name): name is string => typeof name === 'string' && Boolean(name.trim()))?.trim();
    const reasoningText = normalizeReasoning(value);
    const reasoning = reasoningText !== undefined ? parseReasoning(reasoningText) : undefined;
    const citations = normalizeCitations(value);
    return closeLegacyCitations({
        ...(typeof id === 'string' && id.trim().length > 0 ? { id } : {}),
        content: parseContent(content, value.structuredContent),
        ...copyTimestamp(timestamp),
        role,
        ...(model ? { model } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(citations ? { citations } : {}),
    }, value.groundingCitationMarkers?.filter((marker): marker is string => typeof marker === 'string'));
}

function flattenLegacyTurns(conversation: ConversationRecordInput): ConversationRecordMessage[] {
    const turns = conversation.turns ?? [];
    const messages: ConversationRecordMessage[] = [];
    for (const turn of turns) {
        if (!turn || typeof turn !== 'object') continue;
        if (Array.isArray(turn.messages) && turn.messages.length > 0) {
            messages.push(...turn.messages);
            continue;
        }
        if (typeof turn.userContent === 'string' && turn.userContent) {
            messages.push({
                role: 'user',
                content: turn.userContent,
                ...copyTimestamp(turn.timestamp),
            });
        }
        const hasModel = typeof turn.modelContent === 'string' && turn.modelContent;
        if (hasModel || turn.thoughts || turn.attachments?.length || turn.images?.length || turn.sources?.length || turn.structuredContent) {
            messages.push({
                role: 'model',
                model: turn.model,
                author: turn.author,
                content: typeof turn.modelContent === 'string' && turn.modelContent ? turn.modelContent : '',
                ...copyTimestamp(turn.timestamp),
                ...(turn.thoughts !== undefined ? { thoughts: Array.isArray(turn.thoughts) ? [...turn.thoughts] : turn.thoughts } : {}),
                ...(turn.attachments ? { attachments: turn.attachments } : {}),
                ...(turn.images ? { images: turn.images } : {}),
                ...(turn.sources ? { sources: [...turn.sources] } : {}),
                ...(turn.structuredContent !== undefined ? { structuredContent: turn.structuredContent } : {}),
            });
        }
    }
    return messages;
}

/** Provider evidence accepted only while constructing Domain. */
export interface ConversationRecordParseContext extends ConversationParseContext {
    /** Detached Takeout/provider generated-media evidence, reconciled before returning Domain. */
    generatedMedia?: readonly unknown[];
    /** Migration coverage correction is applied before final schema validation. */
    qualityStatusOverride?: ContentQuality['status'];
}

/** Choose the authoritative title while raw source alternatives are still available. */
function legacyTitle(conversation: ConversationRecordInput) {
    const candidates = Object.entries(isObjectRecord(conversation.titles) ? conversation.titles : {}).flatMap(([source, value]) => typeof value === 'string' && value.trim()
        ? [{ value: value.trim(), source: semanticTitleSource(source) }] : []);
    const value = typeof conversation.title === 'string' ? conversation.title.trim() : undefined;
    const source = semanticTitleSource(typeof conversation.titleSource === "string" ? conversation.titleSource : undefined);
    if (value && !candidates.some(candidate => candidate.value === value && candidate.source === source)) candidates.push({ value, source });
    return resolveTitle(candidates);
}

/** Resolve provider media and whitelist message fields without mutating legacy input. */
export function parseConversationRecord(conversation: ConversationRecordInput, options: ConversationRecordParseContext): ResourceConversationParseResult {
    if (typeof options.providerId !== 'string' || !options.providerId.trim()) throw new TypeError('Domain providerId must be a non-empty string');
    const diagnostics: Diagnostic[] = [];
    const parserDiagnostics: Diagnostic[] = [];
    const rawMessages = conversation.messages && conversation.messages.length > 0
        ? conversation.messages
        : flattenLegacyTurns(conversation);
    // Clone provider evidence before reconciliation so legacy input remains untouched.
    let rejectedTurns = 0;
    const legacyMessages = rawMessages.flatMap((message, index) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            rejectedTurns++;
            diagnostics.push({ severity: 'warning', code: 'BAD_MESSAGE_SHAPE', message: 'Ignored malformed provider message', path: `messages[${index}]` });
            return [];
        }
        return [{
            ...message,
            ...(message.attachments ? { attachments: message.attachments.map(copyAttachment) } : {}),
            ...(message.images ? { images: message.images.map(copyAttachment) } : {}),
        }];
    });
    if (options.generatedMedia) supplementLegacyGeneratedMedia({ id: conversation.id, messages: legacyMessages }, conversation.id ?? '', options.generatedMedia, { appendMarkdownRef: false });
    const providerId = options.providerId;
    const parseContent = (body: unknown, structured?: unknown): BlockNode[] => {
        const context = { diagnostics: parserDiagnostics, sourceRef: { providerId, locator: 'content' } };
        return providerId === 'gemini' || typeof body !== 'string' ? parseGeminiBody(body, structured, context) : parseImportedBody(body, context);
    };
    const parseReasoning = providerId === 'gemini'
        ? (body: string) => parseLegacyReasoning(body, { diagnostics: parserDiagnostics, sourceRef: { providerId, locator: 'reasoning' } })
        : (body: string) => parseImportedBody(body, { diagnostics: parserDiagnostics, sourceRef: { providerId, locator: 'reasoning' } });
    for (const message of legacyMessages) {
        if (!['user', 'assistant', 'model', 'system', 'developer'].includes(message.role ?? '')) diagnostics.push({ severity: 'warning', code: 'UNKNOWN_ROLE', message: `Unrecognized role '${message.role ?? ''}'; preserved as an unknown message` });
    }
    const resources = closeDomainResources(providerId, legacyMessages.map(message => copyMessage(message, parseContent, parseReasoning)),
        legacyMessages.map(message => ({ input: message, bodyAttachments: providerId === 'gemini' ? structuredBodyAttachments(message) : [] })));
    const title = legacyTitle(conversation);
    const sourceVersion = normalizeConversationTimes({ updatedAt: conversation.updatedAt }).updatedAt;
    const domain = {
        index: parseIndexMetadata({ account: options.account, providerId, id: conversation.id ?? '', title: title?.value ?? '',
            ...(title ? { titleSource: title.source } : {}), ...normalizeConversationTimes({ createdAt: conversation.createdAt }),
            ...(sourceVersion !== undefined ? { updatedAt: sourceVersion } : {}), messageCount: resources.messages.length,
            ...(conversation.url || conversation.href ? { url: conversation.url || conversation.href } : {}) }),
        detail: { assets: resources.assets, messages: resources.messages,
            quality: contentQuality({ status: options.qualityStatusOverride ?? conversation.completeness?.status ?? 'unknown', rejectedTurns,
                ...(conversation.truncated === true || conversation.isTruncated === true || conversation.nextPageToken?.trim()
                    ? { truncation: conversation.truncateReason || (conversation.nextPageToken?.trim() ? 'pagination_pending' : 'truncated') } : {}),
                heuristicDocumentIds: resources.heuristicDocumentIds }) },
    };
    return { evidence: { rejectedTurns, ...(conversation.truncated === true || conversation.isTruncated === true || conversation.nextPageToken?.trim()
        ? { truncation: conversation.truncateReason || (conversation.nextPageToken?.trim() ? 'pagination_pending' : 'truncated') } : {}), heuristicDocumentIds: resources.heuristicDocumentIds }, ...(sourceVersion !== undefined ? { sourceVersion } : {}), account: options.account, conversation: validateParserDomain(domain), resourceHints: resources.resourceHints, acquisitionHints: resources.acquisitionHints, diagnostics: [...diagnostics, ...parserDiagnostics] };
}
