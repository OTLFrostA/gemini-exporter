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
} from '../../domain/conversationDetail.js';
import type { BlockNode } from '../../domain/content/blocks.js';
import { validateParserDomain } from '../../domain/runtimeValidation.js';
import type { Diagnostic } from '../../diagnostics/contentDiagnostic.js';
import type { ResourceConversationParseResult } from '../parsingResult.js';
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
import { preprocessChatGPTMarkdown } from './markdownCompatibility.js';

/** Image bytes resolved by the provider for one sediment pointer. */
export interface ChatGPTParsedImage {
    pointer: string;
    assetId: string;
    dataBase64: string;
    mediaType?: string;
    fileName?: string;
    byteLength?: number;
}

/** Uploaded-file bytes resolved by the provider (absent when undownloadable). */
export interface ChatGPTParsedFile {
    id: string;
    name: string;
    mediaType?: string;
    byteLength?: number;
    dataBase64?: string;
}

export interface ChatGPTNodeAssets {
    nodeId: string;
    images: ChatGPTParsedImage[];
    files: ChatGPTParsedFile[];
}

export interface ChatGPTParseInput {
    conversation: ChatGPTApiConversationWithId;
    /** Pre-resolved downloads keyed by node id; missing entries mean no assets. */
    assetsByNode: Map<string, ChatGPTNodeAssets>;
}

function toEpochMs(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') {
        return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }
    if (typeof value === 'string' && value) {
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : undefined;
    }
    return undefined;
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
    seenAssetIds: Set<string>,
    resolved: ChatGPTNodeAssets | undefined,
    thinking: ChatGPTThinking | undefined,
    ctx: MarkdownParseContext,
): DomainMessage {
    const content: BlockNode[] = [];
    const attachmentIds: string[] = [];
    const addAttachmentId = (assetId: string): void => {
        if (!attachmentIds.includes(assetId)) {
            attachmentIds.push(assetId);
        }
    };
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
                assets.push({
                    id: assetId,
                    kind: 'image',
                    name: image.fileName,
                    mediaType: image.mediaType,
                    byteLength: image.byteLength,
                    sourceUri: image.pointer,
                    dataBase64: image.dataBase64,
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
        addAttachmentId(assetId);
        content.push({ type: 'image', assetId });
    }
    for (const file of uploadedFilesOfChatGPTNode(node)) {
        const bytes = resolved?.files.find((f) => f.id === file.id);
        const assetId = `file-${file.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        if (claim(assetId)) {
            assets.push({
                id: assetId,
                kind: 'file',
                name: file.name,
                mediaType: bytes?.mediaType ?? file.mediaType,
                byteLength: bytes?.byteLength ?? file.byteLength,
                sourceUri: `file-download:${file.id}`,
                ...(bytes?.dataBase64 ? { dataBase64: bytes.dataBase64 } : {}),
            });
        }
        addAttachmentId(assetId);
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
        timestamp: toEpochMs(node.message?.create_time),
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        ...(() => {
            const reasoning = thinking ? reasoningOfThinking(thinking, node.id, ctx) : [];
            return reasoning.length > 0 ? { reasoning } : {};
        })(),
        ...(citations.length > 0 ? { citations } : {}),
    };
}

/** Linearize, enrich and brand one ChatGPT conversation. */
export function parseChatGPTConversation(input: ChatGPTParseInput): ResourceConversationParseResult {
    const { conversation } = input;
    const contentDiagnostics: Diagnostic[] = [];
    const ctx: MarkdownParseContext = {
        diagnostics: contentDiagnostics,
        sourceRef: { providerId: 'chatgpt', locator: `conversation:${conversation.id}` },
    };
    const nodes = processChatGPTMapping(conversation);
    const branchSlug = extractChatGPTModelSlug(conversation.mapping, nodes);
    const startId = conversation.current_node || nodes[nodes.length - 1]?.id || '';
    const thinkingByNode = collectChatGPTThinking(
        conversation.mapping,
        new Set(nodes.map((n) => n.id)),
        startId,
    );
    const assets: DomainAsset[] = [];
    const seenAssetIds = new Set<string>();
    const messages: DomainMessage[] = nodes.map((node) =>
        messageOfNode(
            node,
            branchSlug,
            assets,
            seenAssetIds,
            input.assetsByNode.get(node.id),
            thinkingByNode.get(node.id),
            { ...ctx, sourceRef: { ...ctx.sourceRef, providerMessageId: node.id } },
        ),
    );
    const hasMissingImage = assets.some((a) => a.kind === 'image' && !a.dataBase64);
    return {
        conversation: validateParserDomain({
            providerId: 'chatgpt',
            completeness: hasMissingImage ? 'partial' : 'complete',
            assets,
            id: conversation.id,
            title: conversation.title || 'ChatGPT Conversation',
            createdAt: toEpochMs(conversation.create_time),
            updatedAt: toEpochMs(conversation.update_time),
            url: `https://chatgpt.com/c/${conversation.id}`,
            messages,
        }),
        diagnostics: contentDiagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message,
            path: d.path,
        })),
        resourceHints: {},
        acquisitionHints: {},
    };
}
