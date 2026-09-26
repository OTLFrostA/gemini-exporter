/**
 * src/core/export/pdf/pipeline/projectionStage.ts
 *
 * D7 S1 (M2): branch projection stage.
 *
 * The projection is computed by the shared canonical projectConversation()
 * (src/core/export/canonical/projection.ts); this stage never re-derives
 * branch policy itself. CanonicalProjectionError (an invalid message tree)
 * becomes a non-retryable StageError: bad data does not get better by
 * retrying.
 */

import {
    CanonicalProjectionError,
    projectConversation,
    type ProjectedView,
} from '../../canonical/projection.js';
import {
    StageError,
    type ProjectStageInput,
    type ProjectStageOutput,
    type StageContext,
    type StageFn,
} from './types.js';

export const projectStage: StageFn<ProjectStageInput, ProjectStageOutput> = async (
    input: ProjectStageInput,
    ctx: StageContext,
) => {
    if (ctx.signal.aborted) {
        throw new DOMException(`Pipeline aborted before stage 'project'`, 'AbortError');
    }
    let view: ProjectedView;
    try {
        view = projectConversation(
            input.bundle,
            input.leafMessageId ? { leafMessageId: input.leafMessageId } : undefined,
        );
    } catch (e) {
        if (e instanceof CanonicalProjectionError) {
            throw new StageError('project', e.code, `Projection failed: ${e.message}`, {
                retryable: false,
                cause: e,
            });
        }
        throw e;
    }
    const omitted = view.omittedBranchMessageIds.length;
    if (omitted > 0) {
        ctx.log(
            `project: ${omitted} message(s) omitted by branch selection ` +
                `(${view.messages.length} on the selected path)`,
            'info',
        );
    }
    return { output: { bundle: input.bundle, view }, diagnostics: [] };
};
