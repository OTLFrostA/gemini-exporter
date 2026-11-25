const MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB compressed size
const MAX_ENTRY_COUNT = 10000; // 10,000 files
const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1GB uncompressed estimate

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isZipContainer(value: unknown): value is { files: Record<string, unknown> } {
    return isRecord(value) && isRecord(value.files);
}

export function validateZipFile(file?: unknown): void {
    // Handle pre-loaded JSZip instances
    if (isRecord(file) && typeof file.file === 'function' && isRecord(file.files)) {
        validateZipEntries(file);
        return;
    }
    // Accept File/Blob (.size) as well as Buffer/Uint8Array (.length/.byteLength).
    const byteSize = typeof file === 'string'
        ? file.length
        : isRecord(file)
            ? (typeof file.size === 'number' ? file.size
                : typeof file.length === 'number' ? file.length
                : typeof file.byteLength === 'number' ? file.byteLength
                : NaN)
            : NaN;
    // Fail closed when size cannot be determined or is negative
    if (!Number.isFinite(byteSize) || byteSize < 0) {
        throw new Error('无法确认 Takeout ZIP 体积，已中止以防 ZipBomb');
    }
    if (byteSize > MAX_ZIP_SIZE) {
        const curMb = (byteSize / 1024 / 1024).toFixed(1);
        const maxMb = (MAX_ZIP_SIZE / 1024 / 1024).toFixed(0);
        throw new Error(`Takeout ZIP 体积过大 (${curMb}MB)，超过 ${maxMb}MB 上限，请确认是否为完整 Takeout 归档`);
    }
}

export function validateZipEntries(zip?: unknown): void {
    if (!isZipContainer(zip)) return;
    const entryCount = Object.keys(zip.files).length;
    if (entryCount > MAX_ENTRY_COUNT) {
        throw new Error(`ZIP 条目数过多 (${entryCount})，超过 ${MAX_ENTRY_COUNT} 上限，疑似 ZipBomb，已中止`);
    }

    let approxUncompressed = 0;
    const files = Object.values(zip.files);
    let unknownSizeEntries = 0;
    for (const f of files) {
        if (isRecord(f) && f.dir) continue;
        const data = isRecord(f) && isRecord(f._data) ? f._data : null;
        const sz = data && typeof data.uncompressedSize === 'number'
            ? data.uncompressedSize
            : NaN;
        if (!Number.isFinite(sz) || sz < 0) {
            unknownSizeEntries++;
            continue;
        }
        approxUncompressed += sz;
        if (approxUncompressed > MAX_TOTAL_UNCOMPRESSED) {
            throw new Error('ZIP 未压缩体积估算超过 1GB，已中止以防 OOM');
        }
    }
    if (unknownSizeEntries > 0) {
        throw new Error(`ZIP 中有 ${unknownSizeEntries} 个条目无法确认未压缩大小，已中止以防 ZipBomb`);
    }
}
