import { BatchWorker, type BatchWorkerModule } from '../../src/core/engine/export/batchWorker.js';

export function makeTestWorker(overrides: Partial<BatchWorkerModule> = {}): BatchWorkerModule {
    return { ...BatchWorker, ...overrides };
}
