// src/core/engine/liveSaveWriter.ts
// Shared "format chat -> write markdown file via FsWriter" used by live-save.
//
// Previously this logic existed twice: content/liveSaveCoordinator.ts
// (writeConversationToDisk) and background/liveSaveHandler.ts
// (handleLiveSaveViaHandle) each reimplemented writer setup, the
// "CleanTitle_Cid6.md" filename format and the markdown fallback template.
// Both call sites now converge here so the filename format and fallback
// template cannot drift apart again.
//
// Context-specific orchestration stays at the call sites:
// - content side keeps its own image asset pipeline (processAndSaveImages),
// - background side keeps permission checks, dir probing, the base64 asset
//   loop and export-record bookkeeping.

import { FsWriter } from './writers/fsWriter.js';
import { ChatFormatter } from './chatFormatter.js';
import { buildExportFileName } from '../utils/pathUtils.js';
import { DEFAULT_EXPORT_FOLDER_NAME } from '../utils/constants.js';

export interface LiveSaveWriteInput {
    chat: any;
    safeTitle: string;
    nid: string;
}

export interface LiveSaveWriterDeps {
    /** Injectable for tests / DI (content side). Defaults to FsWriter. */
    fsWriterClass?: new (dirHandle: any, rootDir: string) => FsWriter;
    /** Injectable for tests / DI (content side). Defaults to ChatFormatter. */
    formatter?: { toMarkdown?: (chat: any) => string } | null;
    /** Injectable for tests / DI. Defaults to buildExportFileName. */
    buildFileName?: (safeTitle: string, nid: string, ext: string) => string;
}

export interface LiveSaveWriter {
    init(): Promise<void>;
    writeFile(subDir: string, fileName: string, data: string | Uint8Array): Promise<void>;
}

const LIVE_SAVE_ROOT_DIR = DEFAULT_EXPORT_FOLDER_NAME;

/**
 * Create and init the FsWriter for the live-save root folder.
 */
export async function createLiveSaveWriter(
    dirHandle: any,
    deps: LiveSaveWriterDeps = {}
): Promise<LiveSaveWriter> {
    const WriterCls = deps.fsWriterClass || FsWriter;
    const writer = new WriterCls(dirHandle, LIVE_SAVE_ROOT_DIR);
    await writer.init();
    return writer as unknown as LiveSaveWriter;
}

/**
 * Filename + markdown for one live-save write, shared by both pipelines.
 */
export function formatLiveSaveMarkdown(
    input: LiveSaveWriteInput,
    deps: LiveSaveWriterDeps = {}
): { fileName: string; markdown: string } {
    const buildFileName = deps.buildFileName || buildExportFileName;
    const formatter = deps.formatter !== undefined ? deps.formatter : ChatFormatter;
    const fileName = buildFileName(input.safeTitle, input.nid, 'md');
    const shaped = { ...input.chat, title: input.safeTitle, id: input.nid };
    const markdown = (formatter as any)?.toMarkdown
        ? (formatter as any).toMarkdown(shaped)
        : `# ${input.safeTitle}\n\n${JSON.stringify(input.chat?.messages || [], null, 2)}`;
    return { fileName, markdown };
}

/**
 * Format one conversation and write its markdown file.
 * Returns the file name that was written (honors opts.fileName override).
 */
export async function writeLiveSaveMarkdown(
    writer: LiveSaveWriter,
    input: LiveSaveWriteInput,
    deps: LiveSaveWriterDeps = {},
    opts: { fileName?: string } = {}
): Promise<string> {
    const { fileName, markdown } = formatLiveSaveMarkdown(input, deps);
    const targetFile = opts.fileName || fileName;
    await writer.writeFile('', targetFile, markdown);
    return targetFile;
}
