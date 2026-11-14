import { OperationError } from '../../../shared/errors/operationError.js';
import { decodeChatGPTDetail } from '../../parsers/chatgpt/decodeDetail.js';
import { parseOpenAIConversation } from '../../parsers/chatgpt/parseExportConversation.js';
import type { SourceConversationParseResult } from '../../parsers/parsingResult.js';
import { readOpenAIArchive, type OpenAIArchive, type OpenAIArchiveEntry } from './readArchive.js';

interface LibraryFile { id: string; name?: string; mediaType?: string; conversationId?: string }

export interface ParsedOpenAIArchiveConversation {
    conversationId: string;
    parsed: SourceConversationParseResult;
    boundEntries: ReadonlyMap<string, OpenAIArchiveEntry>;
    missingAssets: number;
}

export interface ParsedOpenAIArchive {
    conversationCount: number;
    conversations: readonly ParsedOpenAIArchiveConversation[];
    skippedEmpty: number;
    missingAssets: number;
}

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function array(value: unknown): value is unknown[] { return Array.isArray(value); }

async function libraryFiles(archive: OpenAIArchive): Promise<LibraryFile[]> {
    const rows: unknown[] = [];
    for (const path of archive.logicalPaths('library_files.json')) {
        const raw = await archive.json(path);
        if (!array(raw)) throw new TypeError('Invalid OpenAI file library');
        for (const row of raw) rows.push(row);
    }
    return rows.flatMap(value => record(value) && typeof value.file_id === 'string' ? [{
        id: value.file_id,
        ...(typeof value.origination_thread_id === 'string' ? { conversationId: value.origination_thread_id } : {}),
        ...(typeof value.file_name === 'string' ? { name: value.file_name } : {}),
        ...(typeof value.mime_type === 'string' ? { mediaType: value.mime_type } : {}),
    }] : []);
}

function bindResource(archive: OpenAIArchive, uri: string, library: readonly LibraryFile[], conversationId: string): { entry: OpenAIArchiveEntry; file?: LibraryFile } | undefined {
    let locator: string;
    try { locator = decodeURIComponent(uri); } catch { return undefined; }
    let id = locator.replace(/^(?:sediment:\/\/|file-service:\/\/|file-download:)/, '');
    if (locator.startsWith('sandbox:/mnt/data/')) {
        const name = locator.slice('sandbox:/mnt/data/'.length);
        const direct = archive.entries.get(name);
        if (direct) return { entry: direct };
        const matches = library.filter(file => file.name === name && file.conversationId === conversationId);
        if (matches.length !== 1) return undefined;
        id = matches[0].id;
    }
    const metadata = library.find(file => file.id === id);
    // IDs and paths must match whole names; never select the first prefix match.
    const direct = archive.entries.get(id) ?? archive.entries.get(`${id}.dat`);
    if (direct) return { entry: direct, file: metadata };
    const candidates = [...archive.entries.values()].filter(entry => {
        const base = entry.path.split('/').at(-1) ?? '';
        return base === id || base === `${id}.dat` || base.startsWith(`${id}-`);
    });
    return candidates.length === 1 ? { entry: candidates[0], file: metadata } : undefined;
}

/** Pure L1 OpenAI ZIP decoding and resource binding without L2 admission or Runtime calls. */
export async function parseOpenAIExportArchive(
    file: Blob | Uint8Array,
    expectedProviderAccountId: string,
    onDecoded?: () => void,
): Promise<ParsedOpenAIArchive> {
    const archive = await readOpenAIArchive(file);
    const paths = archive.logicalPaths('conversations.json');
    if (!paths.length) throw new OperationError('ARCHIVE_CONVERSATIONS_MISSING', 'OpenAI ZIP does not contain conversations.json');
    if (archive.entries.has('user.json')) {
        const user = await archive.json('user.json');
        let identity: unknown;
        try { identity = JSON.parse(expectedProviderAccountId); }
        catch { throw new OperationError('ARCHIVE_USER_MISMATCH', 'OpenAI ZIP belongs to a different ChatGPT user'); }
        if (!record(user) || typeof user.id !== 'string' || !array(identity) || identity[0] !== user.id) {
            throw new OperationError('ARCHIVE_USER_MISMATCH', 'OpenAI ZIP belongs to a different ChatGPT user');
        }
    }
    const library = await libraryFiles(archive);
    // Decode all source rows before committing any of them: malformed shards cannot cause a half-import.
    const decoded = [];
    for (const path of paths) {
        const rows = await archive.json(path);
        if (!array(rows)) throw new TypeError('Invalid OpenAI conversations.json');
        for (const row of rows) {
            if (!record(row)) throw new TypeError('Invalid OpenAI conversation');
            const id = row.id ?? row.conversation_id;
            if (typeof id !== 'string' || !id.trim() || id !== id.trim()) throw new TypeError('Invalid OpenAI conversation identity');
            decoded.push(decodeChatGPTDetail(row, id));
        }
    }
    onDecoded?.();
    const conversations: ParsedOpenAIArchiveConversation[] = [];
    let skippedEmpty = 0;
    let missingAssets = 0;
    for (const conversation of decoded) {
        const parsed = parseOpenAIConversation(conversation);
        if (!parsed.conversation.detail.messages.length) { skippedEmpty++; continue; }
        const bound = new Map<string, OpenAIArchiveEntry>();
        let itemMissing = 0;
        for (const asset of parsed.conversation.detail.assets) {
            const resource = bindResource(archive, asset.sourceUri ?? asset.id, library, conversation.id);
            if (!resource || resource.entry.size === 0) { itemMissing++; continue; }
            bound.set(asset.id, resource.entry);
            asset.name ??= resource.file?.name ?? resource.entry.path.split('/').at(-1);
            asset.mediaType ??= resource.file?.mediaType;
            asset.byteLength = resource.entry.size;
        }
        missingAssets += itemMissing;
        conversations.push({ conversationId: conversation.id, parsed, boundEntries: bound, missingAssets: itemMissing });
    }
    return { conversationCount: new Set(decoded.map(conversation => conversation.id)).size, conversations, skippedEmpty, missingAssets };
}
