/** Read an unsigned embedded media timestamp as acquisition evidence, never conversation activity. */
export function extractC2PATimestamp(bufferOrArray: unknown): number | null {
    if (!bufferOrArray) return null;
    let str = '';
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(bufferOrArray)) {
        str = bufferOrArray.toString('utf8', 0, Math.min(bufferOrArray.length, 65536));
    } else if (ArrayBuffer.isView(bufferOrArray)) {
        const len = Math.min(bufferOrArray.byteLength, 65536);
        const view = new Uint8Array(bufferOrArray.buffer, bufferOrArray.byteOffset, len);
        str = new TextDecoder('utf-8', { fatal: false }).decode(view);
    } else if (typeof bufferOrArray === 'string') {
        str = bufferOrArray.slice(0, 65536);
    } else {
        return null;
    }
    const m = /(20\d{2})([01]\d)([0-3]\d)([0-2]\d)([0-5]\d)([0-5]\d)Z/.exec(str);
    if (!m || m.index === undefined) return null;
    // Require a trust marker near candidate timestamp to prevent false positives
    const windowStart = Math.max(0, m.index - 512);
    const near = str.slice(windowStart, m.index + 32);
    if (!/(c2pa|jumb|jxmp|xmp|dc:|exif|tiff|createDate|dateTimeOriginal|claim_generator)/i.test(near)) {
        return null;
    }
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    const hour = parseInt(m[4], 10);
    const min = parseInt(m[5], 10);
    const sec = parseInt(m[6], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31 ||
        hour > 23 || min > 59 || sec > 60) return null;
    const t = Date.UTC(year, month - 1, day, hour, min, sec);
    const d = new Date(t);
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
        return null;
    }
    return t;
}
