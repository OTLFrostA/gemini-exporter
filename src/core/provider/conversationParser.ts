import { closeLegacyCitations } from './domainCitationAdapter.js';
import { closeDomainResources } from './domainResourceAdapter.js';
import { resolveTitle, TITLE_SOURCES, type TitleSource } from '../domain/titleAuthority.js';
import { assertDomainClosure } from '../domain/closure.js';
import type { ResourceAcquisitionHints } from '../export/assets/resourceAcquisitionHints.js';
import type { LegacyResourceHints } from '../export/assets/resourceHints.js';
import type { BlockNode } from '../content/blocks.js';
import { parseImportedBody } from './importedContentAdapter.js';
import { parseGeminiBody, parseLegacyReasoning, structuredBodyAttachments } from './gemini/contentAdapter.js';
import { supplementLegacyGeneratedMedia } from '../domain/legacyGeneratedMediaReconciliation.js';
import type { GeneratedMediaIdentity } from '../../types/conversation.js';
import type { GeminiNormalizationInput, GeminiNormalizationMessage, GeminiNormalizationAttachment } from './gemini/exportInput.js';
import type { DocumentDiagnostic } from '../diagnostics/documentDiagnostic.js';
import type { Diagnostic } from '../content/diagnostics.js';
import { isObjectRecord } from '../utils/messageResponses.js';
import type {
    DomainCitation,
    DomainConversationDetail,
    DomainGeneratedMediaIdentity,
    DomainMessage,
    DomainMessageProvenance,
} from '../domain/conversationDetail.js';

function copyGeneratedMedia(value: GeneratedMediaIdentity): DomainGeneratedMediaIdentity {
    return { ...value };
}

function copyAttachment(value: GeminiNormalizationAttachment): GeminiNormalizationAttachment {
    return {
        ...value,
        ...(value.generation ? { generation: copyGeneratedMedia(value.generation) } : {}),
    };
}

function copyTimestamp(value: unknown): { timestamp?: number } {
    return typeof value === 'number' && Number.isFinite(value) ? { timestamp: value } : {};
}

function normalizeMessageProvenance(value: unknown): DomainMessageProvenance | undefined {
    if (typeof value !== 'string') return undefined;
    const providerRequestId = value.trim();
    return providerRequestId ? { providerRequestId } : undefined;
}

/** Preserve provider text and the legacy nullish precedence, including empty thoughts. */
function normalizeReasoning(value: GeminiNormalizationMessage): string | undefined {
    const raw = value.thoughts ?? value.thinking;
    const text = Array.isArray(raw) ? raw.join('\n\n') : raw;
    return typeof text === 'string' && text.trim() ? text : undefined;
}

function normalizeCitations(value: GeminiNormalizationMessage): DomainCitation[] | undefined {
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

function copyMessage(value: GeminiNormalizationMessage, parseContent: (body: unknown, structured?: unknown) => BlockNode[], parseReasoning: (body: string) => BlockNode[] | undefined): DomainMessage {
    const { id, content, timestamp } = value;
    const role = value.role === 'model' ? 'assistant' : ['user', 'assistant', 'system', 'developer'].includes(value.role ?? '') ? value.role as 'user' | 'assistant' | 'system' | 'developer' : 'unknown';
    const provenance = { ...normalizeMessageProvenance(value.providerRequestId), ...(role === 'unknown' && value.role ? { rawRole: value.role } : {}) };
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
        ...(Object.keys(provenance).length ? { provenance } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(citations ? { citations } : {}),
    }, value.groundingCitationMarkers?.filter((marker): marker is string => typeof marker === 'string'));
}

function flattenLegacyTurns(conversation: GeminiNormalizationInput): GeminiNormalizationMessage[] {
    const turns = conversation.turns ?? [];
    const messages: GeminiNormalizationMessage[] = [];
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
                ...(turn.attachments ? { attachments: turn.attachments.map(copyAttachment) } : {}),
                ...(turn.images ? { images: turn.images.map(copyAttachment) } : {}),
                ...(turn.sources ? { sources: [...turn.sources] } : {}),
                ...(turn.structuredContent !== undefined ? { structuredContent: turn.structuredContent } : {}),
            });
        }
    }
    return messages;
}

/** Provider evidence accepted only while constructing Domain. */
export interface LegacyDomainConstructionOptions {
    /** Explicit producer identity; inferred from the legacy source only at this boundary. */
    providerId?: string;
    /** Detached Takeout/provider generated-media evidence, reconciled before returning Domain. */
    generatedMedia?: readonly unknown[];
}

/** Choose the authoritative title while raw source alternatives are still available. */
function legacyTitle(conversation: GeminiNormalizationInput): string {
    const candidates = Object.entries(isObjectRecord(conversation.titles) ? conversation.titles : {}).flatMap(([source, value]) => typeof value === 'string' && value.trim()
        ? [{ value: value.trim(), source: (TITLE_SOURCES.has(source) ? source : 'default') as TitleSource }] : []);
    const value = typeof conversation.title === 'string' ? conversation.title.trim() : undefined;
    const source = (typeof conversation.titleSource === 'string' && TITLE_SOURCES.has(conversation.titleSource) ? conversation.titleSource : 'default') as TitleSource;
    if (value && !candidates.some(candidate => candidate.value === value && candidate.source === source)) candidates.push({ value, source });
    return resolveTitle(candidates)?.value ?? '';
}

/** Resolve provider media and whitelist message fields without mutating legacy input. */
export function parseProviderConversation(conversation: GeminiNormalizationInput, options: LegacyDomainConstructionOptions = {}): { conversation: DomainConversationDetail; resourceHints: LegacyResourceHints; acquisitionHints: ResourceAcquisitionHints; diagnostics: DocumentDiagnostic[] } {
    const diagnostics: DocumentDiagnostic[] = [];
    const parserDiagnostics: Diagnostic[] = [];
    const rawMessages = conversation.messages && conversation.messages.length > 0
        ? conversation.messages
        : flattenLegacyTurns(conversation);
    // Clone provider evidence before reconciliation so legacy input remains untouched.
    const legacyMessages = rawMessages.flatMap((message, index) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
            diagnostics.push({ severity: 'warning', code: 'BAD_MESSAGE_SHAPE', message: 'Ignored malformed provider message', path: `messages[${index}]` });
            return [];
        }
        return [{
        ...message,
        ...(message.generation ? { generation: { ...message.generation } } : {}),
        ...(message.attachments ? { attachments: message.attachments.map(copyAttachment) } : {}),
        ...(message.images ? { images: message.images.map(copyAttachment) } : {}),
        }];
    });
    if (options.generatedMedia) supplementLegacyGeneratedMedia({ id: conversation.id, messages: legacyMessages }, conversation.id ?? '', options.generatedMedia, { appendMarkdownRef: false });
    const providerId = options.providerId ?? (conversation.source?.startsWith('openai') ? 'openai' : 'gemini');
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
    const domain: DomainConversationDetail = {
        providerId,
        assets: resources.assets,
        id: conversation.id ?? '',
        title: legacyTitle(conversation),
        timestamp: typeof conversation.timestamp === 'number' ? conversation.timestamp : null,
        ...(conversation.updatedAt === null || typeof conversation.updatedAt === 'number' || typeof conversation.updatedAt === 'string' ? { updatedAt: conversation.updatedAt } : {}),
        ...(conversation.createdAt === null || typeof conversation.createdAt === 'number' || typeof conversation.createdAt === 'string' ? { createdAt: conversation.createdAt } : {}),
        ...(typeof conversation.chatTime === 'number' || typeof conversation.chatTime === 'string' ? { chatTime: conversation.chatTime } : {}),
        ...(typeof conversation.lastSeen === 'number' || typeof conversation.lastSeen === 'string' ? { lastSeen: conversation.lastSeen } : {}),
        ...(conversation.url !== undefined ? { url: conversation.url } : {}),
        ...(conversation.href !== undefined ? { href: conversation.href } : {}),
        ...(typeof conversation.titleSource === 'string' ? { titleSource: conversation.titleSource } : {}),
        ...(isObjectRecord(conversation.titles) ? { titles: Object.fromEntries(Object.entries(conversation.titles).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) } : {}),
        messages: resources.messages,
    };
    assertDomainClosure(domain);
    return { conversation: domain, resourceHints: resources.resourceHints, acquisitionHints: resources.acquisitionHints, diagnostics: [...diagnostics, ...parserDiagnostics.map(d => ({ severity: d.severity, code: d.code, message: d.message, path: d.path }))] };
}
