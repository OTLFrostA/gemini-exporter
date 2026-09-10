// src/content/liveSaveCoordinator.ts - Coordinator for live auto-saving (IndexedDB + Disk FsWriter)
import { contentContext } from './contentContext.js';
import { LiveStorageManager } from '../core/storage/liveStorageManager.js';
import { DomScraper } from './domScraper.js';
import { ChatFormatter } from '../core/engine/chatFormatter.js';
import { FsWriter } from '../core/engine/writers/fsWriter.js';
import { GeminiUtils } from '../core/utils/utils.js';
import { GeminiAPIClient } from '../core/api/geminiClient.js';
import { BadgeView } from './badgeView.js';
import { AssetFetcher, inferImageExt } from './assetFetcher.js';
import type { LiveConversationRecord, LiveSaveConfig } from '../types/liveSave.js';

export interface LiveSaveCoordinatorDeps {
    storageManager?: typeof LiveStorageManager;
    scraper?: typeof DomScraper;
    formatter?: typeof ChatFormatter;
    fsWriterClass?: typeof FsWriter;
    utils?: typeof GeminiUtils;
    clientClass?: typeof GeminiAPIClient;
    badge?: typeof BadgeView;
    assetFetcher?: typeof AssetFetcher;
}

let _deps: LiveSaveCoordinatorDeps = {};
let _isSaving = false;
let _saveQueue = Promise.resolve<any>(null);

function getStorage() {
    return _deps.storageManager || LiveStorageManager;
}

function getScraper() {
    return _deps.scraper || DomScraper;
}

function getFormatter() {
    return _deps.formatter || ChatFormatter;
}

function getFsWriterClass() {
    return _deps.fsWriterClass || FsWriter;
}

function getUtils() {
    return _deps.utils || GeminiUtils;
}

function getClientClass() {
    return typeof _deps.clientClass !== 'undefined' ? _deps.clientClass : GeminiAPIClient;
}

function getBadge() {
    return _deps.badge || BadgeView;
}

function getAssetFetcher() {
    return _deps.assetFetcher || AssetFetcher;
}

function isDev(): boolean {
    return contentContext.isDevMode();
}

export function init(deps: LiveSaveCoordinatorDeps = {}): void {
    _deps = deps;
    if (isDev()) console.log('[LiveSaveCoordinator] Initialized');
}

/**
 * Fetch full conversation detail by ID using Client RPC first, then fallback to DOM.
 */
export async function resolveConversationDetail(cid: string): Promise<any> {
    const nid = String(cid).replace(/^c_/, '').trim();
    const ClientClass = getClientClass();

    if (ClientClass) {
        try {
            const client = new ClientClass();
            const detail = await client.getConversationDetail(nid);
            if (detail && Array.isArray(detail.messages) && detail.messages.length > 0) {
                return detail;
            }
        } catch (e) {
            if (isDev()) console.debug('[LiveSaveCoordinator] RPC fetch detail fallback to DOM:', e);
        }
    }

    // Fallback to DOM scraper
    const Scraper = getScraper();
    if (Scraper && typeof Scraper.parseDoc === 'function') {
        const doc = typeof document !== 'undefined' ? document : null;
        try {
            const docResult = Scraper.parseDoc(doc as any, nid);
            if (docResult && Array.isArray(docResult.messages) && docResult.messages.length > 0) {
                return docResult;
            }
        } catch {
            /* intentional */
        }
    }

    return null;
}

/**
 * Execute a live auto-save cycle for the specified conversation.
 */
export async function executeLiveSave(cid: string, reason = 'turn_complete'): Promise<boolean> {
    if (!cid) return false;
    const nid = String(cid).replace(/^c_/, '').trim();

    // Serialize live save operations to prevent I/O race conditions
    _saveQueue = _saveQueue.then(async () => {
        try {
            _isSaving = true;
            const Storage = getStorage();
            const config: LiveSaveConfig = await Storage.getLiveConfig();

            // If neither DB nor Disk is enabled, do nothing
            if (!config.enabledDb && !config.enabledDisk) {
                return false;
            }

            const chat = await resolveConversationDetail(nid);
            if (!chat || !Array.isArray(chat.messages) || chat.messages.length === 0) {
                if (isDev()) console.warn('[LiveSaveCoordinator] No messages extracted for', nid);
                return false;
            }

            const Utils = getUtils();
            const rawTitle = chat.title || (typeof document !== 'undefined' ? document.title : '') || 'Untitled';
            const safeTitle = Utils?.cleanTitle ? Utils.cleanTitle(rawTitle) : rawTitle.trim();
            const now = Date.now();

            // 1. Tier 1: Internal IndexedDB Snapshot Persistence
            if (config.enabledDb) {
                const record: Partial<LiveConversationRecord> & { id: string } = {
                    id: nid,
                    title: safeTitle,
                    messages: chat.messages,
                    timestamp: chat.timestamp || chat.updatedAt || now,
                    updatedAt: chat.updatedAt || now,
                    turnCount: chat.messages.length,
                    accountSlot: chat.accountSlot || 'u0',
                    format: config.format || 'markdown',
                    hasImages: chat.messages.some((m: any) =>
                        (Array.isArray(m.attachments) && m.attachments.length > 0) ||
                        (Array.isArray(m.images) && m.images.length > 0) ||
                        (typeof m.content === 'string' && /!\[[^\]]*\]\(https?:\/\/[^\s\)]+\)/.test(m.content))
                    )
                };
                await Storage.saveLiveConversation(record);
            }

            // 2. Tier 2: Direct Disk Write via FileSystem Access API
            if (config.enabledDisk) {
                const dirHandle = await Storage.getLiveDirHandle();
                if (dirHandle) {
                    await writeConversationToDisk(chat, safeTitle, nid, dirHandle, config);
                } else if (isDev()) {
                    console.warn('[LiveSaveCoordinator] Disk save enabled but no dirHandle stored');
                }
            }

            // 3. Update configuration metadata
            await Storage.setLiveConfig({
                lastSavedAt: now,
                lastSavedTitle: safeTitle
            });

            // 4. Visual Feedback via Badge
            const Badge = getBadge();
            if (Badge && typeof (Badge as any).showLiveSaveFeedback === 'function') {
                (Badge as any).showLiveSaveFeedback(safeTitle);
            }

            if (isDev()) {
                console.log(`[LiveSaveCoordinator] Successfully live-saved conversation ${nid} ("${safeTitle}")`);
            }
            return true;
        } catch (err) {
            console.error('[LiveSaveCoordinator] executeLiveSave failed for', nid, err);
            return false;
        } finally {
            _isSaving = false;
        }
    });

    return _saveQueue;
}

interface ImageDownloadTarget {
    url: string;
    fileName: string;
    localName: string;
    alt: string;
    saved?: boolean;
}

function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

/**
 * Sniff, download, and persist all multimodal images to attachments/ subfolder,
 * and rewrite references in chat to local relative paths.
 */
export async function processAndSaveImages(chat: any, nid: string, writer: any): Promise<void> {
    if (!chat || !Array.isArray(chat.messages) || chat.messages.length === 0) return;

    const Utils = getUtils();
    const cid8 = nid.slice(0, 8);
    const targets = new Map<string, ImageDownloadTarget>();

    let imgCounter = 0;

    const registerTarget = (rawUrl: string, candidateName?: string, altText?: string, turnIndex = 0) => {
        if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.startsWith('http')) return;
        if (targets.has(rawUrl)) return;

        imgCounter++;
        const hash4 = Math.abs(hashString(rawUrl)).toString(36).slice(0, 4);
        let ext = inferImageExt('', rawUrl);

        let finalName = '';
        if (candidateName && candidateName.trim() && !/^(?:image|photo|picture|img|file)(?:\.[a-z0-9]+)?$/i.test(candidateName.trim())) {
            const sanitized = Utils?.sanitizeFileName
                ? Utils.sanitizeFileName(candidateName.trim())
                : candidateName.trim().replace(/[\\/:*?"<>|]/g, '_');
            const dotIdx = sanitized.lastIndexOf('.');
            if (dotIdx !== -1) {
                ext = sanitized.slice(dotIdx + 1).toLowerCase();
                finalName = `${cid8}_t${turnIndex + 1}_${sanitized}`;
            } else {
                finalName = `${cid8}_t${turnIndex + 1}_${sanitized}.${ext}`;
            }
        } else {
            finalName = `${cid8}_t${turnIndex + 1}_img${imgCounter}_${hash4}.${ext}`;
        }

        targets.set(rawUrl, {
            url: rawUrl,
            fileName: finalName,
            localName: `attachments/${finalName}`,
            alt: altText || 'Image'
        });
    };

    // 1. Discover all image targets across messages
    for (let i = 0; i < chat.messages.length; i++) {
        const m = chat.messages[i];
        if (!m) continue;

        // a) m.attachments
        if (Array.isArray(m.attachments)) {
            for (const att of m.attachments) {
                if (att && (att.type === 'image' || att.isImage)) {
                    const u = att.src || att.originalUrl || att.url || att.sourceUrl;
                    registerTarget(u, att.fileName || att.name, att.alt || att.name, i);
                }
            }
        }

        // b) m.images
        if (Array.isArray(m.images)) {
            for (const img of m.images) {
                if (img) {
                    const u = img.resolvedUrl || img.sourceUrl || img.url || img.src;
                    registerTarget(u, img.fileName || img.name, img.alt || img.name, i);
                }
            }
        }

        // c) Inline markdown images: ![alt](url)
        if (typeof m.content === 'string') {
            const matches = m.content.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g);
            for (const match of matches) {
                const alt = match[1];
                const u = match[2];
                registerTarget(u, undefined, alt, i);
            }
        }
    }

    if (targets.size === 0) return;

    // 2. Concurrently fetch and persist images
    const targetList = Array.from(targets.values());
    const fetcher = getAssetFetcher();

    await Promise.allSettled(targetList.map(async (target) => {
        try {
            const res = await (fetcher && typeof fetcher.fetchImageBuffer === 'function'
                ? fetcher.fetchImageBuffer(target.url, 12000)
                : null);

            if (res && res.buffer && res.buffer.byteLength > 0) {
                if (res.ext && !target.fileName.toLowerCase().endsWith(`.${res.ext}`)) {
                    target.fileName = target.fileName.replace(/\.[a-z0-9]+$/i, `.${res.ext}`);
                    target.localName = `attachments/${target.fileName}`;
                }
                await writer.writeFile('attachments', target.fileName, res.buffer);
                target.saved = true;
                if (isDev()) {
                    console.log(`[LiveSaveCoordinator] Saved image asset ${target.fileName} (${res.buffer.byteLength} bytes)`);
                }
            } else if (isDev()) {
                console.warn('[LiveSaveCoordinator] Failed to fetch image asset, skipping relative rewrite:', target.url);
            }
        } catch (err) {
            if (isDev()) {
                console.warn('[LiveSaveCoordinator] Error saving image asset:', target.url, err);
            }
        }
    }));

    // 3. Rewrite in-memory conversation references for successfully saved assets
    const savedMap = new Map<string, string>();
    for (const t of targetList) {
        if (t.saved) {
            savedMap.set(t.url, t.localName);
        }
    }

    if (savedMap.size === 0) return;

    for (const m of chat.messages) {
        if (!m) continue;

        if (Array.isArray(m.attachments)) {
            for (const att of m.attachments) {
                const u = att.src || att.originalUrl || att.url || att.sourceUrl;
                if (u && savedMap.has(u)) {
                    const local = savedMap.get(u)!;
                    att.localName = local;
                    att.src = local;
                }
            }
        }

        if (Array.isArray(m.images)) {
            for (const img of m.images) {
                const u = img.resolvedUrl || img.sourceUrl || img.url || img.src;
                if (u && savedMap.has(u)) {
                    const local = savedMap.get(u)!;
                    img.localName = local;
                    img.src = local;
                    img.url = local;
                }
            }
        }

        if (typeof m.content === 'string') {
            for (const [onlineUrl, localPath] of savedMap.entries()) {
                if (m.content.includes(onlineUrl)) {
                    m.content = m.content.split(onlineUrl).join(localPath);
                }
            }
        }
    }
}

/**
 * Write formatted conversation and optional assets to disk via FsWriter.
 */
async function writeConversationToDisk(
    chat: any,
    safeTitle: string,
    nid: string,
    dirHandle: any,
    config: LiveSaveConfig
): Promise<void> {
    const WriterCls = getFsWriterClass();
    const Utils = getUtils();
    const Formatter = getFormatter();

    // Use current folder directly without subfolder nesting
    const writer = new WriterCls(dirHandle, dirHandle.name || 'gemini_export');
    await writer.init();

    // 1. Process and save multimodal image assets to attachments/ if enabled
    if (config.includeAssets !== false) {
        await processAndSaveImages(chat, nid, writer);
    }

    // 2. Target filename format: CleanTitle_Cid8.md (prevents duplicate files on title rename)
    const sanitizedTitle = Utils?.sanitizeFileName ? Utils.sanitizeFileName(safeTitle) : safeTitle.replace(/[\\/:*?"<>|]/g, '_');
    const cid8 = nid.slice(0, 8);
    const fileName = `${sanitizedTitle}_${cid8}.md`;

    // 3. Format content with full YAML frontmatter & markdown standards
    const markdown = Formatter?.toMarkdown
        ? Formatter.toMarkdown({ ...chat, title: safeTitle, id: nid })
        : `# ${safeTitle}\n\n${JSON.stringify(chat.messages, null, 2)}`;

    await writer.writeFile('', fileName, markdown);

    // 4. Optional: write or update main index README.md
    if (config.updateIndex) {
        await updateIndexFile(writer, safeTitle, fileName, nowIsoDate());
    }
}

function nowIsoDate(): string {
    return new Date().toISOString().split('T')[0];
}

async function updateIndexFile(writer: any, title: string, fileName: string, dateStr: string): Promise<void> {
    try {
        const indexHeader = '# Gemini Chat Live Archives\n\n| Date | Conversation | File |\n| :--- | :--- | :--- |\n';
        const entryLine = `| ${dateStr} | ${title} | [${fileName}](./${encodeURIComponent(fileName)}) |\n`;
        // In simple appending/writing, if file exists it will keep structure
        await writer.writeFile('', 'README.md', indexHeader + entryLine);
    } catch {
        /* best-effort index maintenance */
    }
}

export function isCurrentlySaving(): boolean {
    return _isSaving;
}

export const LiveSaveCoordinator = {
    init,
    resolveConversationDetail,
    executeLiveSave,
    processAndSaveImages,
    isCurrentlySaving
};

declare global {
    var LiveSaveCoordinator: any;
}

if (typeof globalThis !== 'undefined') {
    (globalThis as any).LiveSaveCoordinator = LiveSaveCoordinator;
}

export default LiveSaveCoordinator;
