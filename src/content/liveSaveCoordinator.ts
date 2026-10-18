import { getAccountContext } from './accountContext.js';
import { readConversationKey, type ConversationKey } from '../core/domain/conversationKey.js';
import type { ExportResult } from '../core/application/export/types.js';

interface Feedback {
    showLiveSaveWarning?: (message?: string, isZh?: boolean) => void;
    showLiveSaveFeedback?: (title?: string, isZh?: boolean) => void;
}
let badge: Feedback | undefined;
let instance: object | null = null;
export function init(options: { badge?: Feedback } = {}): void { badge = options.badge; instance = {}; }
export function cleanup(): void { instance = null; badge = undefined; }
/** Only a confirmed completion may request the worker's unified Export. */
export async function executeLiveSave(value: ConversationKey, reason = 'turn_complete'): Promise<ExportResult | null> {
    if (!instance || reason !== 'turn_complete') return null;
    const current = instance;
    const feedback = badge;
    const key = readConversationKey(value);
    const stillCurrent = () => getAccountContext()?.accountId === key.accountId;
    try {
        const response = await chrome.runtime.sendMessage({ action: 'runLiveSave', key });
        if (!response || response.ok !== true) throw new Error(response?.error || 'Live Save unavailable');
        const result: ExportResult | null = response.result;
        if (current === instance && feedback === badge && stillCurrent() && result) {
            if (result.failed.length || result.partial || result.aborted) feedback?.showLiveSaveWarning?.('Live Save incomplete');
            else if (result.exported) feedback?.showLiveSaveFeedback?.();
        }
        return result;
    } catch (error) {
        if (current === instance && feedback === badge && stillCurrent()) feedback?.showLiveSaveWarning?.(error instanceof Error ? error.message : String(error));
        throw error;
    }
}
export const LiveSaveCoordinator = { init, cleanup, executeLiveSave };
export default LiveSaveCoordinator;
