/**
 * src/core/export/pdf/pipeline/compileStage.ts
 *
 * D7 M4: S4 compile stage. Builds the RenderContext the frozen IPdfCompiler
 * expects (bundle + mount-backed asset resolver + locale + signal), runs the
 * injected compiler, and verifies the PDF bytes. A failed verification is a
 * StageError, never a blank PDF marked ok.
 *
 * Asset mapping is deterministic (D7 M1c contract): S2 produces
 * assetId -> virtualPath (pathMap) and the orchestrator threads it S2 -> S4.
 * The stage never guesses: resolve(assetId) = mounts[pathMap[assetId]].bytes.
 * Anything unmapped, unmatched, or empty resolves to null + a diagnostic so
 * the template renders its visible placeholder (never a silent hole).
 *
 * Notes on the frozen boundaries (do not widen; report gaps to the D7
 * coordinator instead):
 * - IPdfCompiler.compile takes TypstRenderPayload (bundle carrier) with the
 *   D7 S3 prebuilt doc + asset paths: prebuiltDoc lets the compiler skip its
 *   internal toTypstPayload (single conversion), and prebuiltAssetPaths lets
 *   it map imagePath -> assetId back through S2's pathMap instead of its own
 *   payloadOptions.assetPath. The bundle still travels alongside for
 *   compilers that compile from the bundle directly (non-D7 callers).
 * - LocalFontResolution cannot be pushed through IPdfCompiler: the production
 *   compiler only takes bundled font paths at construction. The stage
 *   surfaces the font diagnostics (never silently swaps fonts) and logs the
 *   effective fallback chain; feeding local font bytes into the sandbox is
 *   open M6 wiring work.
 */

import type {
    AssetResolver,
    RenderContext,
    RenderDiagnostic,
    ResolvedAsset,
    TypstRenderPayload,
} from '../../canonical/rendering.js';
import {
    StageError,
    type CompileStageInput,
    type CompileStageOutput,
    type ImageMount,
    type StageFn,
} from './types.js';

/** PDF magic, checked on every compile result before it leaves this stage. */
const PDF_MAGIC = '%PDF-';
/** Trailer marker a structurally complete PDF carries near its end. */
const PDF_EOF_MARKER = '%%EOF';
/** At least one indirect object must be closed for the bytes to be parseable. */
const PDF_ENDOBJ_MARKER = 'endobj';
/** Catalog reference: a trailer dict or a /Root entry proves a document root. */
const PDF_TRAILER_MARKER = 'trailer';
const PDF_ROOT_MARKER = '/Root';
/** How far back from the end of the file to look for the EOF marker. */
const EOF_SCAN_BYTES = 1024;
/** Chunk size for whole-file keyword scans; keeps large PDFs out of one giant string. */
const SCAN_CHUNK_BYTES = 65536;

function isAbortError(e: unknown): boolean {
    return (
        (e instanceof DOMException && e.name === 'AbortError') ||
        (typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError')
    );
}

/**
 * Mount-backed AssetResolver with a deterministic lookup contract:
 * resolve(assetId) = mounts[pathMap[assetId]].bytes. Best-effort guessing
 * (e.g. matching a mount whose virtualPath merely equals the assetId) is
 * deliberately gone: with content-hash-shaped virtual paths such a match
 * would silently bind the wrong bytes to an asset.
 */
function makeMountAssetResolver(
    mounts: ImageMount[],
    input: CompileStageInput,
    diagnostics: RenderDiagnostic[],
): AssetResolver {
    const byVirtualPath = new Map<string, ImageMount[]>();
    for (const mount of mounts) {
        const v = byVirtualPath.get(mount.virtualPath) ?? [];
        v.push(mount);
        byVirtualPath.set(mount.virtualPath, v);
    }

    const miss = (code: string, message: string): null => {
        diagnostics.push({ severity: 'warning', code, message });
        return null;
    };

    return {
        async resolve(assetId: string): Promise<ResolvedAsset | null> {
            const asset = input.bundle.assets.find((a) => a.id === assetId);
            if (!asset) {
                return miss(
                    'COMPILE_ASSET_UNKNOWN_ID',
                    `Asset ${assetId} is not in the canonical bundle; returning null so the template renders its placeholder.`,
                );
            }
            const virtualPath = input.pathMap.get(assetId);
            if (virtualPath === undefined) {
                return miss(
                    'COMPILE_ASSET_PATHMAP_MISSING',
                    `Asset ${assetId} has no S2 pathMap entry; refusing to guess the mount, returning null so the template renders its placeholder.`,
                );
            }
            const candidates = byVirtualPath.get(virtualPath) ?? [];
            if (candidates.length === 0) {
                return miss(
                    'COMPILE_ASSET_MOUNT_MISSING',
                    `No sandbox mount found at virtual path ${virtualPath} for asset ${assetId}; returning null so the template renders its placeholder.`,
                );
            }
            if (candidates.length > 1) {
                return miss(
                    'COMPILE_ASSET_MOUNT_AMBIGUOUS',
                    `${candidates.length} mounts share virtual path ${virtualPath} for asset ${assetId}; refusing to guess, returning null so the template renders its placeholder.`,
                );
            }
            const mount = candidates[0];
            if (!mount.bytes || mount.bytes.length === 0) {
                return miss(
                    'COMPILE_ASSET_MOUNT_EMPTY',
                    `Mount for asset ${assetId} (${mount.virtualPath}) has no bytes; returning null so the template renders its placeholder.`,
                );
            }
            return { asset, bytes: mount.bytes };
        },
    };
}

/**
 * Minimal PDF structural validation. No PDF parser is vendored in the
 * extension, so this stays dependency-free and shallow — but shallow must
 * still mean "parseable", not just "starts with %PDF- and ends with %%EOF".
 * The checks, in order:
 *   1. non-empty;
 *   2. starts with the %PDF- magic;
 *   3. contains at least one `endobj` (a PDF with no indirect objects is
 *      not a document);
 *   4. contains `trailer` or `/Root` (proof a document catalog is referenced);
 *   5. the tail carries `startxref <byte-offset> %%EOF` where the offset is
 *      a real cross-reference pointer: it parses as a number, lies inside
 *      the byte range, and the bytes there begin a classic `xref` table or
 *      an indirect object whose dictionary carries `/Type` `/XRef`
 *      (cross-reference stream). A bare numeric marker — e.g. the
 *      `startxref 0` hand-written fixtures used to carry — is rejected.
 * Anything failing a check is rejected; the caller turns it into a
 * PDF_VERIFY_FAILED stage failure, never a blank PDF marked ok.
 */
function asciiIncludes(haystack: Uint8Array, needle: string): boolean {
    if (needle.length === 0) return true;
    const overlap = needle.length - 1;
    const decoder = new TextDecoder('ascii');
    for (let off = 0; off < haystack.length; off += SCAN_CHUNK_BYTES) {
        const end = Math.min(off + SCAN_CHUNK_BYTES + overlap, haystack.length);
        if (decoder.decode(haystack.subarray(off, end)).includes(needle)) {
            return true;
        }
    }
    return false;
}

function verifyPdfBytes(pdfBytes: Uint8Array): void {
    if (!pdfBytes || pdfBytes.length === 0) {
        throw new Error('compiler returned empty PDF bytes');
    }
    let magic = '';
    for (let i = 0; i < PDF_MAGIC.length && i < pdfBytes.length; i++) {
        magic += String.fromCharCode(pdfBytes[i]);
    }
    if (magic !== PDF_MAGIC) {
        throw new Error(
            `compiler returned ${pdfBytes.length} bytes without the %PDF- magic; refusing to treat them as a PDF`,
        );
    }
    if (!asciiIncludes(pdfBytes, PDF_ENDOBJ_MARKER)) {
        throw new Error('compiler returned %PDF- bytes with no endobj; no indirect objects, refusing to treat them as a parseable PDF');
    }
    if (!asciiIncludes(pdfBytes, PDF_TRAILER_MARKER) && !asciiIncludes(pdfBytes, PDF_ROOT_MARKER)) {
        throw new Error('compiler returned %PDF- bytes with no trailer or /Root; no document catalog reference, refusing to treat them as a parseable PDF');
    }
    const tailStart = Math.max(0, pdfBytes.length - EOF_SCAN_BYTES);
    const tail = new TextDecoder('ascii').decode(pdfBytes.subarray(tailStart));
    const xrefMatch = /startxref[\r\n \t]*([0-9]+)[\r\n \t]*%%EOF/.exec(tail);
    if (!xrefMatch) {
        throw new Error('compiler returned %PDF- bytes without a startxref <offset> %%EOF trailer; refusing to treat them as a complete PDF');
    }
    const xrefOffset = Number(xrefMatch[1]);
    if (!Number.isSafeInteger(xrefOffset) || xrefOffset < 0 || xrefOffset >= pdfBytes.length) {
        throw new Error(
            `compiler returned %PDF- bytes whose startxref offset ${xrefMatch[1]} lies outside the byte range (length ${pdfBytes.length}); not a real cross-reference pointer`,
        );
    }
    // Inspect the bytes at the claimed offset. A classic PDF points at its
    // 'xref' table; an xref-stream PDF points at the indirect object whose
    // dictionary carries /Type /XRef. Anything else (e.g. offset 0, which
    // lands on the %PDF- header) is a decorative marker, not a pointer.
    const probeEnd = Math.min(pdfBytes.length, xrefOffset + 2048);
    const probe = new TextDecoder('ascii')
        .decode(pdfBytes.subarray(xrefOffset, probeEnd))
        .replace(/^[\r\n \t]+/, '');
    const isClassicXref = probe.startsWith('xref');
    const isXrefStream =
        /^\d+[\r\n \t]+\d+[\r\n \t]+obj/.test(probe) &&
        probe.includes('/Type') &&
        probe.includes('/XRef');
    if (!isClassicXref && !isXrefStream) {
        throw new Error(
            `compiler returned %PDF- bytes whose startxref offset ${xrefOffset} does not point at a cross-reference table or cross-reference stream; refusing to treat them as a complete PDF`,
        );
    }
}

/**
 * S4: compile the Typst payload to verified PDF bytes.
 *
 * Mounts reach the sandbox compiler through the RenderContext asset
 * resolver: the compiler maps its payload image paths back to asset ids
 * through prebuiltAssetPaths and calls context.assets.resolve(assetId); per
 * job it ships the resolved bytes to the sandbox as binaries (transferable
 * ArrayBuffers) which the sandbox mounts as shadow files. Abort propagates
 * untouched (never wrapped).
 */
export const compileStage: StageFn<CompileStageInput, CompileStageOutput> = async (input, ctx) => {
    ctx.signal.throwIfAborted();

    const diagnostics: RenderDiagnostic[] = [];

    // Fonts: the resolution is injected (tests) or resolved by M6 via
    // resolveLocalFonts() outside the stage. The frozen compiler interface has
    // no font slot, so the stage forwards every font diagnostic (a silent font
    // swap changes pagination) and logs the effective fallback chain.
    for (const d of input.fonts.diagnostics) {
        diagnostics.push({ severity: d.severity, code: d.code, message: d.message });
    }
    if (input.fonts.localFontsAvailable) {
        ctx.log(`[PDF] compile: local fonts resolved, fallback chain: ${input.fonts.fallbackChain.join(' -> ')}`, 'info');
    } else {
        ctx.log('[PDF] compile: no local fonts resolved; the compiler falls back to bundled fonts', 'warn');
    }

    const context: RenderContext = {
        bundle: input.bundle,
        assets: makeMountAssetResolver(input.mounts, input, diagnostics),
        locale: input.locale,
        signal: ctx.signal,
        reportProgress: ctx.reportProgress,
    };

    // D7 S3 hands the stage a prebuilt Typst JSON doc + the S2 pathMap: the
    // compiler skips its internal toTypstPayload (single conversion) and maps
    // imagePath -> assetId back through the same pathMap.
    const compilerPayload: TypstRenderPayload = {
        rendererSchemaVersion: 1,
        sourceSchemaVersion: 1,
        bundle: input.bundle,
        prebuiltDoc: input.payload,
        prebuiltAssetPaths: input.pathMap,
    };

    let pdfBytes: Uint8Array;
    try {
        const result = await input.compiler.compile(compilerPayload, context);
        diagnostics.push(...result.diagnostics);
        pdfBytes = result.pdfBytes;
    } catch (e) {
        if (isAbortError(e)) throw e;
        throw new StageError(
            'compile',
            'COMPILE_FAILED',
            `PDF compiler '${input.compiler.name}' failed: ${(e as Error)?.message ?? String(e)}`,
            { retryable: true, cause: e, diagnostics },
        );
    }

    try {
        verifyPdfBytes(pdfBytes);
    } catch (e) {
        throw new StageError(
            'compile',
            'PDF_VERIFY_FAILED',
            `PDF verification failed for compiler '${input.compiler.name}': ${(e as Error)?.message ?? String(e)}`,
            { retryable: true, cause: e, diagnostics },
        );
    }

    return { output: { pdfBytes }, diagnostics };
};
