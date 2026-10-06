import type { DomainMessage } from '../../../domain/conversationDetail.js';
import type { GeminiNormalizationMessage } from './normalizationInput.js';
import type { Asset } from '../assets.js';
import { collectReferencedAssetIds } from '../assetReferences.js';
import type { BlockNode } from '../../../content/blocks.js';
import type { Citation } from '../citations.js';
import type { MessageNode, MessageRole } from '../conversation.js';
import type { Diagnostic } from '../diagnostics.js';
import type { JsonValue } from '../json.js';
import type { SourceRef } from '../provenance.js';
import type { InlineByteStore } from '../../assets/index.js';
import {
    type AssetParserContext,
    linkInlineImage,
    buildAsset,
    indexAssetRef,
    mergeMessageAttachments,
    newAssetLinkIndex,
} from './normalizeAssets.js';
import { convertHtmlToMarkdown } from '../../../engine/formatters/htmlConverter.js';
import { stripInternalChipMarkdown } from '../../../utils/chipUtils.js';
import { type MarkdownParseContext, parseMarkdownToBlocks } from '../../../content/markdown/index.js';
import {
    extractRawCitations,
    linkCitationMarkers,
} from './normalizeCitations.js';
import { parseGeminiBody } from '../../../provider/gemini/contentAdapter.js';
import { preprocessGeminiMarkdown } from '../../../provider/gemini/markdownCompatibility.js';
import { mapContentAssetReferences } from '../../../content/assetReferences.js';

export const KNOWN_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
    'id', 'role', 'content', 'timestamp', 'turnId', 'attachments', 'thoughts',
    'thinking', 'citations', 'images', 'documents', 'attachmentCount',
    'messageCount', 'sources', 'structuredContent', 'groundingCitationMarkers',
    'contentAst', 'reasoning', 'provenance', // Domain metadata is recognized but does not establish relationships.
]);

function isStr(v: unknown): v is string {
    return typeof v === 'string';
}

export function toIso(value: unknown): string | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    if (typeof value === 'string') {
        const s = value.trim();
        if (!s) return undefined;
        if (/^-?\d+$/.test(s)) return toIso(Number(s));
        const t = Date.parse(s);
        return Number.isNaN(t) ? undefined : new Date(t).toISOString();
    }
    return undefined;
}

export function mapRole(role: unknown): { role: MessageRole; rawRole?: string } {
    if (role === 'user') return { role: 'user' };
    if (role === 'model' || role === 'assistant') return { role: 'assistant' };
    if (role === 'system') return { role: 'system' };
    return { role: 'unknown', rawRole: isStr(role) ? role : undefined };
}

export interface MessageBuild {
    node: MessageNode;
    assets: Asset[];
    citations: Citation[];
    diagnostics: Diagnostic[];
}

export function cleanBody(text: unknown): string {
    if (typeof text !== 'string' || !text) return '';
    return stripInternalChipMarkdown(convertHtmlToMarkdown(text));
}

type MessageContext = { providerId: string; diag: Diagnostic[]; byteStore: InlineByteStore };

/** Compatibility for raw/legacy input ends before shared canonical construction. */
export function normalizeMessage(
    m: GeminiNormalizationMessage, index: number, locator: string, ctx: MessageContext,
): MessageBuild {
    const raw = m.thoughts ?? m.thinking ?? '';
    const reasoning = Array.isArray(raw) ? raw.join('\n\n') : raw;
    return normalizeCanonicalMessage(m, index, locator, ctx, reasoning, extractRawCitations(m));
}

export function normalizeDomainMessage(
    message: DomainMessage, index: number, locator: string, ctx: MessageContext,
): MessageBuild {
    return normalizeCanonicalMessage(message, index, locator, ctx, message.reasoning,
        extractRawCitations({ citations: message.citations }), message.contentAst);
}

function normalizeCanonicalMessage(
    m: Omit<GeminiNormalizationMessage, 'thoughts' | 'thinking' | 'sources'>,
    index: number,
    locator: string,
    ctx: MessageContext,
    reasoning: unknown,
    citationInput: ReturnType<typeof extractRawCitations>,
    contentAst?: BlockNode[],
): MessageBuild {
    const diagnostics: Diagnostic[] = [];
    const msgId = isStr(m.id) && m.id ? m.id : `msg-${index}`;
    if (msgId !== m.id) {
        diagnostics.push({
            id: `synth-id:${msgId}`,
            severity: 'info',
            code: 'SYNTHESIZED_MESSAGE_ID',
            message: `message at ${locator} had no id; assigned deterministic ${msgId}`,
        });
    }
    const sourceRef: SourceRef = {
        providerId: ctx.providerId,
        ...(isStr(m.id) ? { providerMessageId: m.id } : {}),
        locator,
    };
    const { role, rawRole } = mapRole(m.role);
    if (role === 'unknown') {
        diagnostics.push({
            id: `unknown-role:${msgId}`,
            severity: 'info',
            code: 'UNKNOWN_ROLE',
            message: `unrecognized role mapped to 'unknown'`,
            sourceRef,
            details: { rawRole: rawRole ?? null } as JsonValue,
        });
    }

    const idPrefix = msgId;

    // Index attachments before markdown parsing so inline ![alt](src) nodes can link to their Asset IDs.
    const merged = mergeMessageAttachments(m);
    const attachmentBlocks: BlockNode[] = [];
    const assets: Asset[] = [];
    const assetIndex = newAssetLinkIndex();
    merged.forEach((a, ai) => {
        const assetId = `${msgId}-a${ai}`;
        const built = buildAsset(a, assetId, { ...sourceRef, locator: `${locator}.attachments[${ai}]` }, ctx.byteStore);
        assets.push(built.asset);
        for (const ref of [a.localName, a.url, a.sourceUrl, a.resolvedUrl, a.src]) {
            if (typeof ref === 'string' && ref) {
                indexAssetRef(assetIndex, ref, assetId);
            }
        }
        diagnostics.push(...built.diagnostics);
        if (built.isImage) {
            attachmentBlocks.push({
                type: 'image', assetId,
                alt: built.asset.name,
            });
        } else {
            attachmentBlocks.push({
                type: 'file', assetId,
                label: built.asset.name,
            });
        }
    });

    const st: MarkdownParseContext & AssetParserContext = {
        diagnostics, sourceRef, assetIndex, inlineAssets: [], idPrefix, byteStore: ctx.byteStore,
        resolveImage: (ref, alt, title) => linkInlineImage(ref, alt, title, st),
    };
    const blocks: BlockNode[] = [];

    const thoughtsText = cleanBody(reasoning);
    if (thoughtsText.trim()) {
        blocks.push({
            type: 'thought',
            disclosure: 'providerExposed',
            kind: 'reasoning',
            blocks: parseMarkdownToBlocks(preprocessGeminiMarkdown(thoughtsText), idPrefix, st),
        });
    }

    const usedStructured = contentAst !== undefined;
    if (contentAst !== undefined) {
        blocks.push(...mapContentAssetReferences(contentAst, (ref, kind, alt, title) => {
            if (assets.some(asset => asset.id === ref)) return ref;
            if (kind === 'file') return assetIndex.byRef.get(ref) ?? ref;
            return linkInlineImage(ref, alt ?? '', title, st).assetId;
        }));
    }
    if (!usedStructured) blocks.push(...parseGeminiBody(m.content, m.structuredContent, st));

    for (const ia of st.inlineAssets) {
        assets.push(ia);
    }
    const placedAssetIds = collectReferencedAssetIds(blocks);
    for (const block of attachmentBlocks) {
        if (block.type !== 'image' && block.type !== 'file') {
            blocks.push(block);
            continue;
        }
        if (!placedAssetIds.has(block.assetId)) {
            blocks.push(block);
        }
    }

    const citations: Citation[] = [];
    const webCitations: Citation[] = [];
    const { list: rawCits, skipped } = citationInput;
    if (skipped > 0) {
        diagnostics.push({
            id: `citation-skipped:${msgId}`,
            severity: 'info',
            code: 'CITATION_SKIPPED',
            message: `${skipped} citation/source entries had no usable URL and were skipped`,
            sourceRef,
        });
    }
    rawCits.forEach((rc, ci) => {
        const cid = `${msgId}-cit${ci}`;
        let kind: Citation['kind'] = 'web';
        if (!rc.url) kind = 'other';
        else if (!/^https?:\/\//i.test(rc.url)) kind = 'other';
        const cit: Citation = {
            id: cid,
            kind,
            url: rc.url,
            title: rc.title,
        };
        citations.push(cit);
        webCitations.push(cit);
    });

    const groundingMap = new Map<string, { citation: Citation; displayLabel: string }>();
    if (Array.isArray(m.groundingCitationMarkers) && m.groundingCitationMarkers.length > 0) {
        for (const rawMarker of m.groundingCitationMarkers) {
            if (typeof rawMarker !== 'string') continue;
            const marker = rawMarker.trim();
            const numMatch = marker.match(/\d+/);
            const n = numMatch ? numMatch[0] : '1';
            const displayLabel = `[${n}]`;
            const cid = `${msgId}-gcit-${n}`;
            let cit = citations.find((c) => c.id === cid);
            if (!cit) {
                cit = {
                    id: cid,
                    kind: 'attachment',
                };
                citations.push(cit);
            }
            groundingMap.set(marker, { citation: cit, displayLabel });
            const normKey = marker.toLowerCase().replace(/\s+/g, ' ');
            if (normKey !== marker) {
                groundingMap.set(normKey, { citation: cit, displayLabel });
            }
        }
    }

    if (webCitations.length > 0 || groundingMap.size > 0) {
        const reconciled = structuredClone(blocks);
        linkCitationMarkers(reconciled, webCitations, groundingMap);
        blocks.splice(0, blocks.length, ...reconciled);
    }

    const unknownFields = Object.keys(m ?? {}).filter((k) => !KNOWN_MESSAGE_FIELDS.has(k));
    if (unknownFields.length) {
        diagnostics.push({ id: `unknown-message-fields:${msgId}`, severity: 'info', code: 'UNKNOWN_MESSAGE_FIELDS',
            message: 'unrecognized message fields omitted from the document', sourceRef, details: { fields: unknownFields } });
    }
    const createdAt = toIso(m.timestamp);
    const node: MessageNode = {
        id: msgId,
        role,
        ...(rawRole ? { author: { rawRole } } : {}),
        ...(createdAt ? { createdAt } : {}),
        blocks,
        ...(citations.length ? { citationIds: citations.map((c) => c.id) } : {}),
    };
    return { node, assets, citations, diagnostics };
}
