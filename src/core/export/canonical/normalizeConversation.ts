import type { Asset } from './assets.js';
import { createInlineByteStore, type InlineByteStore } from '../assets/index.js';
import type { Citation } from './citations.js';
import type {
    CanonicalConversationBundle,
    MessageNode,
} from './conversation.js';
import type { Diagnostic } from './diagnostics.js';
import type { NormalizationResult } from './normalizer.js';
import { resolveTitle, TITLE_SOURCES, type TitleSource, type TitleCandidate } from './titleAuthority.js';
import { validateBundle } from './validate.js';
import { normalizeMessage, toIso } from './normalizeMessage.js';
import type { CanonicalMessageInput } from './messageInput.js';
export type { CanonicalMessageInput } from './messageInput.js';
import { finalizeInlineAssetDigests } from './gemini/normalizeAssets.js';

export interface CanonicalNormalizationOptions {
    providerId?: string;
    accountId?: string;
    rawRef?: string;
}

export interface CanonicalNormalizationResult extends NormalizationResult {
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


function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

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

export async function normalizeCanonicalConversation(
    raw: CanonicalConversationMetadata,
    messageInputs: CanonicalMessageInput[],
    options: CanonicalNormalizationOptions = {},
    unknownFields: string[] = [],
    initialDiagnostics: Diagnostic[] = [],
): Promise<CanonicalNormalizationResult> {
    const providerId = options.providerId ?? 'gemini';
    const accountId = options.accountId ?? '';
    const diagnostics: Diagnostic[] = [...initialDiagnostics];
    const assets: Asset[] = [];
    const citations: Citation[] = [];
    const byteStore = createInlineByteStore();

    const messages: MessageNode[] = [];
    const pushMessage = (input: CanonicalMessageInput, index: number): void => {
        const { message: m, locator } = input;
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
        const ctx = { providerId, diag: diagnostics, byteStore };
        const built = normalizeMessage(input, input.sourceIndex ?? index, ctx);
        messages.push(built.node);
        assets.push(...built.assets);
        citations.push(...built.citations);
        diagnostics.push(...built.diagnostics);
    };

    if (!messageInputs.length && !diagnostics.some(d => d.code === 'BAD_MESSAGE_SHAPE')) {
        diagnostics.push({
            id: 'no-messages',
            severity: 'warning',
            code: 'NO_MESSAGES',
            message: 'conversation has neither messages nor turns; bundle will be empty',
            sourceRef: { providerId, locator: 'messages' },
        });
    }
    messageInputs.forEach(pushMessage);

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

