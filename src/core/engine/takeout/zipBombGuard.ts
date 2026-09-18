// zipBombGuard.ts - ZipBomb protection guards and entry size estimators for Takeout ZIP extraction

export interface ZipBombGuardModule {
    MAX_ZIP_SIZE: number;
    MAX_ENTRY_COUNT: number;
    MAX_TOTAL_UNCOMPRESSED: number;
    validateZipFile: (file?: { size?: number } | null) => void;
    validateZipEntries: (zip?: any) => void;
}

export const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB compressed size
export const MAX_ENTRY_COUNT = 10000; // 10,000 files
export const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1GB uncompressed estimate

import { __resolveModule } from '../../utils/moduleOverrides.js';
import * as I18nStatic from '../../utils/i18n.js';

function getI18n() {
    return __resolveModule('I18n', I18nStatic);
}

export function validateZipFile(file?: { size?: number } | null): void {
    // Handle pre-loaded JSZip instances
    if (file && typeof (file as any).file === 'function' && (file as any).files) {
        validateZipEntries(file);
        return;
    }
    // Accept File/Blob (.size) as well as Buffer/Uint8Array (.length/.byteLength).
    const byteSize = file
        ? (typeof file.size === 'number' ? file.size
            : typeof (file as any).length === 'number' ? (file as any).length
            : typeof (file as any).byteLength === 'number' ? (file as any).byteLength
            : NaN)
        : NaN;
    // Fail closed when size cannot be determined
    if (!Number.isFinite(byteSize)) {
        const i18n = getI18n();
        const msg = (i18n && typeof i18n.t === 'function')
            ? i18n.t('zipSizeUnknown')
            : '无法确认 Takeout ZIP 体积，已中止以防 ZipBomb';
        throw new Error(msg);
    }
    if (byteSize > MAX_ZIP_SIZE) {
        const curMb = (byteSize / 1024 / 1024).toFixed(1);
        const maxMb = (MAX_ZIP_SIZE / 1024 / 1024).toFixed(0);
        const i18n = getI18n();
        const msg = (i18n && typeof i18n.t === 'function')
            ? i18n.t('zipSizeTooLarge', curMb, maxMb)
            : `Takeout ZIP 体积过大 (${curMb}MB)，超过 ${maxMb}MB 上限，请确认是否为完整 Takeout 归档`;
        throw new Error(msg);
    }
}

export function validateZipEntries(zip?: any): void {
    if (!zip || !zip.files) return;
    const entryCount = Object.keys(zip.files).length;
    if (entryCount > MAX_ENTRY_COUNT) {
        const i18n = getI18n();
        const msg = (i18n && typeof i18n.t === 'function')
            ? i18n.t('zipTooManyEntries', entryCount, MAX_ENTRY_COUNT)
            : `ZIP 条目数过多 (${entryCount})，超过 ${MAX_ENTRY_COUNT} 上限，疑似 ZipBomb，已中止`;
        throw new Error(msg);
    }

    let approxUncompressed = 0;
    const files: any[] = Object.values(zip.files);
    let unknownSizeEntries = 0;
    for (const f of files) {
        if (f.dir) continue;
        // Check uncompressed size
        const sz = f && f._data && typeof f._data.uncompressedSize === 'number'
            ? f._data.uncompressedSize
            : NaN;
        if (!Number.isFinite(sz)) {
            unknownSizeEntries++;
            continue;
        }
        approxUncompressed += sz;
        if (approxUncompressed > MAX_TOTAL_UNCOMPRESSED) {
            const i18n = getI18n();
            const msg = (i18n && typeof i18n.t === 'function')
                ? i18n.t('zipUncompressedTooLarge')
                : `ZIP 未压缩体积估算超过 1GB，已中止以防 OOM`;
            throw new Error(msg);
        }
    }
    if (unknownSizeEntries > 0) {
        const i18n = getI18n();
        const msg = (i18n && typeof i18n.t === 'function')
            ? i18n.t('zipUnknownSizeEntries', unknownSizeEntries)
            : `ZIP 中有 ${unknownSizeEntries} 个条目无法确认未压缩大小，已中止以防 ZipBomb`;
        throw new Error(msg);
    }
}

export const ZipBombGuard: ZipBombGuardModule = {
    MAX_ZIP_SIZE,
    MAX_ENTRY_COUNT,
    MAX_TOTAL_UNCOMPRESSED,
    validateZipFile,
    validateZipEntries
};

export default ZipBombGuard;
