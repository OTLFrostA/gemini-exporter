import { projectConversation } from '../../canonical/projection.js';
import type { ProjectStageInput, ProjectStageOutput, StageContext, StageFn } from './types.js';

export const projectStage: StageFn<ProjectStageInput, ProjectStageOutput> = async (
    input: ProjectStageInput,
    ctx: StageContext,
) => {
    if (ctx.signal.aborted) {
        throw new DOMException(`Pipeline aborted before stage 'project'`, 'AbortError');
    }
    const view = projectConversation(input.bundle);
    return { output: { bundle: input.bundle, view }, diagnostics: [] };
};
