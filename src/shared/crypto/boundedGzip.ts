import { OperationError } from '../errors/operationError.js';
import { toOwnedBytes } from './recoveryKey.js';

/** Hard ceiling on decompressed UTF-8 byte length (16 MiB) to block Gzip bombs before OOM. */
export const MAX_DECOMPRESSED_UTF8_BYTES = 16 * 1024 * 1024;

function concatChunks(chunks: readonly Uint8Array[], totalBytes: number): Uint8Array<ArrayBuffer> {
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return merged;
}

/** Compress a UTF-8 string with native Gzip before AEAD encryption. */
export async function compressUtf8Gzip(plaintextUtf8: string): Promise<Uint8Array<ArrayBuffer>> {
    const input = toOwnedBytes(new TextEncoder().encode(plaintextUtf8));
    if (input.byteLength > MAX_DECOMPRESSED_UTF8_BYTES) {
        throw new OperationError(
            'CLOUD_RECORD_TOO_LARGE',
            `Plaintext exceeds maximum allowed size (${MAX_DECOMPRESSED_UTF8_BYTES} bytes)`,
        );
    }
    const stream = new Blob([input]).stream().pipeThrough(new CompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            totalBytes += value.byteLength;
        }
    } finally {
        reader.releaseLock();
    }
    return concatChunks(chunks, totalBytes);
}

/**
 * Decompress verified Gzip bytes into a UTF-8 string while enforcing a strict streaming
 * byte ceiling so a crafted high-ratio archive can never exhaust extension memory.
 */
export async function decompressUtf8GzipBounded(
    compressed: Uint8Array,
    maxBytes: number = MAX_DECOMPRESSED_UTF8_BYTES,
): Promise<string> {
    if (compressed.byteLength === 0) {
        throw new OperationError('CLOUD_DECOMPRESSION_LIMIT', 'Compressed payload is empty');
    }
    const stream = new Blob([toOwnedBytes(compressed)]).stream().pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
                await reader.cancel('Decompressed byte ceiling exceeded').catch(() => {});
                throw new OperationError(
                    'CLOUD_DECOMPRESSION_LIMIT',
                    `Decompressed payload exceeds ${maxBytes} bytes`,
                );
            }
            chunks.push(value);
        }
    } catch (error) {
        if (error instanceof OperationError) throw error;
        throw new OperationError('CLOUD_DECOMPRESSION_LIMIT', 'Corrupted Gzip payload inside envelope', undefined, { cause: error });
    } finally {
        reader.releaseLock();
    }
    const merged = concatChunks(chunks, totalBytes);
    return new TextDecoder('utf-8', { fatal: true }).decode(merged);
}
