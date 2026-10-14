/**
 * ChatGPT conversation parser: assembled mapping evidence -> branded Domain.
 * Acquisition (session/list/detail/downloads) stays in the provider; only this
 * parser module may call validateParserDomain for ChatGPT payloads, mirroring
 * the Gemini rpc/dom/takeout parser ownership in the trust boundary.
 */
import type {
    DomainAsset,
    DomainMessage,
} from '../../domain/conversationDetail.js';
import type { BlockNode } from '../../domain/content/blocks.js';
import { validateParserDomain } from '../../domain/runtimeValidation.js';
import type { ResourceConversationParseResult } from '../parsingResult.js';
import type {
    ChatGPTApiConversationWithId,
    ChatGPTConversationNode,
} from './chatgptTypes.js';
import {
    citationsOfChatGPTNode,
    collectChatGPTThinking,
    thinkingToReasoningBlocks,
    uploadedFilesOfChatGPTNode,
} from './conversationDetail.js';
import {
    chatGPTNodeRole,
    chatGPTNodeText,
    extractChatGPTModelSlug,
    imagePointersOfNode,
    processChatGPTMapping,
} from './conversationTree.js';

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

function messageOfNode(
    node: ChatGPTConversationNode,
    modelSlug: string,
    assets: DomainAsset[],
    resolved: ChatGPTNodeAssets | undefined,
    thinkingBlocks: BlockNode[] | undefined,
): DomainMessage {
    const text = chatGPTNodeText(node);
    const content: BlockNode[] = text
        ? [{ type: 'paragraph', children: [{ type: 'text', text }] }]
        : [];
    const attachmentIds: string[] = [];
    for (const image of resolved?.images ?? []) {
        // Defensive: ignore resolutions that do not belong to this node.
        if (!imagePointersOfNode(node).includes(image.pointer)) continue;
        assets.push({
            id: image.assetId,
            kind: 'image',
            name: image.fileName,
            mediaType: image.mediaType,
            byteLength: image.byteLength,
            sourceUri: image.pointer,
            dataBase64: image.dataBase64,
        });
        attachmentIds.push(image.assetId);
        content.push({ type: 'image', assetId: image.assetId });
    }
    for (const file of uploadedFilesOfChatGPTNode(node)) {
        const bytes = resolved?.files.find((f) => f.id === file.id);
        const assetId = `file-${file.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        assets.push({
            id: assetId,
            kind: 'file',
            name: file.name,
            mediaType: bytes?.mediaType ?? file.mediaType,
            byteLength: bytes?.byteLength ?? file.byteLength,
            sourceUri: `file-download:${file.id}`,
            ...(bytes?.dataBase64 ? { dataBase64: bytes.dataBase64 } : {}),
        });
        attachmentIds.push(assetId);
        content.push({ type: 'file', assetId, label: file.name });
    }
    const citations = citationsOfChatGPTNode(node);
    return {
        id: node.id,
        role: chatGPTNodeRole(node),
        model: modelSlug || undefined,
        content,
        timestamp: toEpochMs(node.message?.create_time),
        attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        ...(thinkingBlocks && thinkingBlocks.length > 0 ? { reasoning: thinkingBlocks } : {}),
        ...(citations.length > 0 ? { citations } : {}),
    };
}

/** Linearize, enrich and brand one ChatGPT conversation. */
export function parseChatGPTConversation(input: ChatGPTParseInput): ResourceConversationParseResult {
    const { conversation } = input;
    const nodes = processChatGPTMapping(conversation);
    const modelSlug = extractChatGPTModelSlug(conversation.mapping, nodes);
    const startId = conversation.current_node || nodes[nodes.length - 1]?.id || '';
    const thinkingByNode = collectChatGPTThinking(
        conversation.mapping,
        new Set(nodes.map((n) => n.id)),
        startId,
    );
    const assets: DomainAsset[] = [];
    const messages: DomainMessage[] = nodes.map((node) => {
        const thinking = thinkingByNode.get(node.id);
        return messageOfNode(
            node,
            modelSlug,
            assets,
            input.assetsByNode.get(node.id),
            thinking ? thinkingToReasoningBlocks(thinking) : undefined,
        );
    });
    return {
        conversation: validateParserDomain({
            providerId: 'chatgpt',
            completeness: 'complete',
            assets,
            id: conversation.id,
            title: conversation.title || 'ChatGPT Conversation',
            createdAt: toEpochMs(conversation.create_time),
            updatedAt: toEpochMs(conversation.update_time),
            url: `https://chatgpt.com/c/${conversation.id}`,
            messages,
        }),
        diagnostics: [],
        resourceHints: {},
        acquisitionHints: {},
    };
}
