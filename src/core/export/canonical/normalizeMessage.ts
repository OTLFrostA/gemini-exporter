import type { CanonicalMessageInput } from './messageInput.js';
import type { Asset } from './assets.js';
import { collectReferencedAssetIds } from './assetReferences.js';
import type { BlockNode } from '../../content/blocks.js';
import type { Citation } from './citations.js';
import type { MessageNode, MessageRole } from './conversation.js';
import type { Diagnostic } from './diagnostics.js';
import type { JsonValue } from './json.js';
import type { SourceRef } from './provenance.js';
import type { InlineByteStore } from '../assets/index.js';
import {
    type AssetParserContext,
    linkInlineImage,
    buildAsset,
    indexAssetRef,
    newAssetLinkIndex,
} from './gemini/normalizeAssets.js';
import {
    linkCitationMarkers,
} from './gemini/normalizeCitations.js';
import { mapContentAssetReferences } from '../../content/assetReferences.js';


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

type MessageContext = { providerId: string; diag: Diagnostic[]; byteStore: InlineByteStore };

/** Package an existing semantic body; syntax interpretation belongs to the input adapter. */
export function normalizeMessage(input: CanonicalMessageInput, index: number, ctx: MessageContext): MessageBuild {
    const { message: m, locator, reasoningBlocks, citationInput } = input;
    const diagnostics: Diagnostic[] = [...(input.diagnostics ?? [])];
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

    // Normalize attachments and bind semantic resource references to export identities.
    const attachments = m.attachments ?? [];
    const attachmentBlocks: BlockNode[] = [];
    const assets: Asset[] = [];
    const assetIndex = newAssetLinkIndex();
    attachments.forEach((a, ai) => {
        const assetId = `${msgId}-a${ai}`;
        const built = buildAsset(a, assetId, { ...sourceRef, locator: `${locator}.attachments[${ai}]` }, ctx.byteStore);
        assets.push(built.asset);
        if (a.referenceId !== undefined) assetIndex.byRef.set(a.referenceId, assetId);
        for (const ref of a.referenceId !== undefined ? [] : [a.localName, a.url, a.sourceUrl, a.resolvedUrl, a.src]) {
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

    const st: AssetParserContext = { diagnostics, sourceRef, assetIndex, inlineAssets: [], idPrefix, byteStore: ctx.byteStore };
    const semanticBody: BlockNode[] = reasoningBlocks
        ? [{ type: 'thought', disclosure: 'providerExposed', kind: 'reasoning', blocks: reasoningBlocks }, ...m.content]
        : m.content;
    const blocks = [...mapContentAssetReferences(semanticBody, (ref, kind, alt, title) => {
        if (!input.inlineAssetSources && assets.some(asset => asset.id === ref)) return ref;
        if (kind === 'file') return assetIndex.byRef.get(ref) ?? ref;
        return linkInlineImage(ref, alt ?? '', title, st, input.inlineAssetSources?.get(ref)).assetId;
    })];

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

    const unknownFields = input.unknownFields ?? [];
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
