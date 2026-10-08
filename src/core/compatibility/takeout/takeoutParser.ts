import { persistNativeConversation } from '../../storage/domain/nativePersistence.js';
import type { StoredDomainResource } from '../../storage/domain/contracts.js';
import { ZipBombGuard } from '../archive/zipBombGuard.js';
import { I18n } from '../../utils/i18n.js';
import { __resolveModule } from '../../utils/moduleOverrides.js';
import { MediaIndex, readTakeoutBytes, type TakeoutStore } from './mediaIndex.js';
import { stripHtmlTags } from '../../parsers/gemini/takeout/decodeHtml.js';
import { parseGeminiTakeoutZipArchive, type GeminiTakeoutZipRaw } from '../../parsers/gemini/takeout/parseZip.js';
import { createParsedConversationView } from '../record/projectDomainRecord.js';
import { TakeoutParseError } from '../../../types/errors.js';
import type { Conversation } from '../../../types/index.js';
import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';

export interface TakeoutParseResult extends TakeoutStore {
    conversations: Conversation[];
    totalMediaCount: number;
    diagnostics: DocumentDiagnostic[];
}
export interface TakeoutParserModule {
    stripHtmlTags: typeof stripHtmlTags;
    parseTakeoutZip: typeof parseTakeoutZip;
}
export { stripHtmlTags };

/** UI/acquisition adapter: native parsing precedes the one-way storage projection. */
export async function parseTakeoutZip(file: unknown, onProgress?: ((pct: number, msg: string) => void) | null, slot: string | null = null): Promise<TakeoutParseResult> {
    const i18n = __resolveModule('I18n', I18n);
    onProgress?.(15, i18n.t('takeoutUnzipping'));
    ZipBombGuard.validateZipFile(file);
    let inventory: Record<string, unknown> = {};
    const suppliedArchive = file !== null && typeof file === 'object' && 'files' in file;
    const bytes = suppliedArchive ? new Uint8Array() : file as GeminiTakeoutZipRaw;
    const loader: unknown = (globalThis as { JSZip?: unknown }).JSZip;
    const readArchive = async (): Promise<unknown> => {
        if (suppliedArchive) return file;
        if (!loader || (typeof loader !== 'object' && typeof loader !== 'function') || typeof (loader as { loadAsync?: unknown }).loadAsync !== 'function') throw new TypeError('JSZip 库未加载，无法解析 ZIP');
        return (loader as { loadAsync: (raw: GeminiTakeoutZipRaw) => Promise<unknown> }).loadAsync(bytes);
    };
    const results = await parseGeminiTakeoutZipArchive(bytes, { providerId: 'gemini', onProgress: (completed, total) => onProgress?.(70 + Math.floor(completed / total * 18), i18n.t('takeoutParsingDetailProgress', completed, total)), readArchive: async () => {
        const archive = await readArchive();
        ZipBombGuard.validateZipEntries(archive);
        if (archive && typeof archive === 'object' && 'files' in archive && archive.files && typeof archive.files === 'object') inventory = archive.files as Record<string, unknown>;
        onProgress?.(40, i18n.t('takeoutParsingStructure'));
        onProgress?.(70, i18n.t('takeoutParsingDetail'));
        return archive;
    } }).catch((error: unknown) => {
        if (error instanceof TakeoutParseError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('no recognized conversation identities') || message.includes('Unsupported Takeout')) throw new TakeoutParseError(i18n.t('takeoutFormatChanged'), true, 'MyActivity.html');
        throw new TakeoutParseError(message, false);
    });
    const store: TakeoutStore = { convCache: {}, mediaMap: {}, globalMedia: {} };
    const conversations: Conversation[] = [];
    const basenames = new Map<string, unknown[]>();
    for (const [path, entry] of Object.entries(inventory)) {
        if (!entry || typeof entry !== 'object' || ('dir' in entry && entry.dir)) continue;
        store.globalMedia[path] = entry;
        const basename = path.split('/').pop()!;
        basenames.set(basename, [...(basenames.get(basename) ?? []), entry]);
    }
    for (const [name, entries] of basenames) if (entries.length === 1) store.globalMedia[name] = entries[0] as TakeoutStore['globalMedia'][string];
    for (const result of results) {
        const view = createParsedConversationView(result);
        const id = result.conversation.id;
        const hasExplicitPrompt = result.conversation.messages.some(message => message.role === 'user');
        const durableResources: StoredDomainResource[] = [];
        store.convCache[id] = { ...view, source: 'takeout-offline', hasExplicitPrompt };
        // Only source-bound resources are available to native consumers. An unresolved
        // or ambiguous reference cannot fall through to a second filename heuristic.
        for (const [assetId, bound] of Object.entries(result.archiveResources)) {
            const bytes = await readTakeoutBytes(bound.entry);
            if (!bytes) throw new Error(`Cannot persist Takeout resource: ${bound.path}`);
            durableResources.push({ assetId, bytes, sourcePath: bound.path });
            const path = view.parsed.resourceHints[assetId].archivePath!;
            store.globalMedia[path] = bound.entry;
            store.globalMedia[bound.path] = bound.entry;
            (store.mediaMap[id] ??= []).push({ filename: path, fileObj: bound.entry });
        }
        await persistNativeConversation(slot || 'u0', view, durableResources);
        // Preserve metadata-only import writes: Takeout fragments must never replace
        // a fuller detail already in storage. The runtime cache owns parsed bodies.
        const domain = result.conversation;
        conversations.push({ id, title: domain.title, titleSource: 'takeout', titles: { ...domain.titles },
            url: domain.url, href: domain.url, timestamp: domain.timestamp,
            lastSeen: domain.timestamp ? new Date(domain.timestamp).toISOString() : '', source: 'takeout-import',
            messageCount: domain.messages.length, attachmentCount: domain.assets.length, hasExplicitPrompt });
        if (conversations.length % 50 === 0) await new Promise<void>(resume => setTimeout(resume, 0));
    }
    const totalMediaCount = Object.entries(inventory).filter(([path, entry]) => entry && typeof entry === 'object' && !('dir' in entry && entry.dir) && !/\.(html|json)$/i.test(path)).length;
    MediaIndex.commitTakeoutData(slot, store);
    onProgress?.(100, i18n.t('takeoutSuccessSummary', conversations.length, totalMediaCount));
    return { ...store, conversations, totalMediaCount, diagnostics: results.flatMap(result => result.diagnostics) };
}
export const TakeoutParser: TakeoutParserModule = { stripHtmlTags, parseTakeoutZip };
export default TakeoutParser;
