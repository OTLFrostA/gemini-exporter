import type { BlockNode } from '../../../l2/content/blocks.js';
import type { DomainAsset, DomainMessage } from '../../../l2/conversationDetail.js';
import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import type { SourceConversationParseResult } from '../parsingResult.js';
import { parseMarkdownToBlocks, type MarkdownParseContext } from '../shared/markdown/index.js';
import { parseIndexMetadata } from '../shared/parseIndexMetadata.js';
import { claudeTimestamp } from './parseList.js';
import { createToolState, isCapturedArtifactFile, parseToolUse, parseToolResult, type ToolState } from './parseTools.js';

function object(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}
function uuid(value: unknown): value is string {
    return typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}
/** Fields remain untrusted except the UUID proven at the source boundary. */
type IdentifiedClaudeMessage = Record<string, unknown> & { uuid: string };
function identifiedClaudeMessage(value: unknown): value is IdentifiedClaudeMessage {
    const node = object(value);
    return node !== null && uuid(node.uuid);
}
function paragraph(text: string): BlockNode { return { type: 'paragraph', children: [{ type: 'text', text }] }; }
function markdown(text: string, id: string, ctx: MarkdownParseContext): BlockNode[] {
    return text.trim() ? parseMarkdownToBlocks(text, id, ctx) : [];
}
interface Branch { messages: IdentifiedClaudeMessage[]; quality: 'complete' | 'partial' | 'unknown' }
function currentBranch(data: Record<string, unknown>): Branch {
    if (!Array.isArray(data.chat_messages)) throw new TypeError('Claude detail has no chat_messages');
    const byId = new Map<string, IdentifiedClaudeMessage>();
    for (const value of data.chat_messages) {
        if (!identifiedClaudeMessage(value)) throw new TypeError('Invalid Claude message tree');
        byId.set(value.uuid, value);
    }
    if (byId.size !== data.chat_messages.length) throw new TypeError('Duplicate Claude message UUID');
    if (!uuid(data.current_leaf_message_uuid) || !byId.has(data.current_leaf_message_uuid)) {
        // Never silently call a guessed branch complete.
        return { messages: [...byId.values()]
            .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0)), quality: 'unknown' };
    }
    const result: IdentifiedClaudeMessage[] = [], visited = new Set<string>();
    let id: string | null = data.current_leaf_message_uuid;
    let quality: Branch['quality'] = 'complete';
    while (id) {
        const node = byId.get(id);
        if (visited.has(id) || !node) { quality = 'partial'; break; }
        visited.add(id);
        result.push(node);
        const parent = node.parent_message_uuid;
        if (parent == null || parent === '00000000-0000-4000-8000-000000000000') break;
        if (!uuid(parent)) { quality = 'partial'; break; }
        id = parent;
    }
    return { messages: result.reverse(), quality };
}
function contentOf(message: IdentifiedClaudeMessage, ctx: MarkdownParseContext, tools: ToolState, assets: DomainAsset[]):
    { content: BlockNode[]; reasoning: BlockNode[]; incomplete: boolean } {
    const id = message.uuid;
    const content: BlockNode[] = [], reasoning: BlockNode[] = [];
    let incomplete = message.truncated === true || ['user_canceled', 'error', 'max_tokens', 'tool_use', 'pause_turn', 'model_context_window_exceeded'].includes(String(message.stop_reason));
    const missing = (code: string, message: string) => {
        incomplete = true;
        ctx.diagnostics.push({ severity: 'warning', code, message, sourceRef: ctx.sourceRef });
    };
    if (incomplete) missing('claude.message.truncated', 'Message was truncated or canceled');
    const attachments = Array.isArray(message.attachments) ? message.attachments : [];
    const files = Array.isArray(message.files) ? message.files : [];
    const unresolved: { file: Record<string, unknown>; name: string; generated: boolean }[] = [];
    for (const { entry, generated } of [...attachments.map(entry => ({ entry, generated: false })),
        ...files.map(entry => ({ entry, generated: true }))]) {
        const file = object(entry);
        if (!file) { missing('claude.attachment.invalid', 'Invalid attachment metadata'); continue; }
        const name = typeof file.file_name === 'string' ? file.file_name
            : typeof file.name === 'string' ? file.name : 'attachment';
        if (typeof file.extracted_content === 'string' && file.extracted_content.trim()) {
            content.push(paragraph('Attachment: ' + name));
            content.push(...markdown(file.extracted_content, id, ctx));
        } else unresolved.push({ file, name, generated });
    }
    if (Array.isArray(message.content)) {
        for (const raw of message.content) {
            const block = object(raw);
            if (!block) { missing('claude.content.invalid', 'Invalid content block'); continue; }
            if (block.type === 'text' && typeof block.text === 'string') {
                content.push(...markdown(block.text, id, ctx));
            } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
                reasoning.push(...markdown(block.thinking, id, ctx));
            } else if (block.type === 'tool_use') {
                const parsed = parseToolUse(block, tools, text => markdown(text, id, ctx));
                content.push(...parsed.blocks);
                for (const issue of parsed.issues) missing('claude.tool_use.unsupported', issue);
            } else if (block.type === 'tool_result') {
                const parsed = parseToolResult(block, text => markdown(text, id, ctx));
                content.push(...parsed.blocks);
                for (const issue of parsed.issues) missing('claude.tool_result.unsupported', issue);
            } else if (block.type !== 'redacted_thinking') {
                missing('claude.content.unsupported', 'Unsupported content block: ' + String(block.type));
            }
        }
    } else if (typeof message.text === 'string') {
        content.push(...markdown(message.text, id, ctx));
    } else { missing('claude.content.missing', 'Message has no content'); }
    for (const { file, name, generated } of unresolved) {
        if (generated && isCapturedArtifactFile(message, file, tools)) continue;
        const fileId = file.file_uuid ?? file.uuid;
        if (generated && file.success === true && file.file_kind === 'blob' && file.download_source === 'files-api' && uuid(fileId)) {
            const assetId = 'claude-file:' + fileId;
            if (!assets.some(asset => asset.id === assetId)) assets.push({ id: assetId, kind: 'file', name,
                sourceUri: assetId, ...(typeof file.size_bytes === 'number' && Number.isSafeInteger(file.size_bytes) && file.size_bytes >= 0 ? { byteLength: file.size_bytes } : {}) });
            content.push({ type: 'file', assetId, label: name });
            continue;
        }
        content.push(paragraph('Attachment: ' + name));
        missing('claude.attachment.unavailable', 'Attachment bytes or extracted text unavailable');
    }
    return { content, reasoning, incomplete };
}

/** Pure Claude wire data -> shared Domain. Rendering remains entirely in L4. */
export function parseClaudeConversation(raw: unknown, requestedId: string): SourceConversationParseResult {
    const data = object(raw);
    if (!data || !uuid(requestedId) || data.uuid !== undefined && data.uuid !== requestedId)
        throw new TypeError('Claude detail identity mismatch');
    const branch = currentBranch(data);
    const diagnostics: Diagnostic[] = [];
    const ctx: MarkdownParseContext = {
        diagnostics, sourceRef: { providerId: 'claude', locator: 'conversation:' + requestedId },
    };
    if (branch.quality !== 'complete') diagnostics.push({ severity: 'warning',
        code: 'claude.branch.' + branch.quality,
        message: branch.quality === 'partial' ? 'Current branch has a missing or cyclic parent'
            : 'Current branch leaf is unavailable', sourceRef: ctx.sourceRef });
    let partial = false;
    const sourceModel = typeof data.model === 'string' && data.model.trim() ? data.model : undefined;
    const messages: DomainMessage[] = [];
    const assets: DomainAsset[] = [];
    const tools = createToolState(branch.messages);
    for (const message of branch.messages) {
        if (message.sender !== 'human' && message.sender !== 'assistant') continue;
        const rendered = contentOf(message, { ...ctx,
            sourceRef: { ...ctx.sourceRef, providerMessageId: message.uuid } }, tools, assets);
        if (rendered.incomplete) partial = true;
        const timestamp = claudeTimestamp(message.created_at);
        const model = typeof message.model === 'string' && message.model.trim() ? message.model : sourceModel;
        messages.push({
            id: message.uuid, role: message.sender === 'human' ? 'user' : 'assistant',
            content: rendered.content,
            ...(rendered.reasoning.length ? { reasoning: rendered.reasoning } : {}),
            ...(timestamp !== undefined ? { timestamp } : {}),
            ...(model ? { model } : {}),
        });
    }
    const sourceVersion = claudeTimestamp(data.updated_at);
    const createdAt = claudeTimestamp(data.created_at);
    const quality = branch.quality === 'complete' && partial ? 'partial' : branch.quality;
    return {
        conversationId: requestedId,
        ...(sourceVersion !== undefined ? { sourceVersion } : {}),
        conversation: {
            index: parseIndexMetadata({ providerId: 'claude', id: requestedId,
                title: typeof data.name === 'string' ? data.name : undefined,
                titleSource: 'provider', createdAt, updatedAt: sourceVersion,
                url: 'https://claude.ai/chat/' + requestedId }),
            detail: { ...(sourceVersion !== undefined ? { savedAt: sourceVersion } : {}),
                quality: { status: messages.length ? quality : 'unknown' }, assets, messages },
        },
        diagnostics, acquisitionHints: {},
    };
}
