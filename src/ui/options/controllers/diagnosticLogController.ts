import type { Diagnostic } from '../../../shared/diagnostics/diagnostic.js';
import type { ScanResult } from '../../../application/sync/scanController.js';
import type { GlobalSettings } from '../../../application/settings/index.js';
import { fetchRuntimeDiagnosticSnapshot } from '../../../runtime/api/runtimeDiagnostics.js';
import type { ConversationViewState } from '../state/conversationsStore.js';
import type { ExportRunDiagnostic } from './exportSession.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

export type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
    at: number;
    level: LogLevel;
    message: string;
    takeoutCount?: number;
}

export interface ScanRunDiagnostic {
    startedAt: number;
    finishedAt: number;
    accountId: string | null;
    forceFull: boolean;
    result: ScanResult;
    diagnostics: Diagnostic[];
}

export function createDiagnosticLogController(deps: {
    readonly state: ConversationViewState;
    readonly getSettings?: () => GlobalSettings | undefined;
    readonly onShowTakeout: (count: number) => void;
    readonly onError: (error: unknown) => void;
}) {
    const log: LogEntry[] = [];
    const exportRuns: ExportRunDiagnostic[] = [];
    let droppedExportRuns = 0;
    const scanRuns: ScanRunDiagnostic[] = [];

    const renderLog = (): void => {
        const level = control('select', 'logLevel').value;
        const query = control('input', 'logFilter').value.trim().toLowerCase();
        const rows = log.filter(entry => {
            if (level === 'error' && entry.level !== 'error') return false;
            if (level === 'warn' && entry.level === 'info') return false;
            const matched = (entry.message + ' ' + entry.level).toLowerCase();
            return query.startsWith('-') ? !matched.includes(query.slice(1)) : matched.includes(query);
        });
        el('log').replaceChildren();
        for (const entry of rows) {
            el('log').append(document.createTextNode(`[${new Date(entry.at).toLocaleTimeString()}] [${entry.level}] `));
            if (entry.takeoutCount !== undefined && entry.message.includes('Takeout')) {
                const count = entry.takeoutCount;
                const link = document.createElement('a');
                link.href = '#takeout';
                link.textContent = 'Takeout';
                link.addEventListener('click', event => { event.preventDefault(); deps.onShowTakeout(count); });
                const split = entry.message.indexOf('Takeout');
                el('log').append(entry.message.slice(0, split), link, entry.message.slice(split + 7));
            } else {
                el('log').append(document.createTextNode(entry.message));
            }
            el('log').append('\n');
        }
        if (!rows.length) el('log').textContent = text('Ready', '就绪');
        el('log').scrollTop = el('log').scrollHeight;
    };

    const appendLog = (entry: LogEntry): void => {
        log.push(entry);
        if (log.length > 400) log.shift();
        renderLog();
    };

    const recordExportRun = (run: ExportRunDiagnostic): void => {
        exportRuns.push(run);
        if (exportRuns.length > 10) {
            exportRuns.shift();
            droppedExportRuns++;
        }
    };

    const recordScanRun = (run: ScanRunDiagnostic): void => {
        scanRuns.push(run);
        if (scanRuns.length > 10) scanRuns.shift();
    };

    const bindControls = (): void => {
        el('logFilter').addEventListener('input', renderLog);
        el('logLevel').addEventListener('change', renderLog);
        el('btnCopyLog').addEventListener('click', () => {
            void navigator.clipboard.writeText(el('log').textContent ?? '').catch(deps.onError);
        });
        el('btnClearLog').addEventListener('click', () => { log.length = 0; renderLog(); });
        el('btnExportDiag').addEventListener('click', () => {
            void (async () => {
                let grantedPermissions: chrome.permissions.Permissions | null = null;
                try { grantedPermissions = await chrome.permissions.getAll(); } catch { /* Diagnostic export still works without permission inspection. */ }
                const runtimeEvents = await fetchRuntimeDiagnosticSnapshot();
                const records = Object.values(deps.state.records);
                const partialCount = records.filter(record => record.status === 'partial').length;
                const okCount = records.filter(record => record.status === 'ok').length;
                const currentExportIssues = deps.state.indexes.flatMap(index => {
                    const record = deps.state.records[index.key.conversationId];
                    return record?.status === 'partial' ? [{
                        key: index.key,
                        title: index.title,
                        record,
                        reasonAvailability: 'Stored outcome only; exact causes require a captured export run',
                    }] : [];
                });
                const payload = JSON.stringify({
                    schemaVersion: 3,
                    diagnosticRevision: 3,
                    generatedAt: Date.now(),
                    environment: { online: navigator.onLine, grantedPermissions },
                    extensionVersion: chrome.runtime.getManifest().version,
                    userAgent: navigator.userAgent,
                    settings: deps.getSettings?.() ?? null,
                    accountId: deps.state.accountId,
                    accountSummary: {
                        totalAccounts: deps.state.accounts.length,
                        accounts: deps.state.accounts.map(account => ({
                            id: account.id,
                            providerId: account.providerId,
                            providerAccountId: account.providerAccountId,
                            displayName: account.displayName ?? null,
                        })),
                        activeAccountStats: {
                            totalIndexes: deps.state.indexes.length,
                            totalRecords: records.length,
                            okCount,
                            partialCount,
                        },
                    },
                    runtimeEvents,
                    scanRuns,
                    exportRuns,
                    droppedExportRuns,
                    currentExportIssues,
                    logs: log,
                }, null, 2);
                const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = 'gemini-exporter-ui-diagnostics.json';
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            })().catch(deps.onError);
        });
    };

    return {
        renderLog,
        appendLog,
        recordExportRun,
        recordScanRun,
        bindControls,
    };
}
