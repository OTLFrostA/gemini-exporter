import type { RenderDiagnostic } from '../../canonical/rendering.js';
import type { TypstAdapterDiagnostic } from '../../typst/payload.js';
import { toTypstPayload } from '../../typst/payload.js';
import { convertMathWithDiagnostic } from '../../typst/mathConverter.js';
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
    // Capture math conversion diagnostics in the closure since the convertMath callback only returns string | undefined.
    const mathDiagnostics: TypstAdapterDiagnostic[] = [];
    const result = toTypstPayload(input.bundle, {
        assetPath: (asset) => input.pathMap.get(asset.id),
        locale: input.locale,
        convertMath: (source, notation, display) => {
            const converted = convertMathWithDiagnostic(source, notation, display);
            if (converted.diagnostic) mathDiagnostics.push(converted.diagnostic);
            return converted.typst;
        },
        projectedMessages: input.view.messages,
    });
    const diagnostics = [...result.diagnostics, ...mathDiagnostics].map(mapDiagnostic);
    return { output: { payload: result.payload }, diagnostics };
};
