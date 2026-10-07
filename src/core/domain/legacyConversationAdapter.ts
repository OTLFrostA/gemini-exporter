import { closeLegacyCitations } from '../provider/domainCitationAdapter.js';
import { closeDomainResources } from '../provider/domainResourceAdapter.js';
import { resolveTitle, TITLE_SOURCES, type TitleSource } from './titleAuthority.js';
import { assertDomainClosure } from './closure.js';
import type { BlockNode } from '../content/blocks.js';
import { parseImportedBody } from '../provider/importedContentAdapter.js';
import { parseGeminiBody, parseLegacyReasoning, structuredBodyAttachments } from '../provider/gemini/contentAdapter.js';
import { supplementLegacyGeneratedMedia, type LegacyGeneratedMediaEvidence } from './legacyGeneratedMediaReconciliation.js';
import type { Conversation, ChatMessage, Attachment, GeneratedMediaIdentity } from '../../types/conversation.js';
import type {
    DomainCitation,
    DomainConversationDetail,
    DomainGeneratedMediaIdentity,
    DomainMessage,
    DomainMessageProvenance,
} from './conversationDetail.js';

function copyGeneratedMedia(value: GeneratedMediaIdentity): DomainGeneratedMediaIdentity {
    return { ...value };
}

function copyAttachment(value: Attachment): Attachment {
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
function normalizeReasoning(value: ChatMessage): string | undefined {
    const raw = value.thoughts ?? value.thinking;
    const text = Array.isArray(raw) ? raw.join('\n\n') : raw;
    return typeof text === 'string' && text.trim() ? text : undefined;
}

function normalizeCitations(value: ChatMessage): DomainCitation[] | undefined {
    const citations: DomainCitation[] = [];
    const urls = new Set<string>();
    for (const entry of [...(value.citations ?? []), ...(value.sources ?? [])]) {
        const url = typeof entry === 'string' ? entry
            : entry && typeof entry === 'object' && 'url' in entry ? entry.url : undefined;
        if (typeof url !== 'string' || !url.trim() || urls.has(url)) continue;
        const title = entry && typeof entry === 'object' && 'title' in entry ? entry.title : undefined;
        citations.push({ id: `citation-${citations.length}`, url, ...(typeof title === 'string' ? { title } : {}) });
        urls.add(url);
    }
    return citations.length ? citations : undefined;
}

function copyMessage(value: ChatMessage, parseContent: (body: string, structured?: unknown) => BlockNode[], parseReasoning: (body: string) => BlockNode[] | undefined): DomainMessage {
    const { id, content, timestamp } = value;
    if (typeof content !== 'string') {
        throw new TypeError('Legacy message content must be a string');
    }
    const provenance = normalizeMessageProvenance(value.providerRequestId);
    const reasoningText = normalizeReasoning(value);
    const reasoning = reasoningText !== undefined ? parseReasoning(reasoningText) : undefined;
    const citations = normalizeCitations(value);
    return closeLegacyCitations({
        ...(typeof id === 'string' && id.trim().length > 0 ? { id } : {}),
        content: parseContent(content, value.structuredContent),
        ...copyTimestamp(timestamp),
        role: value.role === 'model' ? 'assistant' : value.role,
        ...(provenance ? { provenance } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(citations ? { citations } : {}),
    }, value.groundingCitationMarkers);
}

function flattenLegacyTurns(conversation: Conversation): ChatMessage[] {
    const turns = conversation.turns ?? [];
    const messages: ChatMessage[] = [];
    for (const turn of turns) {
        if (!turn || typeof turn !== 'object') continue;
        if (Array.isArray(turn.messages) && turn.messages.length > 0) {
            messages.push(...turn.messages);
            continue;
        }
        if ((turn.userContent !== undefined && typeof turn.userContent !== 'string')
            || (turn.modelContent !== undefined && typeof turn.modelContent !== 'string')) {
            throw new TypeError('Legacy message content must be a string');
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
    generatedMedia?: readonly LegacyGeneratedMediaEvidence[];
}

/** Choose the authoritative title while raw source alternatives are still available. */
function legacyTitle(conversation: Conversation): string {
    const candidates = Object.entries(conversation.titles ?? {}).flatMap(([source, value]) => typeof value === 'string' && value.trim()
        ? [{ value: value.trim(), source: (TITLE_SOURCES.has(source) ? source : 'default') as TitleSource }] : []);
    const value = conversation.title?.trim();
    const source = (TITLE_SOURCES.has(conversation.titleSource ?? '') ? conversation.titleSource : 'default') as TitleSource;
    if (value && !candidates.some(candidate => candidate.value === value && candidate.source === source)) candidates.push({ value, source });
    return resolveTitle(candidates)?.value ?? '';
}

/** Resolve provider media and whitelist message fields without mutating legacy input. */
export function toDomainConversationDetail(conversation: Conversation, options: LegacyDomainConstructionOptions = {}): DomainConversationDetail {
    const rawMessages = conversation.messages && conversation.messages.length > 0
        ? conversation.messages
        : flattenLegacyTurns(conversation);
    // Clone provider evidence before reconciliation so legacy input remains untouched.
    const legacyMessages = rawMessages.map(message => ({
        ...message,
        ...(message.generation ? { generation: { ...message.generation } } : {}),
        ...(message.attachments ? { attachments: message.attachments.map(copyAttachment) } : {}),
        ...(message.images ? { images: message.images.map(copyAttachment) } : {}),
    }));
    if (options.generatedMedia) supplementLegacyGeneratedMedia({ id: conversation.id, messages: legacyMessages }, conversation.id, options.generatedMedia, { appendMarkdownRef: false });
    const providerId = options.providerId ?? (conversation.source?.startsWith('openai') ? 'openai' : 'gemini');
    const parseContent = providerId === 'gemini' ? parseGeminiBody : (body: string): BlockNode[] => parseImportedBody(body);
    const parseReasoning = providerId === 'gemini'
        ? (body: string) => parseLegacyReasoning(body, { diagnostics: [], sourceRef: { providerId, locator: 'reasoning' } })
        : (body: string) => parseImportedBody(body, { diagnostics: [], sourceRef: { providerId, locator: 'reasoning' } });
    const resources = closeDomainResources(providerId, legacyMessages.map(message => copyMessage(message, parseContent, parseReasoning)),
        legacyMessages.map(message => ({ input: message, bodyAttachments: providerId === 'gemini' ? structuredBodyAttachments(message) : [] })));
    const domain: DomainConversationDetail = {
        providerId,
        assets: resources.assets,
        id: conversation.id,
        title: legacyTitle(conversation),
        timestamp: conversation.timestamp,
        ...(conversation.updatedAt !== undefined ? { updatedAt: conversation.updatedAt } : {}),
        ...(conversation.createdAt !== undefined ? { createdAt: conversation.createdAt } : {}),
        ...(conversation.chatTime !== undefined ? { chatTime: conversation.chatTime } : {}),
        ...(conversation.lastSeen !== undefined ? { lastSeen: conversation.lastSeen } : {}),
        ...(conversation.url !== undefined ? { url: conversation.url } : {}),
        ...(conversation.href !== undefined ? { href: conversation.href } : {}),
        ...(conversation.titleSource !== undefined ? { titleSource: conversation.titleSource } : {}),
        ...(conversation.titles !== undefined ? { titles: { ...conversation.titles } } : {}),
        messages: resources.messages,
    };
    assertDomainClosure(domain);
    return domain;
}
