import { isDriveExportConfigured, runDriveDocumentExport } from '../capabilities/googleDriveExport.js';
import { startKeepAlive } from './keepAlive.js';
import { ensureV2Ready } from './readiness.js';

const ALARM = 'ge-drive-document-export';

export function initDriveExportBackground(): void {
    if (!isDriveExportConfigured()) return;
    chrome.alarms.onAlarm.addListener(alarm => {
        if (alarm.name !== ALARM) return;
        const stop = startKeepAlive();
        void ensureV2Ready().then(runDriveDocumentExport).catch(() => {
            console.warn('[Drive Export] Reconciliation unavailable');
        }).finally(stop);
    });
    // Recreate on worker startup: Chrome alarms are not guaranteed across restart.
    void Promise.resolve(chrome.alarms.get(ALARM)).then(async existing => {
        if (!existing) await chrome.alarms.create(ALARM, { periodInMinutes: 5 });
    }).catch(() => { console.warn('[Drive Export] Could not schedule reconciliation'); });
}
