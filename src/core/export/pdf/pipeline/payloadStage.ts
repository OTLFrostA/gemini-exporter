import type { DocumentDiagnostic as RenderDiagnostic } from '../../../diagnostics/documentDiagnostic.js';
import type { DocumentDiagnostic as TypstAdapterDiagnostic } from '../../../diagnostics/documentDiagnostic.js';
import { renderDocumentTypst } from '../../../renderers/typst/renderTypst.js';
import { convertMathWithMitex, initMitexWasm } from '../../../renderers/typst/mathConverter.js';
import { getErrorMessage } from '../../../utils/messaging.js';
import {
    type PayloadStageInput,
    type PayloadStageOutput,
    type StageContext,
    type StageFn,
} from './types.js';

function mapDiagnostic(d: TypstAdapterDiagnostic): RenderDiagnostic {
    return { severity: d.severity, code: d.code, message: d.message, path: d.path };
}

export const payloadStage: StageFn<PayloadStageInput, PayloadStageOutput> = async (
    input: PayloadStageInput,
    ctx: StageContext,
) => {
    if (ctx.signal.aborted) {
        throw new DOMException(`Pipeline aborted before stage 'payload'`, 'AbortError');
    }

    const initDiagnostics: TypstAdapterDiagnostic[] = [];
    let mitexAvailable = true;

    try {
        await initMitexWasm();
    } catch (err: unknown) {
        mitexAvailable = false;
        initDiagnostics.push({
            severity: 'warning',
            code: 'TYPST_MATH_INIT_FAILED',
            message: `MiTeX WASM initialization failed: ${getErrorMessage(err)}. Math formulas preserved as raw LaTeX fallback.`,
        });
    }

    // Capture math conversion diagnostics in the closure since the convertMath callback only returns string | undefined.
    const mathDiagnostics: TypstAdapterDiagnostic[] = [];
    const resources = Object.fromEntries(input.pathMap);
    const payload = renderDocumentTypst(input.document, resources, { locale: input.locale, onDiagnostic: diagnostic => mathDiagnostics.push(diagnostic), convertMath: (source, display) => {
        if (!mitexAvailable) {
            return undefined;
        }
        const converted = convertMathWithMitex(source, 'latex', display);
        if (converted.diagnostic) mathDiagnostics.push(converted.diagnostic);
        return converted.typst;
    } });
    const diagnostics = [...initDiagnostics, ...mathDiagnostics].map(mapDiagnostic);
    return { output: { payload }, diagnostics };
};
