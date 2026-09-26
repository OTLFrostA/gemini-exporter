/**
 * src/core/export/pdf/pipeline/payloadStage.ts
 *
 * D7 S3 (M2): Typst payload stage.
 *
 * Consumes the S1 projected view directly — this stage never linearizes the
 * bundle itself (the D7 hard line: the PDF path only ever consumes S1's
 * view). Asset paths come from the S2 pathMap; this stage never re-resolves
 * assets.
 *
 * Math goes through the controlled converter (convertMathWithDiagnostic).
 * The adapter hook can only return `typst | undefined`, so the failure
 * diagnostic from convertMathWithDiagnostic is captured in the closure and
 * surfaced as a RenderDiagnostic: a degraded formula keeps its raw latex
 * in the payload AND produces a diagnostic — never silent.
 */

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

/**
 * TypstAdapterDiagnostic -> RenderDiagnostic. The two shapes are already
 * field-aligned (severity/code/message/path); the mapping is explicit so a
 * future divergence fails at type-check time instead of silently drifting.
 */
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
    // The convertMath hook can only report failure via `undefined`; the
    // diagnostic carrying the reason would be lost if we used the plain
    // convertMath drop-in. Capture it here so degraded math stays diagnosed.
    const mathDiagnostics: TypstAdapterDiagnostic[] = [];
    const result = toTypstPayload(input.bundle, {
        assetPath: (asset) => input.pathMap.get(asset.id),
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
