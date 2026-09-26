/**
 * src/core/export/pdf/pipeline/runner.ts
 *
 * D7 M1: cross-cutting stage execution. Runs stages sequentially, accumulates
 * diagnostics in stage order, wraps failures as StageError, and lets aborts
 * propagate untouched (an abort is never converted into a quiet failure).
 */

import type { RenderDiagnostic } from '../../canonical/rendering.js';
import {
    StageError,
    type PipelineStageName,
    type StageContext,
    type StageFn,
} from './types.js';

function isAbortError(e: unknown): boolean {
    return (
        (e instanceof DOMException && e.name === 'AbortError') ||
        (typeof e === 'object' && e !== null && (e as any).name === 'AbortError')
    );
}

/**
 * Run one stage with uniform error semantics:
 * - AbortError propagates as-is (caller maps it to 'aborted', not 'failed').
 * - StageError passes through untouched.
 * - Anything else is wrapped in a StageError (retryable, with the stage name).
 */
export async function runStage<I, O>(
    stage: PipelineStageName,
    fn: StageFn<I, O>,
    input: I,
    ctx: StageContext,
): Promise<{ output: O; diagnostics: RenderDiagnostic[] }> {
    if (ctx.signal.aborted) {
        throw new DOMException(`Pipeline aborted before stage '${stage}'`, 'AbortError');
    }
    try {
        return await fn(input, ctx);
    } catch (e) {
        if (isAbortError(e) || e instanceof StageError) {
            throw e;
        }
        throw new StageError(stage, 'STAGE_THREW', `Stage '${stage}' threw: ${(e as Error)?.message ?? String(e)}`, {
            cause: e,
        });
    }
}
