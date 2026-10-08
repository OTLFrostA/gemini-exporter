import { validateZipFile, validateZipEntries } from '../../shared/archive/zipBombGuard.js';
import { parseGeminiTakeoutConversation, parseGeminiTakeoutArchiveAsync, type GeminiTakeoutRaw, type GeminiTakeoutParseContext, type GeminiTakeoutParseResult, type TakeoutSourceFile } from './parseConversation.js';

export type GeminiTakeoutZipRaw = Uint8Array | ArrayBuffer | Blob;
export type TakeoutArchiveReader = (bytes: GeminiTakeoutZipRaw) => Promise<unknown>;
export interface GeminiTakeoutZipContext extends GeminiTakeoutParseContext {
    readArchive?: TakeoutArchiveReader;
    activityPath?: string;
    onProgress?: (completed: number, total: number) => void;
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
async function defaultArchiveReader(bytes: GeminiTakeoutZipRaw): Promise<unknown> {
    const loader: unknown = (globalThis as { JSZip?: unknown }).JSZip;
    if ((!isRecord(loader) && typeof loader !== 'function') || typeof (loader as { loadAsync?: unknown }).loadAsync !== 'function') throw new TypeError('Takeout ZIP requires an archive reader');
    return (loader as { loadAsync: TakeoutArchiveReader }).loadAsync(bytes);
}
async function decodeArchive(bytes: GeminiTakeoutZipRaw, context: GeminiTakeoutZipContext): Promise<GeminiTakeoutRaw> {
    if (context.providerId !== 'gemini') throw new TypeError('Gemini Takeout parser requires providerId gemini');
    validateZipFile(bytes);
    const archive = await (context.readArchive ?? defaultArchiveReader)(bytes);
    if (!isRecord(archive) || !isRecord(archive.files)) throw new TypeError('Invalid Takeout archive inventory');
    validateZipEntries(archive);
    const files: Record<string, TakeoutSourceFile> = {};
    for (const [path, entry] of Object.entries(archive.files)) {
        if (!isRecord(entry) || (entry.dir !== undefined && typeof entry.dir !== 'boolean')) continue;
        files[path] = entry as TakeoutSourceFile;
    }
    const candidates = Object.keys(files).filter(path => !files[path].dir && /(?:My\s?Activity|我的活动).*\.html$/i.test(path));
    const gemini = candidates.filter(path => /(?:^|\/)(?:Gemini(?: Apps)?|Bard)\//i.test(path));
    const supported = gemini.length ? gemini : candidates;
    const activityPath = context.activityPath ?? (supported.length === 1 ? supported[0] : undefined);
    if (!activityPath || !files[activityPath] || files[activityPath].dir) throw new TypeError('Takeout ZIP requires an unambiguous activityPath');
    const activity = files[activityPath];
    const size = activity._data?.uncompressedSize;
    if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || size > 250 * 1024 * 1024) throw new TypeError('Takeout HTML uncompressed size is unknown or exceeds the supported limit');
    if (typeof activity.async !== 'function') throw new TypeError('Takeout activity entry cannot be read');
    const htmlText = await activity.async('text');
    if (typeof htmlText !== 'string') throw new TypeError('Takeout activity entry must decode to HTML text');
    return { htmlText, activityPath, archiveFiles: files };
}

/** Raw ZIP bytes -> selected Domain conversation; extraction stays inside the parser. */
export async function parseGeminiTakeoutZip(bytes: GeminiTakeoutZipRaw, context: GeminiTakeoutZipContext): Promise<GeminiTakeoutParseResult> {
    return parseGeminiTakeoutConversation(await decodeArchive(bytes, context), context);
}
export async function parseGeminiTakeoutZipArchive(bytes: GeminiTakeoutZipRaw, context: GeminiTakeoutZipContext): Promise<GeminiTakeoutParseResult[]> {
    return parseGeminiTakeoutArchiveAsync(await decodeArchive(bytes, context), context, context.onProgress);
}
