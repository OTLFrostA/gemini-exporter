import type { ResourceResult, ResourceDelivery } from '../resources/resourceResult.js';
// src/core/engine/liveSaveWriter.ts
// Shared "format chat -> write markdown file via FsWriter" used by live-save.
//
// Content and background live-save share the async Domain → Document AST Markdown route,
// writer setup and "CleanTitle_Cid6.md" filename format. Formatting failures
// propagate to the caller's existing error handling.
//
// Context-specific orchestration stays at the call sites:
// - content side keeps its own image asset pipeline (processAndSaveImages),
// - background side keeps permission checks, dir probing, the base64 asset
//   loop and export-record bookkeeping.

import { isLiveSaveFormatSupported } from '../storage/liveStorageManager.js';
import { FsWriter } from './writers/fsWriter.js';
import { ChatFormatter } from './chatFormatter.js';
import type { ResourceConversationParseResult } from '../parsers/parsingResult.js';
import { buildExportFileName, sanitizeRelativePath } from '../utils/pathUtils.js';
import { DEFAULT_EXPORT_FOLDER_NAME } from '../utils/constants.js';

export interface LiveSaveWriteInput {
    chat: ResourceConversationParseResult;
    safeTitle: string;
    nid: string;
    resourceResults?: readonly ResourceResult<ResourceDelivery>[];
}

export interface LiveSaveWriterDeps {
    fsWriterClass?: new (dirHandle: any, rootDir: string) => FsWriter;
    formatter?: Pick<typeof ChatFormatter, 'formatMarkdownDocument'>;
    buildFileName?: (safeTitle: string, nid: string, ext: string) => string;
}

export interface LiveSaveWriter {
    init(): Promise<void>;
    writeFile(subDir: string, fileName: string, data: string | Uint8Array): Promise<string | void>;
}

const LIVE_SAVE_ROOT_DIR = DEFAULT_EXPORT_FOLDER_NAME;

export async function createLiveSaveWriter(
    dirHandle: any,
    deps: LiveSaveWriterDeps = {}
): Promise<LiveSaveWriter> {
    const WriterCls = deps.fsWriterClass || FsWriter;
    const writer = new WriterCls(dirHandle, LIVE_SAVE_ROOT_DIR);
    await writer.init();
    // The LiveSaveWriter facade keeps its (subDir, fileName, data) API, but the
    // underlying writer only supports (relativePath, content, options?) since the
    // legacy 3-arg overload was retired. Translate explicitly here instead of
    // relying on the removed overload dispatch (previously via an unsafe cast).
    return {
        init: () => writer.init(),
        writeFile: (subDir: string, fileName: string, data: string | Uint8Array): Promise<string> =>
            writer.writeFile(subDir ? `${subDir}/${fileName}` : fileName, data),
    };
}

export async function formatLiveSaveMarkdown(
    input: LiveSaveWriteInput,
    deps: LiveSaveWriterDeps = {}
): Promise<{ fileName: string; markdown: string }> {
    const buildFileName = deps.buildFileName || buildExportFileName;
    const formatter = deps.formatter ?? ChatFormatter;
    const fileName = buildFileName(input.safeTitle, input.nid, 'md');
    const shaped = { ...input.chat, conversation: { ...input.chat.conversation, title: input.safeTitle, id: input.nid } };
    const { content: markdown } = await formatter.formatMarkdownDocument(shaped, { resourceResults: input.resourceResults });
    return { fileName, markdown };
}

export async function writeLiveSaveMarkdown(
    writer: LiveSaveWriter,
    input: LiveSaveWriteInput,
    deps: LiveSaveWriterDeps = {},
    opts: { fileName?: string } = {}
): Promise<string> {
    const { fileName, markdown } = await formatLiveSaveMarkdown(input, deps);
    const targetFile = opts.fileName || fileName;
    if (!await isLiveSaveFormatSupported()) throw new Error('Live save only supports Markdown');
    const written = await writer.writeFile('', targetFile, markdown);
    return typeof written === 'string' && written ? written : sanitizeRelativePath(targetFile);
}
