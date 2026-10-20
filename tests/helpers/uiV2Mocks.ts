import type { ExportProgress, ExportRequest, ExportResult } from '../../src/application/export/types.js';

/**
 * Node UI-unit boundary: every non-UI module below is represented by its frozen v2
 * *public* port, never its implementation. No real App/Runtime/L1/L2/Storage/L4
 * graph is loaded by tests of UI Controllers / View State / Guidance.
 *
 * Install BEFORE requiring a production UI module; tests/ts_register.js resolves
 * the migrated .js specifiers to .ts and each node:test file runs in its own process.
 */
export const A = '11111111-1111-4111-8111-111111111111';
export const B = '22222222-2222-4222-8222-222222222222';

export const exportPort = {
    calls: [] as { request: ExportRequest; signal?: AbortSignal }[],
    progress: [] as ExportProgress[],
    result: null as ExportResult | null,
    error: null as Error | null,
    reset(): void {
        this.calls.length = 0;
        this.progress.length = 0;
        this.result = null;
        this.error = null;
    },
};

export async function mockRunExport(request: ExportRequest, options: {
    onProgress?: (progress: ExportProgress) => void; signal?: AbortSignal;
} = {}): Promise<ExportResult> {
    exportPort.calls.push({ request, signal: options.signal });
    if (exportPort.error) throw exportPort.error;
    for (const [index, key] of request.keys.entries()) {
        const progress: ExportProgress = { current: index + 1, total: request.keys.length, key };
        exportPort.progress.push(progress);
        options.onProgress?.(progress);
    }
    return exportPort.result ?? { exported: request.keys.length, partial: 0, skipped: 0, failed: [], aborted: false };
}

function unconfigured(port: string): never {
    throw new Error(`UI unit test did not mock v2 external port: ${port}`);
}
function stub(relativePath: string, exports: object): void {
    const filename = require.resolve(relativePath);
    // A test harness may provide a public port without loading the real owner.
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
}

/** Call once at the beginning of every Node UI-unit test file. */
export function installUiV2Mocks(): void {
    stub('../../src/application/export/runExport.js', { runExport: mockRunExport });
    stub('../../src/application/sync/scanController.js', {
        scanAll: () => unconfigured('Application.scanAll'),
    });
    stub('../../src/application/settings/index.js', {
        getSettings: () => unconfigured('Application.getSettings'),
        updateSettings: () => unconfigured('Application.updateSettings'),
        isLiveSaveEffective: (settings: { enabledDisk: boolean; defaultFormat: string }, permitted: boolean) =>
            settings.enabledDisk && settings.defaultFormat === 'markdown' && permitted,
    });
    stub('../../src/runtime/api/accountRegistry.js', {
        listAccounts: () => unconfigured('Runtime.listAccounts'),
        getAccount: () => unconfigured('Runtime.getAccount'),
        getOrCreateAccount: () => unconfigured('Runtime.getOrCreateAccount'),
    });
    stub('../../src/runtime/capabilities/tabService.js', {
        resolveScanTarget: () => unconfigured('Runtime.resolveScanTarget'),
    });
    stub('../../src/l3a/storageService.js', {
        listIndexes: () => unconfigured('Storage.listIndexes'),
        listExportRecords: () => unconfigured('Storage.listExportRecords'),
    });
    stub('../../src/l1/imports/takeout/importTakeout.js', {
        importTakeout: () => unconfigured('L1.importTakeout'),
    });
    stub('../../src/shared/utils/pathUtils.js', {
        isVersionGreater: (one: string, two: string) => {
            const left = one.replace(/^v/i, '').split('.').map(Number);
            const right = two.replace(/^v/i, '').split('.').map(Number);
            for (let i = 0; i < Math.max(left.length, right.length); i++) {
                if ((left[i] ?? 0) > (right[i] ?? 0)) return true;
                if ((left[i] ?? 0) < (right[i] ?? 0)) return false;
            }
            return false;
        },
    });
}
