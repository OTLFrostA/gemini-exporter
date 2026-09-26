import { isAbortError } from '../errors.js';
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

const PDF_MAGIC = '%PDF-';
const PDF_EOF_MARKER = '%%EOF';
const PDF_ENDOBJ_MARKER = 'endobj';
const PDF_TRAILER_MARKER = 'trailer';
const PDF_ROOT_MARKER = '/Root';
const EOF_SCAN_BYTES = 1024;
const SCAN_CHUNK_BYTES = 65536;

// Resolve strictly via pathMap[assetId] -> virtualPath so content-addressed mounts cannot collide with asset IDs.
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

// Extracts the first balanced << ... >> dictionary starting at `from`, handling nested dictionaries.
function extractFirstDictionary(text: string, from: number): string | null {
    const open = text.indexOf('<<', from);
    if (open < 0) return null;
    let depth = 0;
    let i = open;
    while (i < text.length - 1) {
        if (text[i] === '<' && text[i + 1] === '<') {
            depth++;
            i += 2;
        } else if (text[i] === '>' && text[i + 1] === '>') {
            depth--;
            i += 2;
            if (depth === 0) return text.slice(open, i);
        } else {
            i++;
        }
    }
    return null;
}

// Lexes a PDF dictionary for adjacent /Type /XRef name tokens while skipping comments, literal strings, and hex strings.
function dictionaryHasXrefStreamType(dict: string): boolean {
    const isSpace = (c: string): boolean =>
        c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r' || c === '\0';
    const isDelim = (c: string): boolean => '()<>[]{}/%'.includes(c);
    let i = 0;

    function nextToken(): { kind: 'name' | 'other'; value?: string } | null {
        while (i < dict.length) {
            const c = dict[i];
            if (isSpace(c)) {
                i++;
                continue;
            }
            if (c === '%') {
                while (i < dict.length && dict[i] !== '\n' && dict[i] !== '\r') i++;
                continue;
            }
            if (c === '(') {
                let depth = 1;
                i++;
                while (i < dict.length && depth > 0) {
                    if (dict[i] === '\\') {
                        i += 2;
                        continue;
                    }
                    if (dict[i] === '(') depth++;
                    else if (dict[i] === ')') depth--;
                    i++;
                }
                return { kind: 'other' };
            }
            if (c === '<') {
                if (dict[i + 1] === '<') {
                    i += 2;
                } else {
                    i++;
                    while (i < dict.length && dict[i] !== '>') i++;
                    if (i < dict.length) i++;
                }
                return { kind: 'other' };
            }
            if (c === '>') {
                i += dict[i + 1] === '>' ? 2 : 1;
                return { kind: 'other' };
            }
            if (c === '/') {
                let j = i + 1;
                while (j < dict.length && !isSpace(dict[j]) && !isDelim(dict[j])) j++;
                const value = dict.slice(i, j);
                i = j;
                return { kind: 'name', value };
            }
            if (c === '[' || c === ']') {
                i++;
                return { kind: 'other' };
            }
            let j = i;
            while (j < dict.length && !isSpace(dict[j]) && !isDelim(dict[j])) j++;
            i = Math.max(j, i + 1);
            return { kind: 'other' };
        }
        return null;
    }

    let token = nextToken();
    while (token !== null) {
        if (token.kind === 'name' && token.value === '/Type') {
            const next = nextToken();
            if (next !== null && next.kind === 'name' && next.value === '/XRef') return true;
            token = next;
        } else {
            token = nextToken();
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
    // Verify startxref points to either a classic 'xref' table or an indirect object whose own dictionary has /Type /XRef.
    const probeEnd = Math.min(pdfBytes.length, xrefOffset + 2048);
    const probe = new TextDecoder('ascii')
        .decode(pdfBytes.subarray(xrefOffset, probeEnd))
        .replace(/^[\r\n \t]+/, '');
    const isClassicXref = probe.startsWith('xref');
    let isXrefStream = false;
    const objHeader = /^\d+[\r\n \t]+\d+[\r\n \t]+obj/.exec(probe);
    if (objHeader) {
        const bodyStart = objHeader[0].length;
        const endobjIdx = probe.indexOf('endobj', bodyStart);
        const bodyEnd = endobjIdx < 0 ? probe.length : endobjIdx;
        const dict = extractFirstDictionary(probe.slice(0, bodyEnd), bodyStart);
        isXrefStream = dict !== null && dictionaryHasXrefStreamType(dict);
    }
    if (!isClassicXref && !isXrefStream) {
        throw new Error(
            `compiler returned %PDF- bytes whose startxref offset ${xrefOffset} does not point at a cross-reference table or cross-reference stream; refusing to treat them as a complete PDF`,
        );
    }
}

export const compileStage: StageFn<CompileStageInput, CompileStageOutput> = async (input, ctx) => {
    ctx.signal.throwIfAborted();

    const diagnostics: RenderDiagnostic[] = [];

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

    // Pass prebuilt payload and asset paths so the compiler skips re-converting the bundle.
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
