import type {
    Attachment as RepoAttachment,
    ChatMessage as RepoMessage,
} from '../../../../types/conversation.js';
import type { Asset } from '../assets.js';
import { collectReferencedAssetIds } from '../assetReferences.js';
import type { AssetOrigin, BlockNode } from '../blocks.js';
import type { Citation } from '../citations.js';
import type { MessageNode, MessageRole } from '../conversation.js';
import type { Diagnostic } from '../diagnostics.js';
import type { JsonValue } from '../json.js';
import type { SourceRef } from '../provenance.js';
import { unknownBlockFallbackText } from '../unknownFallback.js';
import type { InlineByteStore } from '../../assets/index.js';
import {
    buildAsset,
    classifyAttachmentKind,
    indexAssetRef,
    mergeMessageAttachments,
    newAssetLinkIndex,
} from './normalizeAssets.js';
import {
    cleanBody,
    type MdParser,
    parseMarkdownBlocks,
} from './markdownToBlocks.js';
import { parseMarkdownToBlocks } from '../markdown/index.js';
import {
    extractRawCitations,
    linkCitationMarkers,
} from './normalizeCitations.js';

export const KNOWN_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
    'id', 'role', 'content', 'timestamp', 'turnId', 'attachments', 'thoughts',
    'thinking', 'citations', 'images', 'documents', 'attachmentCount',
    'messageCount', 'sources',
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

export function normalizeMessage(
    m: RepoMessage,
    index: number,
    locator: string,
    ctx: { providerId: string; diag: Diagnostic[]; byteStore: InlineByteStore; useLegacyMarkdownParser?: boolean },
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
    let blockSeq = 0;
    const nextBlockId = (): string => `${idPrefix}-b${blockSeq++}`;

    // Index attachments before markdown parsing so inline ![alt](src) nodes can link to their Asset IDs.
    const merged = mergeMessageAttachments(m);
    const attachmentBlocks: BlockNode[] = [];
    const assets: Asset[] = [];
    const assetIds: string[] = [];
    const assetIndex = newAssetLinkIndex();
    merged.forEach((a, ai) => {
        const assetId = `${msgId}-a${ai}`;
        const { isImage } = classifyAttachmentKind(a);
        const isModelTurn = role === 'assistant' || (m.role as string) === 'model';
        const isGenerated = a.isGenerated === true || (
            a.isGenerated !== false &&
            isModelTurn &&
            isImage &&
            a.__origin !== 'document'
        );
        const origin: AssetOrigin = isGenerated
            ? 'generated'
            : a.__origin === 'attachment'
                ? 'attachment'
                : a.__origin === 'image'
                    ? 'inline'
                    : 'unknown';
        const built = buildAsset(a, assetId, { ...sourceRef, locator: `${locator}.attachments[${ai}]` }, origin);
        assets.push(built.asset);
        assetIds.push(assetId);
        for (const ref of [a.localName, a.url, a.sourceUrl, a.resolvedUrl, a.src]) {
            if (typeof ref === 'string' && ref) {
                indexAssetRef(assetIndex, ref, assetId);
            }
        }
        diagnostics.push(...built.diagnostics);
        const bid = nextBlockId();
        if (built.isImage) {
            attachmentBlocks.push({
                id: bid, type: 'image', assetId,
                alt: built.asset.name, origin: built.origin,
                sourceRef,
            });
        } else {
            attachmentBlocks.push({
                id: bid, type: 'file', assetId,
                label: built.asset.name, origin: built.origin,
                sourceRef,
            });
        }
    });

    const st: MdParser = { diagnostics, sourceRef, assetIndex, inlineAssets: [], idPrefix, byteStore: ctx.byteStore, nextBlockId };
    const blocks: BlockNode[] = [];

    const parseBlocks = ctx.useLegacyMarkdownParser ? parseMarkdownBlocks : parseMarkdownToBlocks;

    const thoughtsRaw = m.thoughts ?? m.thinking ?? '';
    const thoughtsText = cleanBody(Array.isArray(thoughtsRaw) ? thoughtsRaw.join('\n\n') : thoughtsRaw);
    if (thoughtsText.trim()) {
        blocks.push({
            id: nextBlockId(),
            type: 'thought',
            disclosure: 'providerExposed',
            kind: 'reasoning',
            blocks: parseBlocks(thoughtsText, idPrefix, st),
        });
    }

    if (typeof m.content === 'string') {
        const cleaned = cleanBody(m.content);
        if (cleaned.trim()) blocks.push(...parseBlocks(cleaned, idPrefix, st));
    } else if (m.content !== undefined && m.content !== null) {
        const ub: BlockNode = {
            id: nextBlockId(),
            type: 'unknown',
            sourceType: 'message-content',
            payload: m.content as JsonValue,
        };
        blocks.push(ub);
        diagnostics.push({
            id: `unknown-content:${msgId}`,
            severity: 'warning',
            code: 'UNKNOWN_MESSAGE_CONTENT',
            message: `message content was not a string; preserved as unknown block`,
            sourceRef,
            details: { fallback: unknownBlockFallbackText(ub) } as JsonValue,
        });
    }

    for (const ia of st.inlineAssets) {
        assets.push(ia);
        assetIds.push(ia.id);
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
    const { list: rawCits, skipped } = extractRawCitations(m);
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
        citations.push({
            id: cid,
            kind,
            url: rc.url,
            title: rc.title,
            sourceRef: { ...sourceRef, locator: `${locator}.citations[${ci}]` },
        });
    });
    if (citations.length) {
        linkCitationMarkers(blocks, citations);
        blocks.push({
            id: nextBlockId(),
            type: 'citationGroup',
            citationIds: citations.map((c) => c.id),
            sourceRef,
        } as BlockNode);
    }

    const unknownFields = Object.keys(m ?? {}).filter((k) => !KNOWN_MESSAGE_FIELDS.has(k));
    const createdAt = toIso(m.timestamp);
    const node: MessageNode = {
        id: msgId,
        role,
        ...(rawRole ? { author: { rawRole } } : {}),
        ...(createdAt ? { createdAt } : {}),
        blocks,
        ...(assetIds.length ? { associatedAssetIds: assetIds } : {}),
        sourceRef,
        ...(unknownFields.length
            ? { extensions: { gemini: { unknownFields } as JsonValue } }
            : {}),
    };
    return { node, assets, citations, diagnostics };
}
