import type {
    Attachment as RepoAttachment,
    ChatMessage as RepoMessage,
    Conversation as RepoConversation,
} from '../../../../types/conversation.js';
import type { Asset } from '../assets.js';
import { createInlineByteStore, type InlineByteStore } from '../../assets/index.js';
import type { Citation } from '../citations.js';
import type {
    CanonicalConversationBundle,
    CanonicalTitleSource,
    ConversationTitle,
    MessageNode,
    TitleCandidate,
} from '../conversation.js';
import { CANONICAL_TITLE_SOURCES } from '../conversation.js';
import type { Diagnostic } from '../diagnostics.js';
import type { JsonValue } from '../json.js';
import type {
    NormalizationContext,
    NormalizationResult,
    ProviderNormalizer,
} from '../normalizer.js';
import { projectConversation, validateMessageTree } from '../projection.js';
import type { SourceObservation } from '../provenance.js';
import { resolveTitle } from '../titleAuthority.js';
import { validateBundle } from '../validate.js';
import { normalizeMessage, toIso } from './normalizeMessage.js';
import { finalizeInlineAssetDigests } from './normalizeAssets.js';

export interface GeminiNormalizationOptions {
    providerId?: string;
    accountId?: string;
    observedAt?: string;
    rawRef?: string;
    useLegacyMarkdownParser?: boolean;
}

export interface GeminiNormalizationResult extends NormalizationResult {
    byteStore: InlineByteStore;
}

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

export const KNOWN_CONVERSATION_FIELDS: ReadonlySet<string> = new Set([
    'id', 'title', 'timestamp', 'updatedAt', 'createdAt', 'chatTime', 'lastSeen',
    'lastActiveAt', 'source', 'titleSource', 'titles', 'messages', 'turns',
    'accountSlot', 'isTakeoutOnly', 'hitGoogleLimit', 'url', 'attachmentCount',
    'messageCount', 'href', 'hasExplicitPrompt',
]);

export function canonicalTitleSource(raw: unknown, diagnostics: Diagnostic[]): CanonicalTitleSource {
    if (isStr(raw) && CANONICAL_TITLE_SOURCES.has(raw)) {
        return raw as CanonicalTitleSource;
    }
    if (isStr(raw)) {
        diagnostics.push({
            id: 'title-source-coerced',
            severity: 'info',
            code: 'TITLE_SOURCE_COERCED',
            message: `unrecognized titleSource '${raw}' coerced to 'default'; raw kept in observation`,
        });
    }
    return 'default';
}

export function normalizeTitle(raw: RepoConversation, diagnostics: Diagnostic[]): ConversationTitle | undefined {
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
        const source = canonicalTitleSource(raw.titleSource, diagnostics);
        if (!candidates.some((c) => c.value === raw.title.trim() && c.source === source)) {
            candidates.push({ value: raw.title.trim(), source });
        }
    }
    if (!candidates.length) return undefined;
    return resolveTitle(candidates);
}

function observationSourceType(source: unknown): SourceObservation['sourceType'] {
    if (isStr(source)) {
        const s = source.toLowerCase();
        if (s.includes('takeout')) return 'official-export';
        if (s.includes('live') || s.includes('rpc')) return 'live';
        if (s.includes('archive') || s.includes('import')) return 'archive-import';
        if (s.includes('legacy') || s.includes('migrat')) return 'legacy-migration';
    }
    return 'other';
}

export async function normalizeGeminiConversation(
    raw: RepoConversation,
    options: GeminiNormalizationOptions = {},
): Promise<GeminiNormalizationResult> {
    const providerId = options.providerId ?? 'gemini';
    const accountId = options.accountId ?? '';
    const observedAt = options.observedAt ?? new Date().toISOString();
    const diagnostics: Diagnostic[] = [];
    const assets: Asset[] = [];
    const citations: Citation[] = [];
    const byteStore = createInlineByteStore();

    const messages: MessageNode[] = [];
    const pushMessage = (m: RepoMessage, index: number, locator: string): void => {
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
            useLegacyMarkdownParser: options?.useLegacyMarkdownParser,
        });
        messages.push(built.node);
        assets.push(...built.assets);
        citations.push(...built.citations);
        diagnostics.push(...built.diagnostics);
    };

    const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
    const rawTurns = Array.isArray(raw.turns) ? raw.turns : [];
    if (rawMessages.length) {
        rawMessages.forEach((m, i) => pushMessage(m, i, `messages[${i}]`));
    } else if (rawTurns.length) {
        let mi = 0;
        rawTurns.forEach((t, ti) => {
            if (!t || typeof t !== 'object') return;
            if (Array.isArray(t.messages) && t.messages.length) {
                t.messages.forEach((m, i) => pushMessage(m, mi++, `turns[${ti}].messages[${i}]`));
                return;
            }
            if (isStr(t.userContent) && t.userContent) {
                pushMessage({ role: 'user', content: t.userContent, timestamp: t.timestamp ?? undefined } as RepoMessage, mi++, `turns[${ti}].userContent`);
            }
            const hasModel = isStr(t.modelContent) && t.modelContent;
            if (hasModel || t.thoughts || (t.attachments?.length) || (t.images?.length) || (t.sources?.length)) {
                pushMessage({
                    role: 'model',
                    content: hasModel ? t.modelContent as string : '',
                    timestamp: t.timestamp ?? undefined,
                    thoughts: t.thoughts as string | string[] | undefined,
                    attachments: t.attachments as RepoAttachment[] | undefined,
                    images: t.images as RepoAttachment[] | undefined,
                    sources: t.sources as unknown[] | undefined,
                } as RepoMessage, mi++, `turns[${ti}].modelContent`);
            }
        });
    } else {
        diagnostics.push({
            id: 'no-messages',
            severity: 'warning',
            code: 'NO_MESSAGES',
            message: 'conversation has neither messages nor turns; bundle will be empty',
            sourceRef: { providerId, locator: 'messages' },
        });
    }

    const title = normalizeTitle(raw, diagnostics);

    // Compute Web Crypto digests for inline data: URL assets decoded during
    // parsing, and swap their provisional byte-store refs for content-addressed
    // storageRefs before validation and return.
    await finalizeInlineAssetDigests(assets, byteStore);

    const unknownFields = Object.keys(raw ?? {}).filter((k) => !KNOWN_CONVERSATION_FIELDS.has(k));
    const observation: SourceObservation = {
        id: 'obs-gemini-normalize',
        providerId,
        sourceType: observationSourceType(raw.source),
        observedAt,
        rawCount: rawMessages.length || rawTurns.length,
        parsedCount: messages.length,
        ...(unknownFields.length ? { unknownFields } : {}),
        ...(options.rawRef ? { rawRef: options.rawRef } : {}),
        extensions: {
            gemini: {
                source: isStr(raw.source) ? raw.source : null,
                accountSlot: isStr(raw.accountSlot) ? raw.accountSlot : null,
                isTakeoutOnly: raw.isTakeoutOnly ?? null,
                titleSource: isStr(raw.titleSource) ? raw.titleSource : null,
            } as JsonValue,
        },
    };

    const convCreatedAt = toIso(raw.createdAt ?? raw.timestamp ?? raw.chatTime);
    const convUpdatedAt = toIso(raw.updatedAt ?? raw.lastSeen);
    const bundle: CanonicalConversationBundle = {
        schemaVersion: 1,
        conversation: {
            key: { providerId, accountId, conversationId: isStr(raw.id) ? raw.id : '' },
            ...(title ? { title } : {}),
            ...(convCreatedAt ? { createdAt: convCreatedAt } : {}),
            ...(convUpdatedAt ? { updatedAt: convUpdatedAt } : {}),
            observedAt,
            messages,
            ...(raw.url || raw.href
                ? { extensions: { gemini: { url: (raw.url || raw.href) as string } as JsonValue } }
                : {}),
        },
        assets,
        citations,
        observations: [observation],
        ...(diagnostics.length ? { diagnostics } : {}),
    };

    try {
        const treeIssues = validateMessageTree(bundle.conversation);
        if (treeIssues.length) {
            diagnostics.push({
                id: 'selfcheck-tree',
                severity: 'error',
                code: 'SELFCHECK_TREE_INVALID',
                message: `normalizer produced an invalid message tree: ${treeIssues[0].message}`,
            });
        } else {
            projectConversation(bundle);
        }
    } catch (err) {
        diagnostics.push({
            id: 'selfcheck-project',
            severity: 'error',
            code: 'SELFCHECK_PROJECT_FAILED',
            message: `projectConversation self-check failed: ${err instanceof Error ? err.message : String(err)}`,
        });
    }
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
    if (diagnostics.length && !bundle.diagnostics) bundle.diagnostics = diagnostics;

    return { bundle, diagnostics, byteStore };
}

export class GeminiNormalizer implements ProviderNormalizer<RepoConversation> {
    readonly providerId = 'gemini';
    private readonly options: GeminiNormalizationOptions;

    constructor(options: GeminiNormalizationOptions = {}) {
        this.options = options;
    }

    async normalize(raw: RepoConversation, context: NormalizationContext): Promise<NormalizationResult> {
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
            observedAt: context.observedAt,
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
            if (!result.bundle.diagnostics) {
                result.bundle.diagnostics = result.diagnostics;
            } else if (result.bundle.diagnostics !== result.diagnostics) {
                result.bundle.diagnostics.push(diagnostic);
            }
        }
        return result;
    }
}
