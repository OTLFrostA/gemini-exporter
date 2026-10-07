import { resolveLegacyAttachments } from '../legacyAttachmentAdapter.js';
import { mapContentAssetReferences } from '../../content/assetReferences.js';
import type { GeminiNormalizationInput, GeminiNormalizationMessage } from './exportInput.js';
import type { CanonicalMessageInput } from '../../export/canonical/messageInput.js';
import { normalizeCanonicalConversation, type CanonicalNormalizationOptions as GeminiNormalizationOptions, type CanonicalNormalizationResult as GeminiNormalizationResult } from '../../export/canonical/normalizeConversation.js';
import type { Diagnostic } from '../../content/diagnostics.js';
import type { JsonValue } from '../../utils/jsonTypes.js';
import type { NormalizationContext, NormalizationResult, ProviderNormalizer } from '../../export/canonical/normalizer.js';
import { extractRawCitations } from '../../export/canonical/gemini/normalizeCitations.js';
import { parseGeminiBody, parseLegacyReasoning, structuredBodyAttachments } from './contentAdapter.js';
import { parseImportedBody } from '../importedContentAdapter.js';
export type { CanonicalNormalizationOptions as GeminiNormalizationOptions, CanonicalNormalizationResult as GeminiNormalizationResult } from '../../export/canonical/normalizeConversation.js';

function isStr(v: unknown): v is string { return typeof v === 'string'; }

export const KNOWN_CONVERSATION_FIELDS: ReadonlySet<string> = new Set([
    'id', 'title', 'timestamp', 'updatedAt', 'createdAt', 'chatTime', 'lastSeen',
    'source', 'titleSource', 'titles', 'messages', 'turns',
    'accountSlot', 'isTakeoutOnly', 'hitGoogleLimit', 'url', 'attachmentCount',
    'messageCount', 'href', 'hasExplicitPrompt',
]);

export const KNOWN_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
    'id', 'role', 'content', 'timestamp', 'turnId', 'attachments', 'thoughts',
    'thinking', 'citations', 'images', 'documents', 'attachmentCount',
    'messageCount', 'sources', 'structuredContent', 'groundingCitationMarkers',
    'reasoning', 'provenance', // Domain metadata is recognized but does not establish relationships.
]);


function prepareLegacyMessage(m: GeminiNormalizationMessage, sourceIndex: number, locator: string, providerId: string, source?: string): CanonicalMessageInput {
    const diagnostics: Diagnostic[] = [];
    const sourceRef = { providerId, ...(typeof m.id === 'string' ? { providerMessageId: m.id } : {}), locator };
    const context = { diagnostics, sourceRef, path: `${locator}.content` };
    const rawReasoning = m.thoughts ?? m.thinking ?? '';
    const reasoning = Array.isArray(rawReasoning) ? rawReasoning.join('\n\n') : rawReasoning;
    const reasoningBlocks = parseLegacyReasoning(reasoning, context);
    const resources = resolveLegacyAttachments(m, structuredBodyAttachments(m));
    const { attachments } = resources;
    const content = source?.startsWith('openai') && typeof m.content === 'string'
        ? parseImportedBody(m.content, context)
        : parseGeminiBody(m.content, m.structuredContent, context);
    return {
        message: { id: m.id, role: m.role, timestamp: m.timestamp,
            content: mapContentAssetReferences(content, resources.resolveReference),
            attachments, groundingCitationMarkers: m.groundingCitationMarkers },
        locator, sourceIndex, reasoningBlocks, citationInput: extractRawCitations(m), diagnostics,
        unknownFields: Object.keys(m).filter(key => !KNOWN_MESSAGE_FIELDS.has(key)),
    };
}

export async function normalizeGeminiConversation(
    raw: GeminiNormalizationInput,
    options: GeminiNormalizationOptions = {},
): Promise<GeminiNormalizationResult> {
    const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
    const rawTurns = Array.isArray(raw.turns) ? raw.turns : [];
    const messageInputs: Array<{ message: GeminiNormalizationMessage; locator: string }> = [];
    if (rawMessages.length) {
        rawMessages.forEach((message, index) => messageInputs.push({ message, locator: `messages[${index}]` }));
    } else if (rawTurns.length) {
        rawTurns.forEach((turn, turnIndex) => {
            if (!turn || typeof turn !== 'object') return;
            if (Array.isArray(turn.messages) && turn.messages.length) {
                turn.messages.forEach((message, index) => messageInputs.push({
                    message,
                    locator: `turns[${turnIndex}].messages[${index}]`,
                }));
                return;
            }
            if (isStr(turn.userContent) && turn.userContent) {
                messageInputs.push({
                    message: { role: 'user', content: turn.userContent, timestamp: turn.timestamp ?? undefined },
                    locator: `turns[${turnIndex}].userContent`,
                });
            }
            const hasModel = isStr(turn.modelContent) && turn.modelContent;
            if (hasModel || turn.thoughts || (turn.attachments?.length) || (turn.images?.length) || (turn.sources?.length) || turn.structuredContent) {
                messageInputs.push({
                    message: {
                        role: 'model',
                        content: hasModel ? turn.modelContent : '',
                        timestamp: turn.timestamp ?? undefined,
                        thoughts: turn.thoughts,
                        attachments: turn.attachments,
                        images: turn.images,
                        sources: turn.sources,
                        structuredContent: turn.structuredContent,
                    },
                    locator: `turns[${turnIndex}].modelContent`,
                });
            }
        });
    }
    const unknownFields = Object.keys(raw ?? {}).filter((key) => !KNOWN_CONVERSATION_FIELDS.has(key));
    const initialDiagnostics: Diagnostic[] = [];
    const semantic: CanonicalMessageInput[] = [];
    messageInputs.forEach(({ message, locator }, index) => {
        if (!message || typeof message !== 'object') {
            initialDiagnostics.push({ id: `bad-message:${locator}`, severity: 'warning', code: 'BAD_MESSAGE_SHAPE',
                message: `message at ${locator} is not an object; skipped`, sourceRef: { providerId: options.providerId ?? 'gemini', locator } });
            return;
        }
        semantic.push(prepareLegacyMessage(message, index, locator, options.providerId ?? 'gemini', raw.source));
    });
    return normalizeCanonicalConversation(raw, semantic, options, unknownFields, initialDiagnostics);
}

export class GeminiNormalizer implements ProviderNormalizer<GeminiNormalizationInput> {
    readonly providerId = 'gemini';
    private readonly options: GeminiNormalizationOptions;

    constructor(options: GeminiNormalizationOptions = {}) {
        this.options = options;
    }

    async normalize(raw: GeminiNormalizationInput, context: NormalizationContext): Promise<NormalizationResult> {
        let rawRef = this.options.rawRef;
        let rawEvidenceError: string | undefined;
        const effectiveProviderId = context.providerId || this.options.providerId || this.providerId;
        if (context.rawEvidence && !rawRef) {
            try {
                rawRef = await context.rawEvidence.put('gemini-conversation', raw);
            } catch (err) {
                rawRef = this.options.rawRef;
                rawEvidenceError = err instanceof Error ? err.message : String(err);
            }
        }
        const result = await normalizeGeminiConversation(raw, {
            ...this.options,
            rawRef,
            providerId: effectiveProviderId,
            accountId: context.accountId,
        });
        if (rawEvidenceError !== undefined) {
            const diagnostic: Diagnostic = {
                id: 'raw-evidence:write-failed',
                severity: 'warning',
                code: 'RAW_EVIDENCE_WRITE_FAILED',
                message: 'raw evidence persistence failed; continuing without an archived raw payload',
                sourceRef: { providerId: effectiveProviderId },
                details: { error: rawEvidenceError.slice(0, 300) } as JsonValue,
            };
            result.diagnostics.push(diagnostic);

        }
        return result;
    }
}
