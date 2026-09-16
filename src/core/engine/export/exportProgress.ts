// src/core/engine/export/exportProgress.ts - Single canonical export-progress formula.
// P1-023: the weighted chat/asset blend was implemented twice (inline in the
// orchestrator's updateProgress AND as progressReporter.calculateProgress) and
// the blend could visibly REGRESS (e.g. 9/10 chats = 90%, then assets 5/50
// pulled the blend down to 70%). This module is the one place the formula
// lives now; it additionally enforces a monotonic envelope so the reported
// percentage never moves backwards within a run.

export const CHAT_PROGRESS_WEIGHT = 0.75;
export const ASSET_PROGRESS_WEIGHT = 0.25;

export interface ExportProgressInput {
    current: number;
    total: number;
    downloadedAssets?: number;
    totalAssets?: number;
    /** Last emitted pct for this run; the result never goes below it. */
    prevPct?: number;
}

/**
 * Compute the export progress percentage (0-100).
 * Pure function: no DOM, no side effects, trivially unit-testable.
 */
export function calculateExportProgress(input: ExportProgressInput): number {
    const {
        current,
        total,
        downloadedAssets = 0,
        totalAssets = 0,
        prevPct = 0
    } = input;
    const safeTotal = Number(total) || 0;
    const safeCurrent = Math.min(Math.max(Number(current) || 0, 0), safeTotal);
    let pct = safeTotal ? Math.floor((safeCurrent / safeTotal) * 100) : 0;

    if (totalAssets > 0 && downloadedAssets > 0 && pct < 100) {
        const chatFraction = safeTotal ? (safeCurrent / safeTotal) : 0;
        const assetFraction = Math.min(1, downloadedAssets / totalAssets);
        pct = Math.min(
            99,
            Math.floor((chatFraction * CHAT_PROGRESS_WEIGHT + assetFraction * ASSET_PROGRESS_WEIGHT) * 100)
        );
    }

    // P1-023: never regress — clamp to the previously emitted value.
    const prev = Math.min(100, Math.max(0, Number(prevPct) || 0));
    return Math.max(pct, prev);
}

export default { calculateExportProgress, CHAT_PROGRESS_WEIGHT, ASSET_PROGRESS_WEIGHT };
