import type {
    Conversation,
    ChatMessage,
    MessageDocument,
    GeneratedMediaIdentity
} from '../../../types/index.js';
import { findGenerationModelMessage } from '../../domain/legacyGeneratedMediaIdentity.js';
import {
    normId as utilsNormId,
    shortScope as utilsShortScope,
    stripHtmlTags as utilsStripHtmlTags,
    sanitizeFileName
} from "../../utils/utils.js";
import type { GeminiUtilsModule } from "../../utils/utils.js";
import { TakeoutParseError } from "../../../types/errors.js";
import { __resolveModule } from "../../utils/moduleOverrides.js";
import { I18n as I18nStatic } from "../../utils/i18n.js";
import { ChatFormatter } from "../chatFormatter.js";

const getUtils = (): GeminiUtilsModule | null => __resolveModule<GeminiUtilsModule | null>('GeminiUtils', null);

export interface GenerationBlock {
    chatId: string;
    time: number;
    prompt: string;
    imageCount?: number;
    modelMessageIndex?: number;
    generation?: GeneratedMediaIdentity;
}

export interface TakeoutZipEntry {
    name?: string;
    dir?: boolean;
    date?: Date;
    async?: (type: string) => Promise<unknown>;
    _data?: { uncompressedSize?: number };
}

type HistoricalTakeoutImage = {
    url: string;
    name: string;
    fileName: string;
    localName: string;
    source: string;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
};

type TakeoutChatMessage = Omit<ChatMessage, 'images' | 'attachments'> & {
    images?: HistoricalTakeoutImage[];
    attachments?: Array<HistoricalTakeoutImage | MessageDocument | NonNullable<ChatMessage['attachments']>[number]>;
};

type TakeoutCachedConversation = Omit<Conversation, 'messages'> & {
    messages?: TakeoutChatMessage[];
};

function isTakeoutZipEntry(value: unknown): value is TakeoutZipEntry {
    if (typeof value !== 'object' || value === null) return false;
    if ('name' in value && value.name !== undefined && typeof value.name !== 'string') return false;
    if ('dir' in value && value.dir !== undefined && typeof value.dir !== 'boolean') return false;
    if ('date' in value && value.date !== undefined && !(value.date instanceof Date)) return false;
    if ('async' in value && value.async !== undefined && typeof value.async !== 'function') return false;
    if ('_data' in value && value._data !== undefined) {
        if (typeof value._data !== 'object' || value._data === null) return false;
        if ('uncompressedSize' in value._data && value._data.uncompressedSize !== undefined && typeof value._data.uncompressedSize !== 'number') return false;
    }
    return true;
}

export interface TakeoutMediaItem {
    filename: string;
    fileObj?: TakeoutZipEntry;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
}

export interface TakeoutWatermarkedImage {
    filename: string;
    stem?: string;
    cleanStem?: string;
    fileObj?: TakeoutZipEntry;
    time?: number | null;
    providerRequestId?: string;
    /** Only supplied when source metadata establishes the image identity. */
    imageOrdinal?: number;
}

export interface ParseTakeoutHtmlOptions {
    htmlText: string;
    zipFiles: Record<string, unknown>;
    normIdFn?: (id?: string | null) => string;
    onProgress?: ((pct: number, msg: string) => void) | null;
}

export interface ParseTakeoutHtmlOutput {
    extractedMap: Record<string, Conversation>;
    localConvCache: Record<string, TakeoutCachedConversation>;
    localMediaMap: Record<string, TakeoutMediaItem[]>;
    genBlocks: GenerationBlock[];
}

export interface TakeoutHtmlParserModule {
    stripHtmlTags: (html?: string | null) => string;
    unescapeHtmlEntities: (str: string) => string;
    parseTakeoutPrompt: (block: string) => { promptText: string; hasExplicitPrompt: boolean };
    parseTakeoutTimestamp: (block: string) => number | null;
    parseTakeoutHtmlBlocks: (options: ParseTakeoutHtmlOptions) => Promise<ParseTakeoutHtmlOutput>;
    correlateGeneratedImages: (
        watermarkedImages: TakeoutWatermarkedImage[],
        genBlocks: GenerationBlock[],
        localMediaMap: Record<string, TakeoutMediaItem[]>,
        localConvCache: Record<string, TakeoutCachedConversation>,
        extractedMap: Record<string, Conversation>
    ) => void;
}

export const stripHtmlTags = utilsStripHtmlTags;

/**
 * Safely unescapes basic HTML entities in a single pass to prevent double-unescaping vulnerabilities.
 */
export function unescapeHtmlEntities(str: string): string {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/&(?:amp|lt|gt|quot|#39);/g, (match) => {
        switch (match) {
            case '&amp;': return '&';
            case '&lt;': return '<';
            case '&gt;': return '>';
            case '&quot;': return '"';
            case '&#39;': return "'";
            default: return match;
        }
    });
}

export function parseTakeoutPrompt(block: string): { promptText: string; hasExplicitPrompt: boolean } {
    let promptText = '';
    let hasExplicitPrompt = false;
    const promptMatch = block.match(/(?:Prompted|已提示|提示|プロンプト|Demande|Preguntado)\s*([\s\S]*?)(?:<br\s*\/?>|\n)/i);
    if (promptMatch) {
        hasExplicitPrompt = true;
        promptText = stripHtmlTags(promptMatch[1]).replace(/&nbsp;/g, ' ').replace(/[\u202f\xa0]/g, ' ').trim();
    } else {
        const contentCellMatchFallback = block.match(/<div class="content-cell[^>]*>([\s\S]*?)(?:<br\s*\/?>|\n)/i);
        if (contentCellMatchFallback) {
            promptText = stripHtmlTags(contentCellMatchFallback[1]).replace(/&nbsp;/g, ' ').replace(/[\u202f\xa0]/g, ' ').trim();
        }
    }
    return { promptText, hasExplicitPrompt };
}

export function parseTakeoutTimestamp(block: string): number | null {
    let ts: number | null = null;
    const timeMatchEn = block.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}(?::\d{2})?\s*[\u202f\s]*(?:AM|PM)(?:\s+[A-Za-z0-9_+-]+)?)/);
    const timeMatchZh = block.match(/(\d{4}年\d{1,2}月\d{1,2}日[\s\u202f\xa0]*(?:[A-Z]{2,4}\s+)?(?:上午|下午)?\s*\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:UTC|GMT)?\s*[+-]?\d{1,2}(?::?\d{2})?|\s*[A-Z]{2,4})?)/);
    const timeMatchIso = block.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/);

    const hasCjk = /[\u4e00-\u9fa5]/.test(block);
    const tzMap: Record<string, string> = {
        'UTC': '+0000', 'GMT': '+0000',
        'EDT': '-0400', 'EST': '-0500',
        'CDT': '-0500',
        'CST': hasCjk ? '+0800' : '-0600',
        'MDT': '-0600', 'MST': '-0700',
        'PDT': '-0700', 'PST': '-0800',
        'AKDT': '-0800', 'AKST': '-0900',
        'HST': '-1000', 'HDT': '-0900',
        'BST': '+0100', 'CET': '+0100', 'CEST': '+0200',
        'EET': '+0200', 'EEST': '+0300',
        'IST': '+0530', 'JST': '+0900', 'KST': '+0900',
        'AEST': '+1000', 'AEDT': '+1100',
        'SGT': '+0800', 'HKT': '+0800'
    };

    const extractOffset = (text: string) => {
        const numMatch = text.match(/\s+(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i);
        if (numMatch) {
            const sign = numMatch[1];
            const hours = numMatch[2].padStart(2, '0');
            const mins = (numMatch[3] || '00').padStart(2, '0');
            const clean = text.replace(/\s+(?:UTC|GMT)?\s*[+-]\d{1,2}(?::?\d{2})?$/i, '').trim();
            return { cleanText: clean, offsetStr: ` GMT${sign}${hours}${mins}` };
        }
        const codeMatch = text.match(/\s+([A-Z]{3,4})$/);
        if (codeMatch && tzMap[codeMatch[1]]) {
            const clean = text.replace(/\s+[A-Z]{3,4}$/, '').trim();
            return { cleanText: clean, offsetStr: ' GMT' + tzMap[codeMatch[1]] };
        }
        return { cleanText: text.trim(), offsetStr: '' };
    };

    if (timeMatchEn) {
        const rawT = timeMatchEn[1].replace(/[\u202f\xa0]/g, ' ').trim();
        const { cleanText, offsetStr } = extractOffset(rawT);
        const dt = new Date(cleanText + offsetStr);
        if (!isNaN(dt.getTime())) ts = dt.getTime();
    } else if (timeMatchZh) {
        const rawZh = timeMatchZh[1].replace(/[\u202f\xa0]/g, ' ').trim();
        const { cleanText, offsetStr } = extractOffset(rawZh);
        const isPm = cleanText.includes('下午');
        const isAm = cleanText.includes('上午');
        const parts = cleanText.replace(/上午|下午/g, '').replace(/[A-Z]{2,4}/g, '').trim()
            .match(/(\d{4})年(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (parts) {
            const y = parts[1];
            const m = parts[2].padStart(2, '0');
            const d = parts[3].padStart(2, '0');
            let h = parseInt(parts[4], 10);
            const min = parts[5];
            const sec = parts[6] || '00';
            if (isPm && h < 12) h += 12;
            else if (isAm && h === 12) h = 0;
            const dateStr = `${y}-${m}-${d} ${String(h).padStart(2, '0')}:${min}:${sec}${offsetStr}`;
            const dt = new Date(dateStr);
            if (!isNaN(dt.getTime())) ts = dt.getTime();
        }
    } else if (timeMatchIso) {
        const dt = new Date(timeMatchIso[1].replace(/[\u202f\xa0]/g, ' '));
        if (!isNaN(dt.getTime())) ts = dt.getTime();
    }
    return ts;
}

interface ZipIndexEntry {
    filename: string;
    stem: string;
    fObj: TakeoutZipEntry;
}

export async function parseTakeoutHtmlBlocks(options: ParseTakeoutHtmlOptions): Promise<ParseTakeoutHtmlOutput> {
    const { htmlText, zipFiles, onProgress } = options;
    const normIdFn = options.normIdFn || ((id?: string | null) => {
        try {
            return (getUtils()?.normId || utilsNormId)(id);
        } catch {
            if (!id) return "";
            return String(id).replace(/^c_/, "").trim();
        }
    });

    const i18nInstance = __resolveModule('I18n', I18nStatic);
    const rawBlocks = htmlText.split('<div class="outer-cell');
    if (rawBlocks.length <= 1) {
        const hasOuterCell = htmlText.includes('outer-cell');
        const hasTakeoutMarker = /gemini|bard|MyActivity|我的活动/i.test(htmlText);
        if (!hasOuterCell && hasTakeoutMarker) {
            const err = i18nInstance.t('takeoutFormatChanged');
            throw new TakeoutParseError(err, true, 'MyActivity.html');
        }
    }

    const extractedMap: Record<string, Conversation> = {};
    const localConvCache: Record<string, TakeoutCachedConversation> = {};
    const localMediaMap: Record<string, TakeoutMediaItem[]> = {};
    const genBlocks: GenerationBlock[] = [];

    for (let i = 1; i < rawBlocks.length; i++) {
        if (i % 50 === 0) {
            await new Promise(r => setTimeout(r, 0));
            if (onProgress && i % 100 === 0) {
                const pct = Math.min(88, 70 + Math.floor((i / rawBlocks.length) * 18));
                const msg = i18nInstance.t('takeoutParsingDetailProgress', i, rawBlocks.length - 1);
                onProgress(pct, msg);
            }
        }
        const block = rawBlocks[i];
        const linkMatches = Array.from(block.matchAll(/https:\/\/(?:gemini|bard)\.google\.com\/(?:u\/\d+\/)?(?:app|chat)\/([a-zA-Z0-9_-]{8,64})/g));
        if (!linkMatches.length) continue;

        const foundIds: string[] = [];
        for (const lm of linkMatches) {
            const candidateId = lm[1];
            if (!candidateId) continue;
            const cleanId = normIdFn(candidateId);
            if (cleanId.length >= 8 && !foundIds.includes(cleanId)) {
                foundIds.push(cleanId);
            }
        }
        if (!foundIds.length) continue;

        const { promptText, hasExplicitPrompt } = parseTakeoutPrompt(block);
        const ts = parseTakeoutTimestamp(block);

        const genMatch = /(?:(\d+)\s*generated images?|(\d+)\s*张生成的图片)/i.exec(block);
        const hasGenMarker = !!genMatch;
        const blockGenerations: GenerationBlock[] = [];
        if (hasGenMarker && foundIds.length > 0 && ts) {
            const matchedCount = genMatch[1] || genMatch[2];
            const parsedCount = matchedCount ? Number(matchedCount) : undefined;
            const imageCount = typeof parsedCount === 'number' && Number.isFinite(parsedCount) ? parsedCount : undefined;
            for (const cid of foundIds) {
                const generationBlock: GenerationBlock = {
                    chatId: cid,
                    time: ts,
                    prompt: promptText,
                    imageCount,
                };
                genBlocks.push(generationBlock);
                blockGenerations.push(generationBlock);
            }
        }

        const contentCellMatch = block.match(/<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/i);
        let responseHtml = '';
        if (contentCellMatch) {
            const rawCc = contentCellMatch[1];
            const parts = rawCc.split(/<br\s*\/?>|\n/);
            const respParts: string[] = [];
            let started = false;
            for (const p of parts) {
                if (started) {
                    respParts.push(p);
                } else if (/<p>|<pre>|<table>|<h1>|<h2>|<h3>|<ul>|<ol>|<strong>|<em>|<code>/i.test(p)) {
                    started = true;
                    respParts.push(p);
                }
            }
            responseHtml = respParts.join('\n').trim();
        }

        const rawMediaMatches = block.match(/(?:src|href)=["']([^#"'>]+?)["']/gi) || [];
        const localMediaNames: string[] = [];
        for (const raw of rawMediaMatches) {
            const val = raw.replace(/^(?:src|href)=["']/, '').replace(/["']$/, '').trim();
            if (/^(?:https?:|\/\/|javascript:|mailto:|data:)/i.test(val) || /\.html?$/i.test(val)) continue;
            try {
                const decoded = decodeURIComponent(val).replace(/^.*[\\\/]/, '').trim();
                if (decoded && !localMediaNames.includes(decoded)) {
                    localMediaNames.push(decoded);
                }
            } catch {
                const simpleName = val.replace(/^.*[\\\/]/, '').trim();
                if (simpleName && !localMediaNames.includes(simpleName)) {
                    localMediaNames.push(simpleName);
                }
            }
        }

        const turnMsgs: TakeoutChatMessage[] = [];
        if (promptText) {
            const userMsg: TakeoutChatMessage = {
                role: 'user',
                content: promptText,
                timestamp: ts ?? null
            };
            if (localMediaNames.length > 0) {
                const historicalImages: HistoricalTakeoutImage[] = localMediaNames.map((name) => ({
                    url: name,
                    name: name,
                    fileName: name,
                    localName: `assets/${sanitizeFileName(name, 'img.jpg')}`,
                    source: 'takeout'
                }));
                userMsg.images = historicalImages;
                userMsg.attachments = localMediaNames.map((name) => ({
                    type: /\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(name) ? 'image' : 'file',
                    url: name,
                    name: name,
                    fileName: name,
                    localName: `assets/${sanitizeFileName(name, 'attachment')}`,
                    source: 'takeout'
                }));
            }
            turnMsgs.push(userMsg);
        }
        if (responseHtml || hasGenMarker) {
            const modelTurn: TakeoutChatMessage = {
                role: 'model',
                content: responseHtml,
                timestamp: (ts ? ts + 2000 : null)
            };

            const isHtmlReport = /<h1[^>]*>/i.test(responseHtml) && responseHtml.length > 3000;
            if (isHtmlReport) {
                const h1Match = responseHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
                let docTitle = 'Deep Research Report';
                if (h1Match) {
                    docTitle = unescapeHtmlEntities(stripHtmlTags(h1Match[1])).trim();
                }
                const convHtml = ChatFormatter.convertHtmlToMarkdown;
                let docMd = convHtml ? convHtml(responseHtml) : responseHtml.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m: string, lvl: string, txt: string) => `\n${'#'.repeat(parseInt(lvl, 10))} ${txt.trim()}\n`);
                if (!docMd.trim().startsWith('#')) {
                    docMd = `# ${docTitle}\n\n${docMd.trim()}`;
                }
                const primaryCleanId = foundIds[0] || 'takeout';
                const shortScope = utilsShortScope(primaryCleanId);
                const safeDocTitle = sanitizeFileName(docTitle, 'doc').slice(0, 60);
                const localName = `files/${shortScope}${safeDocTitle}.md`;

                const docObj: MessageDocument = {
                    type: 'file',
                    id: `${primaryCleanId}_doc_${Date.now()}`,
                    title: docTitle,
                    name: `${safeDocTitle}.md`,
                    localName,
                    contentMarkdown: docMd,
                    source: 'takeout-report'
                };
                modelTurn.documents = [docObj];
                modelTurn.attachments = [docObj];
            }

            turnMsgs.push(modelTurn);
        }

        const __zipEntries: ZipIndexEntry[] = [];
        const __zipExact = new Map<string, ZipIndexEntry[]>();
        for (const [path, rawEntry] of Object.entries(zipFiles)) {
            if (!isTakeoutZipEntry(rawEntry) || rawEntry.dir) continue;
            const fObj = rawEntry;
            const zipFilename = path.replace(/^.*[\\\/]/, '').trim();
            const entry: ZipIndexEntry = {
                filename: zipFilename,
                stem: zipFilename.replace(/\.[^/.]+$/, '').toLowerCase(),
                fObj
            };
            __zipEntries.push(entry);
            for (const key of [zipFilename.toLowerCase(), entry.stem]) {
                let arr = __zipExact.get(key);
                if (!arr) { arr = []; __zipExact.set(key, arr); }
                arr.push(entry);
            }
        }

        for (const cleanId of foundIds) {
            if (!localMediaMap[cleanId]) localMediaMap[cleanId] = [];
            for (const refName of localMediaNames) {
                const refStem = refName.replace(/\.[^/.]+$/, '').toLowerCase();
                const refLower = refName.toLowerCase();
                const consider = (entry: ZipIndexEntry): void => {
                    if (entry.filename === refName || entry.stem === refStem ||
                        entry.filename.endsWith(refName) ||
                        (refStem.length > 5 && entry.stem.includes(refStem))) {
                        if (!localMediaMap[cleanId].some(x => x.filename === entry.filename)) {
                            localMediaMap[cleanId].push({ filename: entry.filename, fileObj: entry.fObj });
                        }
                    }
                };
                const seenExact = new Set<string>();
                for (const key of [refLower, refStem]) {
                    const arr = __zipExact.get(key);
                    if (arr) for (const e of arr) {
                        if (!seenExact.has(e.filename)) { seenExact.add(e.filename); consider(e); }
                    }
                }
                for (const e of __zipEntries) {
                    if (seenExact.has(e.filename)) continue;
                    consider(e);
                }
            }

            const generationBlock = blockGenerations.find((gb) => gb.chatId === cleanId);
            if (generationBlock) {
                generationBlock.modelMessageIndex = (localConvCache[cleanId]?.messages?.length || 0)
                    + turnMsgs.findIndex((m) => m.role === 'model');
            }

            const promptTitle = promptText ? promptText.split('\n')[0].slice(0, 80).trim() : 'Takeout conversation';
            const cachedConv = localConvCache[cleanId];
            if (!cachedConv) {
                localConvCache[cleanId] = {
                    id: cleanId,
                    title: promptTitle,
                    titleSource: 'takeout',
                    titles: { takeout: promptTitle },
                    messages: turnMsgs.map((m) => ({ ...m })),
                    timestamp: ts,
                    messageCount: turnMsgs.length,
                    attachmentCount: localMediaNames.length,
                    source: 'takeout-offline',
                    hasExplicitPrompt
                };
            } else if (turnMsgs.length > 0) {
                if (!cachedConv.messages) cachedConv.messages = [];
                cachedConv.messages.push(...turnMsgs.map((m) => ({ ...m })));
                cachedConv.messageCount = cachedConv.messages.length;
                cachedConv.attachmentCount = (cachedConv.attachmentCount || 0) + localMediaNames.length;
                if (hasExplicitPrompt && !cachedConv.hasExplicitPrompt && promptTitle) {
                    cachedConv.title = promptTitle;
                    cachedConv.titles = cachedConv.titles || {};
                    cachedConv.titles.takeout = promptTitle;
                    cachedConv.hasExplicitPrompt = true;
                }
            }

            const extractedConv = extractedMap[cleanId];
            if (!extractedConv) {
                extractedMap[cleanId] = {
                    id: cleanId,
                    title: promptTitle,
                    titleSource: 'takeout',
                    titles: { takeout: promptTitle },
                    url: `https://gemini.google.com/app/${cleanId}`,
                    href: `https://gemini.google.com/app/${cleanId}`,
                    // Missing timestamp stays null so merge does not overwrite authoritative data
                    timestamp: ts ?? null,
                    lastSeen: ts ? new Date(ts).toISOString() : '',
                    source: 'takeout-import',
                    messageCount: turnMsgs.length,
                    attachmentCount: localMediaNames.length,
                    hasExplicitPrompt
                };
            } else {
                extractedConv.attachmentCount = (extractedConv.attachmentCount || 0) + localMediaNames.length;
                const cleanPrompt = promptText ? promptText.split('\n')[0].slice(0, 80).trim() : '';
                const shouldUpdate = cleanPrompt && (
                    (hasExplicitPrompt && !extractedConv.hasExplicitPrompt) ||
                    !extractedConv.title ||
                    extractedConv.title.startsWith('Untitled') ||
                    extractedConv.title === 'Takeout conversation'
                );
                if (shouldUpdate) {
                    extractedConv.title = cleanPrompt;
                    extractedConv.titles = extractedConv.titles || {};
                    extractedConv.titles.takeout = cleanPrompt;
                    if (hasExplicitPrompt) extractedConv.hasExplicitPrompt = true;
                    const cachedForTitle = localConvCache[cleanId];
                    if (cachedForTitle) {
                        cachedForTitle.title = cleanPrompt;
                        cachedForTitle.titles = cachedForTitle.titles || {};
                        cachedForTitle.titles.takeout = cleanPrompt;
                        if (hasExplicitPrompt) cachedForTitle.hasExplicitPrompt = true;
                    }
                }
                if (ts && (!extractedConv.timestamp || ts > extractedConv.timestamp)) {
                    extractedConv.timestamp = ts;
                    extractedConv.lastSeen = new Date(ts).toISOString();
                }
            }
        }
    }

    const eventCounts = new Map<string, number>();
    for (const block of [...genBlocks].sort((a, b) => a.time - b.time)) {
        const ordinal = eventCounts.get(block.chatId) || 0;
        eventCounts.set(block.chatId, ordinal + 1);
        block.generation = {
            chatId: block.chatId, time: block.time, prompt: block.prompt,
            generationOrdinal: ordinal, imageCount: block.imageCount,
        };
        if (typeof block.modelMessageIndex === 'number') {
            const model = localConvCache[block.chatId]?.messages?.[block.modelMessageIndex];
            if (model?.role === 'model') model.generation = block.generation;
        }
    }

    return {
        extractedMap,
        localConvCache,
        localMediaMap,
        genBlocks
    };
}

export function correlateGeneratedImages(
    watermarkedImages: TakeoutWatermarkedImage[],
    genBlocks: GenerationBlock[],
    localMediaMap: Record<string, TakeoutMediaItem[]>,
    localConvCache: Record<string, TakeoutCachedConversation>,
    extractedMap: Record<string, Conversation>
): void {
    function linkTakeoutGeneratedImage(block: GenerationBlock, img: TakeoutWatermarkedImage): void {
        const chatId = block.chatId;
        const providerRequestId = img.providerRequestId || block.generation?.providerRequestId;
        const totalCount = block.imageCount;
        const imageOrdinal = totalCount === 1 ? 0
            : (typeof img.imageOrdinal === 'number' && Number.isInteger(img.imageOrdinal) && img.imageOrdinal >= 0 ? img.imageOrdinal : undefined);
        const generation: GeneratedMediaIdentity = {
            ...(block.generation || { chatId, time: block.time, prompt: block.prompt, generationOrdinal: 0, imageCount: block.imageCount }),
            providerRequestId,
            imageCount: totalCount,
            imageOrdinal,
        };
        if (!localMediaMap[chatId]) localMediaMap[chatId] = [];
        const existing = localMediaMap[chatId].find(x => x.filename === img.filename);
        if (existing) {
            existing.isGenerated = true;
            existing.providerRequestId = providerRequestId;
            existing.imageOrdinal = imageOrdinal;
            existing.generation = generation;
        } else {
            localMediaMap[chatId].push({
                filename: img.filename, fileObj: img.fileObj, isGenerated: true,
                providerRequestId, imageOrdinal, generation,
            });
        }
        const imgObj: HistoricalTakeoutImage = {
            url: img.filename,
            name: img.filename,
            fileName: img.filename,
            localName: `assets/${img.filename}`,
            source: 'takeout',
            isGenerated: true,
            providerRequestId,
            imageOrdinal,
            generation
        };
        const cached = localConvCache[chatId];
        if (cached && Array.isArray(cached.messages)) {
            const foundModelTurn = findGenerationModelMessage(cached, generation);
            if (!foundModelTurn) {
                const newModelTurn: TakeoutChatMessage = {
                    role: 'model',
                    generation,
                    providerRequestId,
                    content: `![Generated Image](assets/${img.filename})`,
                    timestamp: img.time || (cached.timestamp ? cached.timestamp + 2000 : null)
                };
                newModelTurn.images = [imgObj];
                newModelTurn.attachments = [imgObj];
                cached.messages.push(newModelTurn);
            } else {
                foundModelTurn.images = foundModelTurn.images || [];
                foundModelTurn.attachments = foundModelTurn.attachments || [];
                if (!foundModelTurn.providerRequestId && providerRequestId) {
                    foundModelTurn.providerRequestId = providerRequestId;
                }
                if (!foundModelTurn.images.some((im) => im.fileName === img.filename)) {
                    foundModelTurn.images.push(imgObj);
                }
                if (!foundModelTurn.attachments.some((at) => at.fileName === img.filename)) {
                    foundModelTurn.attachments.push(imgObj);
                }
                if (!foundModelTurn.content.includes(img.filename)) {
                    foundModelTurn.content = (foundModelTurn.content ? foundModelTurn.content + '\n\n' : '') + `![Generated Image](assets/${img.filename})`;
                }
            }
            cached.attachmentCount = (cached.attachmentCount || 0) + 1;
        }
        const extracted = extractedMap[chatId];
        if (extracted) {
            extracted.attachmentCount = (extracted.attachmentCount || 0) + 1;
        }
    }

    for (const img of watermarkedImages) {
        let bestBlock: GenerationBlock | null = null;
        let minDiff = Infinity;
        let ambiguous = false;
        for (const gb of genBlocks) {
            if (!gb.time || !img.time || !Number.isFinite(gb.time) || !Number.isFinite(img.time)) continue;
            const diff = img.time - gb.time;
            if (diff < -5000 || diff > 120000) continue;
            const distance = Math.abs(diff);
            if (distance < minDiff) {
                minDiff = distance;
                bestBlock = gb;
                ambiguous = false;
            } else if (distance === minDiff) {
                ambiguous = true;
            }
        }
        // Preserve the existing singleton fallback only when temporal evidence is unavailable.
        if (!bestBlock && watermarkedImages.length === 1 && genBlocks.length === 1
            && (!img.time || !genBlocks[0].time)) {
            bestBlock = genBlocks[0];
        }
        if (bestBlock && !ambiguous) linkTakeoutGeneratedImage(bestBlock, img);
    }
}

export const TakeoutHtmlParser: TakeoutHtmlParserModule = {
    stripHtmlTags,
    unescapeHtmlEntities,
    parseTakeoutPrompt,
    parseTakeoutTimestamp,
    parseTakeoutHtmlBlocks,
    correlateGeneratedImages
};

export default TakeoutHtmlParser;
