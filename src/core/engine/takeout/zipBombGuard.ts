// zipBombGuard.ts - ZipBomb protection guards and entry size estimators for Takeout ZIP extraction

export interface ZipBombGuardModule {
    MAX_ZIP_SIZE: number;
    MAX_ENTRY_COUNT: number;
    MAX_TOTAL_UNCOMPRESSED: number;
    validateZipFile: (file?: { size?: number } | null) => void;
    validateZipEntries: (zip?: any) => void;
}

declare global {
    var ZipBombGuard: ZipBombGuardModule;
}

export const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB compressed size
export const MAX_ENTRY_COUNT = 10000; // 10,000 files
export const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1GB uncompressed estimate

export function validateZipFile(file?: { size?: number } | null): void {
    // P1-114(b): parseTakeoutZip also accepts an already-loaded JSZip object
    // (file.file === 'function' && file.files), which has no .size — the old
    // check silently skipped the 500MB cap for it. Detect and validate entries.
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
    // P1-114 fail-closed: when we cannot determine the size at all, refuse
    // instead of silently skipping the guard.
    if (!Number.isFinite(byteSize)) {
        throw new Error('无法确认 Takeout ZIP 体积，已中止以防 ZipBomb');
    }
    if (byteSize > MAX_ZIP_SIZE) {
        throw new Error(`Takeout ZIP 体积过大 (${(byteSize / 1024 / 1024).toFixed(1)}MB)，超过 ${MAX_ZIP_SIZE / 1024 / 1024}MB 上限，请确认是否为完整 Takeout 归档`);
    }
}

export function validateZipEntries(zip?: any): void {
    if (!zip || !zip.files) return;
    const entryCount = Object.keys(zip.files).length;
    if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error(`ZIP 条目数过多 (${entryCount})，超过 ${MAX_ENTRY_COUNT} 上限，疑似 ZipBomb，已中止`);
    }

    let approxUncompressed = 0;
    const files: any[] = Object.values(zip.files);
    let unknownSizeEntries = 0;
    for (const f of files) {
        if (f.dir) continue;
        // P1-114(a) fail-closed: entries whose uncompressed size cannot be
        // verified must not be silently excluded from the 1GB cap — that made
        // the guard a no-op whenever JSZip internals changed shape.
        const sz = f && f._data && typeof f._data.uncompressedSize === 'number'
            ? f._data.uncompressedSize
            : NaN;
        if (!Number.isFinite(sz)) {
            unknownSizeEntries++;
            continue;
        }
        approxUncompressed += sz;
        if (approxUncompressed > MAX_TOTAL_UNCOMPRESSED) {
            throw new Error(`ZIP 未压缩体积估算超过 1GB，已中止以防 OOM`);
        }
    }
    if (unknownSizeEntries > 0) {
        throw new Error(`ZIP 中有 ${unknownSizeEntries} 个条目无法确认未压缩大小，已中止以防 ZipBomb`);
    }
}

export const ZipBombGuard: ZipBombGuardModule = {
    MAX_ZIP_SIZE,
    MAX_ENTRY_COUNT,
    MAX_TOTAL_UNCOMPRESSED,
    validateZipFile,
    validateZipEntries
};

(ZipBombGuard as any).ZipBombGuard = ZipBombGuard;
(ZipBombGuard as any).default = ZipBombGuard;

if (typeof globalThis !== 'undefined' && !(globalThis as any).ZipBombGuard) {
    (globalThis as any).ZipBombGuard = ZipBombGuard;
}
if (typeof module === 'object' && module.exports) {
    module.exports = ZipBombGuard;
}
export default ZipBombGuard;
