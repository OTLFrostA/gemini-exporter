import { getAccountContext } from './accountContext.js';
import { readConversationKey, type ConversationKey } from '../../l2/conversationKey.js';
import type { ExportResult } from '../../application/export/types.js';

interface Feedback {
    showLiveSaveResult?: (result: ExportResult | null, accountId: string) => void;
    showLiveSaveError?: (accountId: string) => void;
}
let badge: Feedback | undefined;
let instance: object | null = null;
export function init(options: { badge?: Feedback } = {}): void { badge = options.badge; instance = {}; }
export function cleanup(): void { instance = null; badge = undefined; }
/** Only an accepted passive Detail change may request the worker's unified Export. */
export async function executeLiveSave(value: ConversationKey): Promise<ExportResult | null> {
    if (!instance) return null;
    const current = instance;
    const feedback = badge;
    const key = readConversationKey(value);
    const stillCurrent = () => getAccountContext()?.accountId === key.accountId;
    // A late passive Detail result from an old account must not start a new active export.
    if (!stillCurrent()) return null;
    try {
        const response = await chrome.runtime.sendMessage({ action: 'runLiveSave', key });
        if (!response || response.ok !== true) throw new Error(response?.error || 'Live Save unavailable');
        const result: ExportResult | null = response.result;
        if (current === instance && feedback === badge && stillCurrent() && result) {
            feedback?.showLiveSaveResult?.(result, key.accountId);
        }
        return result;
    } catch (error) {
        if (current === instance && feedback === badge && stillCurrent()) feedback?.showLiveSaveError?.(key.accountId);
        throw error;
    }
}
export const LiveSaveCoordinator = { init, cleanup, executeLiveSave };
export default LiveSaveCoordinator;
