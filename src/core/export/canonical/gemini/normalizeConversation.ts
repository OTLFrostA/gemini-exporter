import { reconcileLegacyMediaLists } from '../../../domain/legacyGeneratedMediaReconciliation.js';
import type { GeminiNormalizationInput, GeminiNormalizationMessage } from './normalizationInput.js';
import type { Asset } from '../assets.js';
import { createInlineByteStore, type InlineByteStore } from '../../assets/index.js';
import type { Citation } from '../citations.js';
import type {
    CanonicalConversationBundle,
    MessageNode,
} from '../conversation.js';
import type { Diagnostic } from '../diagnostics.js';
import type { JsonValue } from '../json.js';
import type {
    NormalizationContext,
    NormalizationResult,
    ProviderNormalizer,
} from '../normalizer.js';
import { resolveTitle, TITLE_SOURCES, type TitleSource, type TitleCandidate } from '../titleAuthority.js';
import { validateBundle } from '../validate.js';
import { normalizeMessage, toIso } from './normalizeMessage.js';
import { finalizeInlineAssetDigests } from './normalizeAssets.js';

export interface GeminiNormalizationOptions {
    providerId?: string;
    accountId?: string;
    rawRef?: string;
}

export interface GeminiNormalizationResult extends NormalizationResult {
    byteStore: InlineByteStore;
}

export interface CanonicalConversationMetadata {
    id?: string;
    title?: string;
    titleSource?: unknown;
    titles?: unknown;
    timestamp?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
    chatTime?: unknown;
    lastSeen?: unknown;
    url?: string;
    href?: string;
}

export interface CanonicalMessageInput {
    message: GeminiNormalizationMessage;
    locator: string;
}

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

export const KNOWN_CONVERSATION_FIELDS: ReadonlySet<string> = new Set([
    'id', 'title', 'timestamp', 'updatedAt', 'createdAt', 'chatTime', 'lastSeen',
    'source', 'titleSource', 'titles', 'messages', 'turns',
    'accountSlot', 'isTakeoutOnly', 'hitGoogleLimit', 'url', 'attachmentCount',
    'messageCount', 'href', 'hasExplicitPrompt',
]);

export function canonicalTitleSource(raw: unknown, diagnostics: Diagnostic[]): TitleSource {
    if (isStr(raw) && TITLE_SOURCES.has(raw)) {
        return raw as TitleSource;
    }
    if (isStr(raw)) {
        diagnostics.push({
            id: 'title-source-coerced',
            severity: 'info',
            code: 'TITLE_SOURCE_COERCED',
            message: `unrecognized titleSource '${raw}' coerced to 'default'; raw source reported in diagnostic`,
        });
    }
    return 'default';
}

export function normalizeTitle(raw: CanonicalConversationMetadata, diagnostics: Diagnostic[]): string | undefined {
    const candidates: TitleCandidate[] = [];
    const titles = raw.titles;
    if (titles && typeof titles === 'object') {
        for (const [src, val] of Object.entries(titles)) {
            if (isStr(val) && val.trim()) {
                candidates.push({ value: val.trim(), source: canonicalTitleSource(src, diagnostics) });
            }
        }
    }
    if (isStr(raw.title) && raw.title.trim()) {
        const title = raw.title.trim();
        const source = canonicalTitleSource(raw.titleSource, diagnostics);
        if (!candidates.some((c) => c.value === title && c.source === source)) {
            candidates.push({ value: raw.title.trim(), source });
        }
    }
    if (!candidates.length) return undefined;
    return resolveTitle(candidates)?.value;
}

export async function normalizeGeminiConversation(
    raw: GeminiNormalizationInput,
    options: GeminiNormalizationOptions = {},
): Promise<GeminiNormalizationResult> {
    const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
    const rawTurns = Array.isArray(raw.turns) ? raw.turns : [];
    const messageInputs: CanonicalMessageInput[] = [];
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
    for (const input of messageInputs) {
        const m = input.message;
        if ([...(m.attachments ?? []), ...(m.images ?? [])].some(a => a.isGenerated || a.generation || a.providerRequestId)) {
            input.message = { ...m, attachments: reconcileLegacyMediaLists(m.attachments ?? [], m.images ?? []), images: undefined };
        }
    }
    const unknownFields = Object.keys(raw ?? {}).filter((key) => !KNOWN_CONVERSATION_FIELDS.has(key));
    return normalizeCanonicalConversation(raw, messageInputs, options, unknownFields);
}

export async function normalizeCanonicalConversation(
    raw: CanonicalConversationMetadata,
    messageInputs: CanonicalMessageInput[],
    options: GeminiNormalizationOptions = {},
    unknownFields: string[] = [],
): Promise<GeminiNormalizationResult> {
    const providerId = options.providerId ?? 'gemini';
    const accountId = options.accountId ?? '';
    const diagnostics: Diagnostic[] = [];
    const assets: Asset[] = [];
    const citations: Citation[] = [];
    const byteStore = createInlineByteStore();

    const messages: MessageNode[] = [];
    const pushMessage = (m: GeminiNormalizationMessage, index: number, locator: string): void => {
        if (!m || typeof m !== 'object') {
            diagnostics.push({
                id: `bad-message:${locator}`,
                severity: 'warning',
                code: 'BAD_MESSAGE_SHAPE',
                message: `message at ${locator} is not an object; skipped`,
                sourceRef: { providerId, locator },
            });
            return;
        }
        const built = normalizeMessage(m, index, locator, {
            providerId,
            diag: diagnostics,
            byteStore,
        });
        messages.push(built.node);
        assets.push(...built.assets);
        citations.push(...built.citations);
        diagnostics.push(...built.diagnostics);
    };

    if (!messageInputs.length) {
        diagnostics.push({
            id: 'no-messages',
            severity: 'warning',
            code: 'NO_MESSAGES',
            message: 'conversation has neither messages nor turns; bundle will be empty',
            sourceRef: { providerId, locator: 'messages' },
        });
    }
    messageInputs.forEach(({ message, locator }, index) => pushMessage(message, index, locator));

    const title = normalizeTitle(raw, diagnostics);

    // Compute Web Crypto digests for inline data: URL assets decoded during
    // parsing, and swap their provisional byte-store refs for content-addressed
    // storageRefs before validation and return.
    await finalizeInlineAssetDigests(assets, byteStore);

    if (unknownFields.length) {
        diagnostics.push({ id: 'unknown-conversation-fields', severity: 'info', code: 'UNKNOWN_CONVERSATION_FIELDS',
            message: 'unrecognized conversation fields omitted from the document', details: { fields: unknownFields } });
    }

    const convCreatedAt = toIso(raw.createdAt ?? raw.timestamp ?? raw.chatTime);
    const convUpdatedAt = toIso(raw.updatedAt ?? raw.lastSeen);
    const bundle: CanonicalConversationBundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId, accountId, conversationId: isStr(raw.id) ? raw.id : '' },
            ...(title ? { title } : {}),
            ...(convCreatedAt ? { createdAt: convCreatedAt } : {}),
            ...(convUpdatedAt ? { updatedAt: convUpdatedAt } : {}),
            messages,
            ...(raw.url || raw.href
                ? { url: raw.url || raw.href }
                : {}),
        },
        assets,
        citations,
    };

    try {
        const issues = validateBundle(bundle);
        for (const issue of issues) {
            if (issue.severity === 'error' && !diagnostics.some((d) => d.id === issue.id)) {
                diagnostics.push(issue);
            }
        }
    } catch (err) {
        diagnostics.push({
            id: 'selfcheck-validate',
            severity: 'error',
            code: 'SELFCHECK_VALIDATE_FAILED',
            message: `validateBundle self-check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }

    return { bundle, diagnostics, byteStore };
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
