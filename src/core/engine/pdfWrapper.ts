// src/core/engine/pdfWrapper.ts - Zero-dependency single-page scrollable PDF generator
/**
 * Wraps a JPEG image into a standard, valid PDF 1.4 binary Blob.
 * Uses native /DCTDecode stream embedding with zero external dependencies.
 */
export function wrapJpegToPdf(jpegBinary: Uint8Array, widthPx: number, heightPx: number): Blob {
    // 72 PDF points per inch, typical 96 CSS pixels per inch (ratio 72/96 = 0.75)
    const ptWidth = Math.round(widthPx * 0.75);
    const ptHeight = Math.round(heightPx * 0.75);

    const encoder = new TextEncoder();

    const header = `%PDF-1.4\n`;

    const obj1 = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
    const obj2 = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
    const obj3 = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptWidth} ${ptHeight}] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`;

    const imgHeader = `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBinary.byteLength} >>\nstream\n`;
    const imgFooter = `\nendstream\nendobj\n`;

    const contentStream = `q ${ptWidth} 0 0 ${ptHeight} 0 0 cm /Im1 Do Q`;
    const contentStreamBytes = encoder.encode(contentStream);
    const obj5 = `5 0 obj\n<< /Length ${contentStreamBytes.byteLength} >>\nstream\n${contentStream}\nendstream\nendobj\n`;

    // Construct offsets for xref
    const parts: Uint8Array[] = [];
    const offsets: number[] = [0];

    function appendStr(s: string) {
        const b = encoder.encode(s);
        parts.push(b);
        return b.byteLength;
    }

    let byteCount = 0;
    byteCount += appendStr(header);

    offsets.push(byteCount);
    byteCount += appendStr(obj1);

    offsets.push(byteCount);
    byteCount += appendStr(obj2);

    offsets.push(byteCount);
    byteCount += appendStr(obj3);

    offsets.push(byteCount);
    byteCount += appendStr(imgHeader);
    parts.push(jpegBinary);
    byteCount += jpegBinary.byteLength;
    byteCount += appendStr(imgFooter);

    offsets.push(byteCount);
    byteCount += appendStr(obj5);

    const xrefOffset = byteCount;
    let xref = `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 1; i <= 5; i++) {
        xref += String(offsets[i]).padStart(10, '0') + ` 00000 n \n`;
    }
    xref += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    appendStr(xref);

    return new Blob(parts as any, { type: 'application/pdf' });
}

/**
 * Converts an HTML Canvas into a downloadable PDF Blob.
 */
export async function canvasToPdfBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    const jpegBlob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
    });
    if (!jpegBlob) {
        throw new Error('Failed to create JPEG blob from canvas');
    }

    const arrayBuffer = await jpegBlob.arrayBuffer();
    const jpegBytes = new Uint8Array(arrayBuffer);
    return wrapJpegToPdf(jpegBytes, canvas.width, canvas.height);
}

export const PdfWrapper = {
    wrapJpegToPdf,
    canvasToPdfBlob
};

export default PdfWrapper;
