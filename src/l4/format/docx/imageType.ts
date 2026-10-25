/** DOCX supports PNG, JPEG and GIF directly; only claim embedding when the bytes match the MIME type. */
export type DocxImageType = 'png' | 'jpeg' | 'gif';

export function docxImageType(mediaType: string | undefined, bytes: Uint8Array): DocxImageType | undefined {
    const type = mediaType?.split(';', 1)[0].trim().toLowerCase();
    if (type === 'image/png' && bytes.length >= 24
        && bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
        && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'png';
    if (type === 'image/jpeg' && bytes.length >= 4
        && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg';
    if (type === 'image/gif' && bytes.length >= 10
        && bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 56
        && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97) return 'gif';
    return undefined;
}
