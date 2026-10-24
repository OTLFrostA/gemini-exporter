import { chatGPTInteractiveSnapshot } from './interactiveSnapshot.js';
import type { Account } from '../../../l2/accountRegistry.js';
import type { ResourceAcquisitionHint } from '../../resources/resourceAcquisition.js';
import { contentQuality } from '../qualityEvidence.js';
import { parseIndexMetadata } from '../shared/parseIndexMetadata.js';
/**
 * ChatGPT conversation parser: assembled mapping evidence -> branded Domain.
 * Acquisition (session/list/detail/downloads) stays in the provider; only this
 * parser module may call validateParserDomain for ChatGPT payloads, mirroring
 * the Gemini rpc/dom/takeout parser ownership in the trust boundary.
 *
 * Message bodies are ChatGPT-dialect Markdown: normalized by
 * markdownCompatibility.ts, then parsed by the shared mdast pipeline into
 * BlockNodes (code/table/math structure preserved, like Gemini bodies).
 */
import type {
    DomainAsset,
    DomainMessage,
} from '../../../l2/conversationDetail.js';
import type { BlockNode } from '../../../l2/content/blocks.js';
import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import type { SourceConversationParseResult } from '../parsingResult.js';
import {
    parseMarkdownToBlocks,
    type MarkdownParseContext,
} from '../shared/markdown/index.js';
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
} from './chatgptTypes.js';
import {
    citationsOfChatGPTNode,
    collectChatGPTThinking,
    type ChatGPTThinking,
    uploadedFilesOfChatGPTNode,
} from './conversationDetail.js';
import {
    assetIdForPointer,
    chatGPTNodeRole,
    chatGPTNodeSegments,
    extractChatGPTModelSlug,
    processChatGPTMapping,
} from './conversationTree.js';
import { chatGPTTimestamp } from './timestamp.js';
import { preprocessChatGPTMarkdown } from './markdownCompatibility.js';

/** Image bytes resolved by the provider for one sediment pointer. */
interface ChatGPTParsedImage {
    pointer: string;
    assetId: string;
    dataBase64: string;
    mediaType?: string;
    fileName?: string;
    byteLength?: number;
}

/** Uploaded-file bytes resolved by the provider (absent when undownloadable). */
interface ChatGPTParsedFile {
    id: string;
    name: string;
    mediaType?: string;
    byteLength?: number;
    dataBase64?: string;
}

interface ChatGPTNodeAssets {
    nodeId: string;
    images: ChatGPTParsedImage[];
    files: ChatGPTParsedFile[];
}

interface ChatGPTParseInput {
    account?: Account;
    conversation: ChatGPTApiConversationWithId;
    /** Pre-resolved downloads keyed by node id; missing entries mean no assets. */
    assetsByNode: Map<string, ChatGPTNodeAssets>;
}

function parseBody(text: string, nodeId: string, ctx: MarkdownParseContext): BlockNode[] {
    if (!text.trim()) return [];
    return parseMarkdownToBlocks(preprocessChatGPTMarkdown(text), nodeId, ctx);
}

function reasoningOfThinking(thinking: ChatGPTThinking, nodeId: string, ctx: MarkdownParseContext): BlockNode[] {
    const blocks: BlockNode[] = [];
    const head: string[] = [];
    if (typeof thinking.durationSeconds === 'number') head.push(`思考用时约 ${thinking.durationSeconds} 秒`);
    if (thinking.activities.length > 0) head.push(thinking.activities.join(' / '));
    if (head.length > 0) {
        blocks.push({ type: 'paragraph', children: [{ type: 'text', text: `【思考过程】${head.join('；')}` }] });
    }
    for (const thought of thinking.thoughts) {
        const text = thought.summary
            ? `**${thought.summary}**\n\n${thought.content}`
            : thought.content;
        blocks.push(...parseBody(text, nodeId, ctx));
    }
    return blocks;
}

function messageOfNode(
    node: ChatGPTConversationNode,
    branchSlug: string,
    assets: DomainAsset[],
    acquisitionHints: Record<string, ResourceAcquisitionHint>,
    seenAssetIds: Set<string>,
    resolved: ChatGPTNodeAssets | undefined,
    thinking: ChatGPTThinking | undefined,
    ctx: MarkdownParseContext,
): DomainMessage {
    const content: BlockNode[] = [];
    // P0: asset identity is conversation-global (closure rejects duplicates),
    // so repeated pointers reuse the first asset instead of pushing a twin.
    const claim = (assetId: string): boolean => {
        if (seenAssetIds.has(assetId)) return false;
        seenAssetIds.add(assetId);
        return true;
    };
    for (const seg of chatGPTNodeSegments(node)) {
        if (seg.kind === 'text') {
            content.push(...parseBody(seg.text, node.id, ctx));
            continue;
        }
        const image = resolved?.images.find((img) => img.pointer === seg.pointer);
        const assetId = image?.assetId ?? assetIdForPointer(seg.pointer);
        if (claim(assetId)) {
            if (image) {
                acquisitionHints[assetId] = { dataBase64: image.dataBase64 };
                assets.push({
                    id: assetId,
                    kind: 'image',
                    name: image.fileName,
                    mediaType: image.mediaType,
                    byteLength: image.byteLength,
                    sourceUri: image.pointer,
                });
            } else {
                // Keep placeholder asset + diagnostic instead of silently dropping the image.
                assets.push({
                    id: assetId,
                    kind: 'image',
                    sourceUri: seg.pointer,
                });
                ctx.diagnostics.push({
                    id: `image-unavailable:${node.id}:${assetId}`,
                    severity: 'warning',
                    code: 'CHATGPT_IMAGE_ASSET_UNAVAILABLE',
                    message: `Image asset '${seg.pointer}' could not be downloaded; preserved as placeholder`,
                    sourceRef: ctx.sourceRef,
                    path: `messages[${node.id}].assets[${assetId}]`,
                });
            }
        }
        content.push({ type: 'image', assetId });
    }
    for (const file of uploadedFilesOfChatGPTNode(node)) {
        const bytes = resolved?.files.find((f) => f.id === file.id);
        const assetId = `file-${file.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        if (bytes?.dataBase64) acquisitionHints[assetId] = { dataBase64: bytes.dataBase64 };
        if (claim(assetId)) {
            assets.push({
                id: assetId,
                kind: 'file',
                name: file.name,
                mediaType: bytes?.mediaType ?? file.mediaType,
                byteLength: bytes?.byteLength ?? file.byteLength,
                sourceUri: `file-download:${file.id}`,
            });
        }
        content.push({ type: 'file', assetId, label: file.name });
    }
    const citations = citationsOfChatGPTNode(node);
    // P2: each message keeps its own model; the branch-latest slug is fallback.
    const model = node.message?.metadata?.model_slug || branchSlug || undefined;
    return {
        id: node.id,
        role: chatGPTNodeRole(node),
        model,
        content,
        timestamp: chatGPTTimestamp(node.message?.create_time),
        ...(() => {
            const reasoning = thinking ? reasoningOfThinking(thinking, node.id, ctx) : [];
            return reasoning.length > 0 ? { reasoning } : {};
        })(),
        ...(citations.length > 0 ? { citations } : {}),
    };
}

/** A renderable branch is not necessarily a complete source chain. Missing
 * parents, cycles and absent current_node must never claim full body coverage. */
function branchCoverage(conversation: ChatGPTApiConversationWithId): 'complete' | 'partial' | 'unknown' {
    if (!conversation.current_node) return 'unknown';
    const leaf = conversation.mapping[conversation.current_node]?.message;
    if (leaf?.author.role === 'assistant' && (leaf.end_turn === false
        || leaf.status !== undefined && leaf.status !== 'finished_successfully')) return 'partial';
    let id: string | undefined = conversation.current_node;
    const seen = new Set<string>();
    while (id) {
        if (seen.has(id)) return 'partial';
        seen.add(id);
        const node: ChatGPTConversationNode | undefined = conversation.mapping[id];
        if (!node) return 'partial';
        if (node.parent == null) return 'complete';
        id = node.parent;
    }
    return 'unknown';
}

/** Linearize source messages; final Domain validation belongs to L2. */
export function parseChatGPTConversation(input: ChatGPTParseInput): SourceConversationParseResult {
    const { conversation } = input;
    const contentDiagnostics: Diagnostic[] = [];
    const ctx: MarkdownParseContext = {
        diagnostics: contentDiagnostics,
        sourceRef: { providerId: 'chatgpt', locator: `conversation:${conversation.id}` },
    };
    const nodes = processChatGPTMapping(conversation);
    const interactiveSnapshots = nodes.flatMap(node => {
        const raw = conversation.mapping[node.id]?.message;
        return raw?.metadata?.model_dil_v2 && raw.content.content_type === 'text'
            ? [{ messageId: raw.id, snapshot: chatGPTInteractiveSnapshot(
                (raw.content.parts ?? []).join(''), raw.metadata.model_dil_v2.fallbackMarkdown) }] : [];
    });
    const interactiveIncomplete = interactiveSnapshots.some(({ snapshot }) => snapshot.incomplete);
    for (const { messageId, snapshot } of interactiveSnapshots) {
        if (!snapshot.interactive && !snapshot.modules.length && !snapshot.unsupported.length) continue;
        contentDiagnostics.push({
            id: `chatgpt-interactive-snapshot:${messageId}`, severity: snapshot.incomplete ? 'warning' : 'info',
            code: snapshot.incomplete ? 'CHATGPT_INTERACTIVE_CONTENT_INCOMPLETE' : 'CHATGPT_INTERACTIVE_STATIC_SNAPSHOT',
            message: snapshot.incomplete
                ? 'Some source components could not be parsed and have no usable Markdown fallback.'
                : 'Source components are represented as ordered static content; unsupported content uses provider Markdown when available.',
            sourceRef: { ...ctx.sourceRef, providerMessageId: messageId },
            details: { representation: snapshot.representation,
                interactiveBehaviorPreserved: false, modules: snapshot.modules,
                fallbackBlocks: snapshot.fallbackBlocks, unsupported: snapshot.unsupported },
        });
    }
    const branchSlug = extractChatGPTModelSlug(conversation.mapping, nodes);
    const startId = conversation.current_node || nodes[nodes.length - 1]?.id || '';
    const thinkingByNode = collectChatGPTThinking(
        conversation.mapping,
        new Set(nodes.map((n) => n.id)),
        startId,
    );
    const assets: DomainAsset[] = [];
    const acquisitionHints: Record<string, ResourceAcquisitionHint> = {};
    const seenAssetIds = new Set<string>();
    const messages: DomainMessage[] = nodes.map((node) =>
        messageOfNode(
            node,
            branchSlug,
            assets,
            acquisitionHints,
            seenAssetIds,
            input.assetsByNode.get(node.id),
            thinkingByNode.get(node.id),
            { ...ctx, sourceRef: { ...ctx.sourceRef, providerMessageId: node.id } },
        ),
    );
    // Source activity versions travel beside Detail; Index owns updatedAt.
    const sourceVersion = chatGPTTimestamp(conversation.update_time);
    return {
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        conversationId: conversation.id,
        conversation: {
            index: parseIndexMetadata({ providerId: 'chatgpt', id: conversation.id,
                title: conversation.title?.trim() || '', titleSource: 'provider',
                createdAt: chatGPTTimestamp(conversation.create_time), updatedAt: sourceVersion,
                messageCount: messages.length, url: `https://chatgpt.com/c/${conversation.id}` }),
            detail: { ...(sourceVersion !== undefined ? { savedAt: sourceVersion } : {}), quality: contentQuality({ status: interactiveIncomplete ? 'partial' : branchCoverage(conversation) }), assets, messages },
        },
        diagnostics: contentDiagnostics,
        acquisitionHints,
    };
}
