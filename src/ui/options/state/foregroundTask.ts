import type { ScanProgress, ScanResult } from '../../../application/sync/scanController.js';

/** Raw synchronization facts for diagnostics and UI automation, independent of translated copy. */
export interface ScanEvidence {
    accountId: string | null;
    progress: ScanProgress;
    result?: ScanProgress & Pick<ScanResult, 'status' | 'reason'>;
}

/** UI operation ownership. Source scanning has an independent lifetime. */
export type ForegroundTaskStatus =
    | { kind: 'idle' }
    | { kind: 'export'; phase: 'running' | 'cancelling' | 'refreshing' }
    | { kind: 'takeout' | 'cleanup'; phase: 'running' | 'refreshing' };

/** Only the workbench coordinator can abort a run; views receive status only. */
export type ForegroundTask = { kind: 'idle' }
    | (Exclude<ForegroundTaskStatus, { kind: 'idle' }> & { controller: AbortController });

export type UiMessage = string | (() => string);
export type TaskFeedback =
    | { kind: 'empty' }
    | { kind: 'progress'; message: UiMessage }
    | { kind: 'status'; message: UiMessage; level: 'info' | 'warn' | 'error' };
