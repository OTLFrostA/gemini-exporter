/**
 * src/core/engine/takeout/takeoutParser.ts
 * Google Takeout ZIP archive unpacker and orchestration coordinator.
 * Delegates HTML parsing and image correlation to takeoutHtmlParser.ts,
 * integrates ZipBombGuard and MediaIndex, and enforces memory guardrails (S-4).
 */

import { normId as utilsNormId } from "../../utils/utils.js";
import { ZipBombGuard, type ZipBombGuardModule } from "./zipBombGuard.js";
import { MediaIndex, type MediaIndexModule } from "./mediaIndex.js";
import {
    stripHtmlTags as htmlStripTags,
    parseTakeoutHtmlBlocks,
    correlateGeneratedImages,
    TakeoutHtmlParser as DefaultTakeoutHtmlParser,
    type TakeoutHtmlParserModule
} from "./takeoutHtmlParser.js";
import { TakeoutParseError } from "../../../types/errors.js";
import type { Conversation } from "../../../types/index.js";

export interface TakeoutParseResult {
    conversations: Conversation[];
    totalMediaCount: number;
    convCache: Record<string, any>;
    mediaMap: Record<string, any>;
    globalMedia: Record<string, any>;
}

export interface TakeoutParserModule {
    stripHtmlTags: (html?: string | null | any) => string;
    parseTakeoutZip: (file: any, onProgress?: ((pct: number, msg: string) => void) | null, slot?: string | null) => Promise<TakeoutParseResult>;
}

declare global {
    var TakeoutParser: TakeoutParserModule;
    var JSZip: any;
    var I18n: any;
}

const normId = utilsNormId;

/**
 * Strips HTML tags from input string (re-exported for 100% backward compatibility).
 */
export const stripHtmlTags = htmlStripTags;

/**
 * Main coordinator: unpacks Google Takeout archive, scans structure,
 * enforces memory guardrails, parses conversations, and populates media indexes.
 */
export async function parseTakeoutZip(
    file: any,
    onProgress?: ((pct: number, msg: string) => void) | null,
    slot: string | null = null
): Promise<TakeoutParseResult> {
    if (typeof JSZip === 'undefined') {
        throw new Error('JSZip 库未加载，无法解析 ZIP');
    }

    const guard = (typeof globalThis !== 'undefined' && (globalThis as any).ZipBombGuard) || ZipBombGuard;
    if (guard?.validateZipFile) {
        guard.validateZipFile(file);
    }

    if (onProgress) onProgress(15, '正在解压 Takeout 压缩包...');

    const zip = (file && typeof file.file === 'function' && file.files)
        ? file
        : await (JSZip as any).loadAsync(file);
    if (guard?.validateZipEntries) {
        guard.validateZipEntries(zip);
    }

    const i18nInstance = typeof I18n !== 'undefined' ? I18n : (globalThis as any).I18n;
    if (onProgress) onProgress(40, (i18nInstance && typeof i18nInstance.t === 'function') ? i18nInstance.t('takeoutParsingStructure') : '正在扫描 Takeout 目录结构...');

    let activityFile: any = null;
    for (const [path, fObj] of Object.entries<any>(zip.files)) {
        if (fObj.dir) continue;
        if (path.includes('Takeout/Gemini/我的活动') ||
            path.includes('Takeout/Bard/我的活动') ||
            path.includes('Takeout/Gemini/MyActivity') ||
            path.includes('Takeout/Bard/MyActivity') ||
            path.includes('Takeout/Gemini/My Activity') ||
            path.includes('Takeout/Bard/My Activity')) {
            activityFile = fObj;
            break;
        }
    }
    if (!activityFile) {
        for (const filename of Object.keys(zip.files)) {
            if (zip.files[filename].dir) continue;
            if (/MyActivity\.html$/i.test(filename) || /Gemini.*\.html$/i.test(filename) || /Bard.*\.html$/i.test(filename) || /我的活动.*\.html$/i.test(filename)) {
                activityFile = zip.files[filename];
                break;
            }
        }
    }

    if (!activityFile) {
        const notFoundMsg = (i18nInstance && typeof i18nInstance.t === 'function')
            ? i18nInstance.t('takeoutNotFound')
            : '未在 ZIP 中找到 Gemini / Bard 的活动记录 (MyActivity.html)';
        throw new TakeoutParseError(notFoundMsg, false);
    }

    // S-4 Memory Guardrail: check uncompressed size before loading full text into memory
    const MAX_HTML_UNCOMPRESSED_SIZE = 250 * 1024 * 1024; // 250MB threshold
    const uncompressedSize = activityFile._data?.uncompressedSize;
    // Fail closed if uncompressed size cannot be verified
    if (typeof uncompressedSize !== 'number') {
        const errNoSize = (i18nInstance && typeof i18nInstance.t === 'function')
            ? i18nInstance.t('takeoutHtmlSizeUnknown')
            : '无法确认 Takeout 活动记录的解压体积，已中止以防内存溢出。';
        throw new TakeoutParseError(errNoSize, false, activityFile.name);
    }
    if (uncompressedSize > MAX_HTML_UNCOMPRESSED_SIZE) {
        const sizeMb = (uncompressedSize / 1024 / 1024).toFixed(1);
        const limitMb = (MAX_HTML_UNCOMPRESSED_SIZE / 1024 / 1024).toFixed(0);
        const err = (i18nInstance && typeof i18nInstance.t === 'function')
            ? i18nInstance.t('takeoutHtmlTooLarge', sizeMb, limitMb)
            : `Takeout 活动记录 (MyActivity.html) 解压体积过大 (${sizeMb}MB)，超过 ${limitMb}MB 内存安全上限。为防止浏览器标签页崩溃，建议在 Google Takeout 导出时按时间范围分批导出后重试。`;
        throw new TakeoutParseError(err, false, activityFile.name);
    }

    const htmlText = await activityFile.async('text');
    if (onProgress) onProgress(70, (i18nInstance && typeof i18nInstance.t === 'function') ? i18nInstance.t('takeoutParsingDetail') : '正在解析对话并建立离线媒体索引...');

    const mediaIdx = (typeof globalThis !== 'undefined' && (globalThis as any).MediaIndex) || MediaIndex;
    const extractC2PATime = mediaIdx?.extractC2PATimestamp || (() => null);

    const localGlobalMedia: Record<string, any> = {};
    let totalMediaCount = 0;
    const watermarkedImages: any[] = [];

    for (const [path, fObj] of Object.entries<any>(zip.files)) {
        if (fObj.dir || path.endsWith('.html') || path.endsWith('.json')) continue;
        let filename = path.replace(/^.*[\\\/]/, '').trim();
        let stem = filename.replace(/\.[^/.]+$/, '').toLowerCase();
        let cleanStem = stem.replace(/-[0-9a-fA-F]{16}$/i, '');
        localGlobalMedia[cleanStem] = fObj;
        localGlobalMedia[stem] = fObj;
        localGlobalMedia[filename] = fObj;
        totalMediaCount++;

        if (/watermarked_img_/i.test(filename)) {
            try {
                const bin = await fObj.async('uint8array');
                const c2paTime = extractC2PATime(bin) || (fObj.date ? fObj.date.getTime() : null);
                watermarkedImages.push({
                    filename,
                    stem,
                    cleanStem,
                    fileObj: fObj,
                    time: c2paTime
                });
            } catch {
                watermarkedImages.push({
                    filename,
                    stem,
                    cleanStem,
                    fileObj: fObj,
                    time: fObj.date ? fObj.date.getTime() : null
                });
            }
        }
    }

    const parser = (typeof globalThis !== 'undefined' && (globalThis as any).TakeoutHtmlParser) || DefaultTakeoutHtmlParser;
    const parseFn = parser?.parseTakeoutHtmlBlocks || parseTakeoutHtmlBlocks;
    const { extractedMap, localConvCache, localMediaMap, genBlocks } = await parseFn({
        htmlText,
        zipFiles: zip.files,
        normIdFn: normId,
        onProgress
    });

    // Correlate watermarked generated images with conversations
    const correlateFn = parser?.correlateGeneratedImages || correlateGeneratedImages;
    correlateFn(watermarkedImages, genBlocks, localMediaMap, localConvCache, extractedMap);

    const conversations: Conversation[] = Object.values(extractedMap);
    if (onProgress) onProgress(100, `Takeout 解析完成，共发现 ${conversations.length} 条对话与 ${totalMediaCount} 个离线资源`);

    if (mediaIdx && mediaIdx.commitTakeoutData) {
        mediaIdx.commitTakeoutData(slot, {
            mediaMap: localMediaMap,
            globalMedia: localGlobalMedia,
            convCache: localConvCache
        });
    }

    return {
        conversations,
        totalMediaCount,
        convCache: localConvCache,
        mediaMap: localMediaMap,
        globalMedia: localGlobalMedia
    };
}

export const TakeoutParser: TakeoutParserModule = {
    stripHtmlTags,
    parseTakeoutZip
};

(TakeoutParser as any).TakeoutParser = TakeoutParser;
(TakeoutParser as any).default = TakeoutParser;

if (typeof globalThis !== 'undefined' && !(globalThis as any).TakeoutParser) {
    (globalThis as any).TakeoutParser = TakeoutParser;
}
if (typeof module === 'object' && module.exports) {
    module.exports = TakeoutParser;
}
export default TakeoutParser;
