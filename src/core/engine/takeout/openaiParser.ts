/**
 * src/core/engine/takeout/openaiParser.ts
 * ChatGPT (OpenAI) data-export ZIP unpacker — v1.
 *
 * Modeled on the Gemini takeout pipeline (takeoutParser.ts):
 *   ZipBombGuard validation -> JSZip load -> locate conversations.json
 *   -> memory guardrail (fail-closed) -> mapping-tree walk
 *   -> Conversation[] + media indexes, same TakeoutParseResult shape.
 *
 * v1 scope: text messages + assistant "thoughts" folding + user-upload
 * attachments resolved against file-*.dat entries. Deliberately NOT
 * calling MediaIndex.commitTakeoutData: committing would clobber the
 * Gemini takeout store for the slot — that merge decision belongs to a
 * follow-up, the caller receives convCache/mediaMap/globalMedia instead.
 */

import { normId as utilsNormId } from "../../utils/utils.js";
import { ZipBombGuard } from "./zipBombGuard.js";
import { TakeoutParseError } from "../../../types/errors.js";
import type { Attachment, ChatMessage, Conversation } from "../../../types/index.js";

interface OpenAiZipEntry {
    name?: string;
    dir?: boolean;
    date?: Date | { getTime: () => number } | null;
    _data?: { uncompressedSize?: number };
    async(type: string): Promise<unknown>;
}

interface OpenAiZipInstance {
    files: Record<string, unknown>;
    file: (name: string, content?: unknown) => unknown;
}

interface OpenAiZipLoader {
    loadAsync: (data: unknown) => Promise<unknown>;
}

interface OpenAiMediaEntry {
    filename: string;
    stem: string;
    fileObj: OpenAiZipEntry;
    time: number | null;
}

export interface OpenAiParseResult {
    conversations: Conversation[];
    totalMediaCount: number;
    convCache: Record<string, Conversation>;
    mediaMap: Record<string, OpenAiMediaEntry[]>;
    globalMedia: Record<string, OpenAiZipEntry>;
}

export interface OpenAiParserModule {
    parseOpenAiZip: (file: unknown, onProgress?: ((pct: number, msg: string) => void) | null, slot?: string | null) => Promise<OpenAiParseResult>;
}

const normId = utilsNormId;

/** conversations.json payload size cap before loading into memory (mirrors takeout S-4). */
const MAX_CONVERSATIONS_UNCOMPRESSED_SIZE = 250 * 1024 * 1024;

interface OpenAiRawMessageAuthor {
    role?: string | null;
}

interface OpenAiRawMessageContent {
    content_type?: string | null;
    parts?: unknown[] | null;
    thoughts?: unknown[] | null;
}

interface OpenAiRawMessageMetadata {
    attachments?: unknown[] | null;
}

interface OpenAiRawMessage {
    id?: string | null;
    author?: OpenAiRawMessageAuthor | null;
    create_time?: number | null;
    content?: OpenAiRawMessageContent | null;
    metadata?: OpenAiRawMessageMetadata | null;
}

interface OpenAiMappingNode {
    id?: string | null;
    parent?: string | null;
    children?: string[] | null;
    message?: OpenAiRawMessage | null;
}

interface OpenAiRawConversation {
    id?: string | null;
    conversation_id?: string | null;
    title?: string | null;
    create_time?: number | null;
    update_time?: number | null;
    current_node?: string | null;
    mapping?: Record<string, OpenAiMappingNode | undefined> | null;
    is_archived?: boolean | null;
}

interface AttachmentOptions {
    id: string;
    name?: string;
    mime?: string;
    size?: number;
    isImage?: boolean;
}

interface MediaResolver {
    (datName: string): OpenAiZipEntry | null;
}

function isZipLoader(val: unknown): val is OpenAiZipLoader {
    return (
        (typeof val === 'function' || (typeof val === 'object' && val !== null)) &&
        'loadAsync' in val &&
        typeof val.loadAsync === 'function'
    );
}

function getZipLoader(): OpenAiZipLoader {
    let candidate: unknown;
    if (typeof JSZip !== 'undefined') {
        candidate = JSZip;
    } else if (typeof globalThis !== 'undefined' && 'JSZip' in globalThis) {
        candidate = globalThis.JSZip;
    }
    if (isZipLoader(candidate)) {
        return candidate;
    }
    throw new Error('JSZip 库未加载，无法解析 ZIP');
}

function isOpenAiZipEntry(val: unknown): val is OpenAiZipEntry {
    return (
        typeof val === 'object' &&
        val !== null &&
        'async' in val &&
        typeof val.async === 'function'
    );
}

function isOpenAiZipInstance(val: unknown): val is OpenAiZipInstance {
    if (typeof val !== 'object' || val === null) return false;
    if (!('files' in val) || !('file' in val) || typeof val.file !== 'function') return false;
    const files = val.files;
    return typeof files === 'object' && files !== null;
}

function isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isOpenAiRawConversation(val: unknown): val is OpenAiRawConversation {
    if (!isRecord(val)) return false;
    if ('id' in val && val.id !== null && typeof val.id !== 'string') return false;
    if ('conversation_id' in val && val.conversation_id !== null && typeof val.conversation_id !== 'string') return false;
    if ('title' in val && val.title !== null && typeof val.title !== 'string') return false;
    if ('current_node' in val && val.current_node !== null && typeof val.current_node !== 'string') return false;
    if ('mapping' in val && val.mapping !== null && !isRecord(val.mapping)) return false;
    return true;
}

async function readZipText(entry: OpenAiZipEntry): Promise<string> {
    const value = await entry.async('text');
    if (typeof value !== 'string') throw new TakeoutParseError('ZIP 文本条目无效', false, entry.name);
    return value;
}

function toMs(epochSeconds?: unknown): number | null {
    return (typeof epochSeconds === 'number' && Number.isFinite(epochSeconds))
        ? Math.round(epochSeconds * 1000)
        : null;
}

function textOf(parts?: unknown[]): string {
    if (!Array.isArray(parts)) return '';
    const out: string[] = [];
    for (const p of parts) {
        if (typeof p === 'string') {
            out.push(p);
        } else if (p && typeof p === 'object' && 'text' in p && typeof p.text === 'string') {
            out.push(p.text);
        }
    }
    return out.join('\n');
}

/**
 * Newer exports carry thinking as content.thoughts: [{content, summary, ...}]
 * instead of content.parts. Prefer the full content text, fall back to summary.
 */
function thoughtsText(thoughts?: unknown[]): string {
    if (!Array.isArray(thoughts)) return '';
    const out: string[] = [];
    for (const t of thoughts) {
        if (typeof t === 'string') {
            if (t.trim()) out.push(t);
            continue;
        }
        if (t && typeof t === 'object') {
            const content = 'content' in t && typeof t.content === 'string' ? t.content.trim() : '';
            const summary = 'summary' in t && typeof t.summary === 'string' ? t.summary.trim() : '';
            if (content) out.push(content);
            else if (summary) out.push(summary);
        }
    }
    return out.join('\n');
}

function findConversationsJson(zip: OpenAiZipInstance): OpenAiZipEntry | null {
    for (const [path, fObj] of Object.entries(zip.files)) {
        if (!isOpenAiZipEntry(fObj) || fObj.dir) continue;
        const base = path.replace(/^.*[\\\/]/, '');
        if (/^conversations\.json$/i.test(base)) return fObj;
    }
    return null;
}

function findAssetNamesFile(zip: OpenAiZipInstance): OpenAiZipEntry | null {
    for (const [path, fObj] of Object.entries(zip.files)) {
        if (!isOpenAiZipEntry(fObj) || fObj.dir) continue;
        const base = path.replace(/^.*[\\\/]/, '');
        if (/^conversation_asset_file_names\.json$/i.test(base)) return fObj;
    }
    return null;
}

function buildMediaIndex(zip: OpenAiZipInstance): { globalMedia: Record<string, OpenAiZipEntry>; totalMediaCount: number } {
    const globalMedia: Record<string, OpenAiZipEntry> = {};
    let totalMediaCount = 0;
    for (const [path, fObj] of Object.entries(zip.files)) {
        if (!isOpenAiZipEntry(fObj) || fObj.dir) continue;
        if (/\.(json|html?|txt|md)$/i.test(path)) continue;
        const filename = path.replace(/^.*[\\\/]/, '').trim();
        if (!filename) continue;
        const stem = filename.replace(/\.[^/.]+$/, '');
        globalMedia[filename] = fObj;
        globalMedia[stem] = fObj;
        globalMedia[filename.toLowerCase()] = fObj;
        globalMedia[stem.toLowerCase()] = fObj;
        totalMediaCount++;
    }
    return { globalMedia, totalMediaCount };
}

async function applyAssetNameAliases(
    zip: OpenAiZipInstance,
    globalMedia: Record<string, OpenAiZipEntry>
): Promise<Record<string, string>> {
    const assetFile = findAssetNamesFile(zip);
    const nameByDat: Record<string, string> = {};
    if (!assetFile) return nameByDat;
    let mapping: Record<string, unknown> = {};
    try {
        const text = await readZipText(assetFile);
        const parsed: unknown = JSON.parse(text);
        if (isRecord(parsed)) mapping = parsed;
    } catch {
        return nameByDat;
    }
    for (const [datName, origName] of Object.entries(mapping)) {
        if (typeof origName !== 'string' || !origName.trim()) continue;
        const fObj = globalMedia[datName] || globalMedia[datName.toLowerCase()];
        if (!fObj) continue;
        const name = origName.trim();
        nameByDat[datName] = name;
        const stem = name.replace(/\.[^/.]+$/, '');
        globalMedia[name] = fObj;
        globalMedia[stem] = fObj;
        globalMedia[name.toLowerCase()] = fObj;
        globalMedia[stem.toLowerCase()] = fObj;
    }
    return nameByDat;
}

function buildAttachments(
    msg: OpenAiRawMessage,
    resolveMedia: MediaResolver,
    nameByDat: Record<string, string>
): { attachments: Attachment[]; mediaEntries: OpenAiMediaEntry[] } {
    const attachments: Attachment[] = [];
    const mediaEntries: OpenAiMediaEntry[] = [];
    const seenIds = new Set<string>();

    const pushAttachment = (opts: AttachmentOptions) => {
        const attId = opts.id;
        if (!attId || seenIds.has(attId)) return;
        seenIds.add(attId);
        // Observed: attachment id already carries the "file-" prefix and the zip
        // entry is "<id>.dat"; try both spellings when resolving.
        const candidates = [`${attId}.dat`, attId.replace(/^file-/, 'file-') + '.dat'];
        let fileObj: OpenAiZipEntry | null = null;
        let datName = candidates[0];
        for (const c of candidates) {
            fileObj = resolveMedia(c);
            if (fileObj) { datName = c; break; }
        }
        const displayName = opts.name || nameByDat[datName] || nameByDat[datName.toLowerCase()];
        const att: Attachment = {
            type: opts.isImage || (opts.mime || '').startsWith('image/') ? 'image' : 'file',
            source: 'openai-export',
        };
        if (displayName) { att.fileName = displayName; att.name = displayName; }
        if (opts.mime) att.mimeType = opts.mime;
        if (opts.size !== undefined) att.size = opts.size;
        att.localName = datName;
        attachments.push(att);
        if (fileObj) {
            const stem = datName.replace(/\.[^/.]+$/, '');
            let fileTime: number | null = null;
            if (fileObj.date instanceof Date) {
                fileTime = fileObj.date.getTime();
            } else if (fileObj.date && typeof fileObj.date === 'object' && 'getTime' in fileObj.date && typeof fileObj.date.getTime === 'function') {
                fileTime = Number(fileObj.date.getTime());
            }
            mediaEntries.push({
                filename: datName,
                stem,
                fileObj,
                time: fileTime,
            });
        }
    };

    const rawAtts = msg.metadata?.attachments;
    if (Array.isArray(rawAtts)) {
        for (const a of rawAtts) {
            if (!a || typeof a !== 'object') continue;
            const attId = 'id' in a && typeof a.id === 'string' ? a.id : '';
            if (!attId) continue;
            pushAttachment({
                id: attId,
                name: 'name' in a && typeof a.name === 'string' ? a.name : undefined,
                mime: 'mime_type' in a && typeof a.mime_type === 'string' ? a.mime_type : undefined,
                size: 'size' in a && typeof a.size === 'number' && Number.isFinite(a.size) ? a.size : undefined,
            });
        }
    }

    // multimodal_text parts carry image references as asset_pointers
    // (e.g. "file-service://file-XXXX"); harvest those as attachments too.
    const parts = msg.content?.parts;
    if (Array.isArray(parts)) {
        for (const p of parts) {
            if (!p || typeof p !== 'object' || !('asset_pointer' in p) || typeof p.asset_pointer !== 'string') continue;
            const m = /^file-service:\/\/([A-Za-z0-9_-]+)$/.exec(p.asset_pointer.trim());
            if (!m) continue;
            pushAttachment({ id: m[1], isImage: true });
        }
    }

    return { attachments, mediaEntries };
}

/**
 * Walks current_node -> parent to the root, yielding oldest-first messages.
 * Keeps user/assistant/system text nodes; folds "thoughts" nodes into the
 * following assistant message's `thoughts`; skips tool and unknown nodes.
 */
function extractMessages(
    raw: OpenAiRawConversation,
    resolveMedia: MediaResolver,
    nameByDat: Record<string, string>
): { messages: ChatMessage[]; mediaEntries: OpenAiMediaEntry[] } {
    const mapping = raw.mapping;
    if (!mapping || typeof mapping !== 'object') return { messages: [], mediaEntries: [] };
    const visited = new Set<string>();
    const chain: OpenAiMappingNode[] = [];
    let nodeId: unknown = raw.current_node;
    let guard = 0;
    while (nodeId && guard++ < 100000) {
        const key = String(nodeId);
        if (visited.has(key)) break;
        visited.add(key);
        const node = mapping[key];
        if (!node || typeof node !== 'object') break;
        chain.push(node);
        nodeId = node.parent;
    }
    chain.reverse();

    const messages: ChatMessage[] = [];
    const mediaEntries: OpenAiMediaEntry[] = [];
    let pendingThoughts: string[] = [];
    for (const node of chain) {
        const msg = node.message;
        if (!msg || typeof msg !== 'object') continue;
        const role = msg.author?.role;
        const contentType = msg.content?.content_type;
        if (contentType === 'thoughts') {
            const parts = Array.isArray(msg.content?.parts) ? msg.content.parts : undefined;
            const thoughts = Array.isArray(msg.content?.thoughts) ? msg.content.thoughts : undefined;
            const t = textOf(parts) || thoughtsText(thoughts);
            if (t) pendingThoughts.push(t);
            continue;
        }
        if (contentType !== 'text' && contentType !== 'multimodal_text') continue;
        if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
        const chatMsg: ChatMessage = {
            role,
            content: textOf(Array.isArray(msg.content?.parts) ? msg.content.parts : undefined),
            // Missing timestamp stays null so merge never overwrites authoritative data
            timestamp: toMs(msg.create_time),
        };
        if (node.id) chatMsg.id = String(node.id);
        if (role === 'assistant' && pendingThoughts.length > 0) {
            chatMsg.thoughts = pendingThoughts.length === 1 ? pendingThoughts[0] : [...pendingThoughts];
            pendingThoughts = [];
        }
        if (role === 'user') {
            const { attachments, mediaEntries: userMedia } = buildAttachments(msg, resolveMedia, nameByDat);
            if (attachments.length > 0) chatMsg.attachments = attachments;
            if (userMedia.length > 0) mediaEntries.push(...userMedia);
        }
        messages.push(chatMsg);
    }
    return { messages, mediaEntries };
}

function parseOpenAiConversation(
    raw: OpenAiRawConversation,
    resolveMedia: MediaResolver,
    nameByDat: Record<string, string>
): { conv: Conversation; mediaEntries: OpenAiMediaEntry[] } | null {
    const rawId = (typeof raw.id === 'string' && raw.id)
        || (typeof raw.conversation_id === 'string' && raw.conversation_id)
        || '';
    if (!rawId) return null;
    const title = (typeof raw.title === 'string' && raw.title.trim()) ? raw.title.trim() : 'Untitled chat';
    const ts = toMs(raw.update_time);
    const { messages, mediaEntries } = extractMessages(raw, resolveMedia, nameByDat);
    const conv: Conversation = {
        id: rawId,
        title,
        titleSource: 'openai',
        titles: { openai: title },
        url: `https://chatgpt.com/c/${rawId}`,
        href: `https://chatgpt.com/c/${rawId}`,
        // Missing timestamp stays null so merge does not overwrite authoritative data
        timestamp: ts,
        lastSeen: ts ? new Date(ts).toISOString() : '',
        source: 'openai-import',
        messageCount: messages.length,
        messages,
    };
    return { conv, mediaEntries };
}

/**
 * Main entry: unpacks a ChatGPT data-export ZIP and converts
 * conversations.json into Conversation[] (+ offline media indexes).
 */
export async function parseOpenAiZip(
    file: unknown,
    onProgress?: ((pct: number, msg: string) => void) | null,
    slot: string | null = null
): Promise<OpenAiParseResult> {
    const loader = getZipLoader();

    const guard = ZipBombGuard;
    if (guard?.validateZipFile) {
        guard.validateZipFile(file);
    }

    if (onProgress) onProgress(15, '正在解压 ChatGPT 导出压缩包...');

    const rawZip = isOpenAiZipInstance(file)
        ? file
        : await loader.loadAsync(file);
    if (!isOpenAiZipInstance(rawZip)) {
        throw new TakeoutParseError('ZIP 格式解析失败或内容无效', false);
    }
    const zip = rawZip;
    if (guard?.validateZipEntries) {
        guard.validateZipEntries(zip);
    }

    if (onProgress) onProgress(40, '正在扫描 ChatGPT 导出结构...');

    const convFile = findConversationsJson(zip);
    if (!convFile) {
        throw new TakeoutParseError('未在 ZIP 中找到 ChatGPT 导出记录 (conversations.json)', false);
    }

    // Memory guardrail: check uncompressed size before loading full text (fail-closed).
    const MAX_BYTES = MAX_CONVERSATIONS_UNCOMPRESSED_SIZE;
    const uncompressedSize = convFile._data?.uncompressedSize;
    if (typeof uncompressedSize !== 'number') {
        throw new TakeoutParseError('无法确认 ChatGPT 导出记录的解压体积，已中止以防内存溢出。', false, convFile.name);
    }
    if (uncompressedSize > MAX_BYTES) {
        const sizeMb = (uncompressedSize / 1024 / 1024).toFixed(1);
        const limitMb = (MAX_BYTES / 1024 / 1024).toFixed(0);
        throw new TakeoutParseError(
            `ChatGPT 导出记录 (conversations.json) 解压体积过大 (${sizeMb}MB)，超过 ${limitMb}MB 内存安全上限。建议在 ChatGPT 导出时分批导出后重试。`,
            false,
            convFile.name
        );
    }

    const jsonText = await readZipText(convFile);
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new TakeoutParseError('conversations.json 不是有效的 JSON，已中止解析。', false, convFile.name);
    }
    if (!Array.isArray(parsed)) {
        throw new TakeoutParseError('conversations.json 不是有效的对话数组，已中止解析。', false, convFile.name);
    }

    if (onProgress) onProgress(70, '正在解析对话并建立离线媒体索引...');

    const { globalMedia, totalMediaCount } = buildMediaIndex(zip);
    const nameByDat = await applyAssetNameAliases(zip, globalMedia);
    const resolveMedia: MediaResolver = (datName: string) =>
        globalMedia[datName] || globalMedia[datName.toLowerCase()] || null;

    const extractedMap: Record<string, Conversation> = {};
    const convCache: Record<string, Conversation> = {};
    const mediaMap: Record<string, OpenAiMediaEntry[]> = {};

    for (const raw of parsed) {
        if (!isOpenAiRawConversation(raw)) continue;
        const parsedConv = parseOpenAiConversation(raw, resolveMedia, nameByDat);
        if (!parsedConv) continue;
        const { conv, mediaEntries } = parsedConv;
        const key = normId(conv.id);
        extractedMap[key] = conv;
        convCache[key] = conv;
        if (mediaEntries.length > 0) {
            mediaMap[key] = (mediaMap[key] || []).concat(mediaEntries);
        }
    }

    const conversations: Conversation[] = Object.values(extractedMap);
    if (onProgress) onProgress(100, `ChatGPT 导出解析完成，共发现 ${conversations.length} 条对话与 ${totalMediaCount} 个离线资源`);

    // NOTE(v1): intentionally NOT calling MediaIndex.commitTakeoutData here.
    // Committing would replace the slot's Gemini takeout store; the caller
    // decides how to merge. slot is accepted for signature parity.
    void slot;

    return {
        conversations,
        totalMediaCount,
        convCache,
        mediaMap,
        globalMedia,
    };
}

export const OpenAiParser: OpenAiParserModule = {
    parseOpenAiZip,
};

export default OpenAiParser;
