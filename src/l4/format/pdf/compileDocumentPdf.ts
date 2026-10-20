import type { DocumentAst } from '../../../l3b/ast/ast.js';
import type { ResourceBindings } from '../../packaging/resourceBindings.js';
import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import type { PreparedResources } from '../../../shared/resources/resourceResult.js';
import type { PdfRenderOptions } from '../shared/renderOptions.js';
import { renderDocumentTypst } from '../typst/renderTypst.js';
import { isResourcePath } from '../shared/resourcePath.js';
import { initMitexWasm, convertMathWithMitex } from '../typst/mathConverter.js';
import { checkImageContent, MAX_ASSET_BYTES } from '../resources/imageContent.js';
import type { IPdfCompiler, PdfCompileContext, PdfCompileResult } from './pdfCompiler.js';

/** Format-only calculation. The caller supplies image bytes, paths, initialized fonts
 * and compiler lifetime; batching, acquisition, delivery and records stay upstream. */
export async function compileDocumentPdf(
    document: DocumentAst,
    bindings: ResourceBindings,
    prepared: PreparedResources,
    compiler: IPdfCompiler,
    context: Omit<PdfCompileContext, 'assets'>,
    options: PdfRenderOptions = {},
): Promise<PdfCompileResult> {
    context.signal.throwIfAborted();
    const diagnostics: Diagnostic[] = [];
    const report = (diagnostic: Diagnostic): void => {
        diagnostics.push(diagnostic);
        options.onDiagnostic?.(diagnostic);
    };
    const assetPaths = new Map<string, string>();
    const images = new Map<string, Uint8Array>();
    // Export selects imageIds before preparing resources. We only inspect those
    // existing bytes, and retain Packaging's paths without hashing or renaming.
    for (const [id, result] of prepared) {
        context.signal.throwIfAborted();
        const path = bindings[id];
        if (!isResourcePath(path) || !result.ok) continue;
        const { bytes, name, mediaType } = result.value;
        const diag = (_id: string, severity: Diagnostic['severity'], code: string, message: string): void =>
            report({ severity, code, message, path: `asset:${id}` });
        if (!bytes.length || bytes.length > MAX_ASSET_BYTES) {
            diag(id, 'warning', bytes.length ? 'ASSET_TOO_LARGE' : 'ASSET_ZERO_BYTES', 'Prepared image is empty or exceeds the PDF byte limit');
        } else if (checkImageContent({ id, name, mimeType: mediaType }, bytes, diag).ok) {
            assetPaths.set(id, path);
            images.set(id, bytes);
        }
    }
    let convertMath = options.convertMath;
    if (!convertMath) {
        try {
            await initMitexWasm();
            convertMath = (source, display) => {
                const result = convertMathWithMitex(source, 'latex', display);
                if (result.diagnostic) report(result.diagnostic);
                return result.typst;
            };
        } catch (error) {
            report({ severity: 'warning', code: 'TYPST_MATH_INIT_FAILED',
                message: `MiTeX unavailable; original LaTeX preserved: ${error instanceof Error ? error.message : String(error)}` });
        }
    }
    context.signal.throwIfAborted();
    const payload = renderDocumentTypst(document, Object.fromEntries(assetPaths), { ...options, convertMath, onDiagnostic: report });
    const result = await compiler.compile({ rendererSchemaVersion: 1, document: payload, assetPaths }, {
        ...context,
        assets: { async resolve(id) {
            context.signal.throwIfAborted();
            const bytes = images.get(id);
            return bytes ? { bytes } : null;
        } },
    });
    context.signal.throwIfAborted();
    const bytes = result.pdfBytes;
    if (!(bytes instanceof Uint8Array) || bytes.length < 64 || String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') {
        throw new Error('Compiler returned empty, truncated or invalid PDF bytes');
    }
    return { pdfBytes: bytes, diagnostics: [...diagnostics, ...result.diagnostics] };
}
