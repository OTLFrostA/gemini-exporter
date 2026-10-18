import { getSettings } from '../application/settings/index.js';
import { listIndexes, listExportRecords } from '../storage/storageService.js';
import { listAccounts } from '../api/accountRegistry.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../domain/conversationIndex.js';
import { getExtensionVersion } from '../utils/constants.js';
const normId = (id: string): string => id;
import { resolveConversationExportState, type ExportActivityRecord } from '../utils/titleUtils.js';
import { FlightRecorder, type FlightEvent } from './flightRecorder.js';

export interface MaskedConversationMirror {
    id: string;
    maskedTitle: string;
    titleLength: number;
    titleSource?: string;
    createdAt?: number;
    updatedAt?: number;
    messageCount?: number;
    exportRecord: {
        exportedAt?: string | number;
        chatTime?: string | number;
        messageCount?: number;
        status?: string;
        hasFailedAssets?: boolean;
    } | null;
    derivedState: {
        state: string;
        hasNewerActivity: boolean;
        needsIncrementalExport: boolean;
        isFailed: boolean;
        isUnexported: boolean;
        isExportedClean: boolean;
        badgeKind: string;
        explanation: string;
    };
}

export interface DiagnosticSnapshot {
    diagnosticVersion: string;
    generatedAt: string;
    environment: {
        extensionVersion: string;
        userAgent?: string;
        platform?: string;
        accountId: string;
        isDevMode: boolean;
    };
    storageOverview: {
        totalConversations: number;
        totalExportedRecords: number;
        accountIds: string[];
        hasTakeoutData?: boolean;
        preferences: {
            format?: string;
            useZip?: boolean;
            lang?: string;
            suppressDirectWritePrompt?: boolean;
            hasCompletedTour?: boolean;
            lastSeenFeatureVersion?: string;
        };
    };
    conversationsStateMirror: MaskedConversationMirror[];
    indexRecoveryIssues: string[];
    exportRecoveryIssues: string[];
    syncDiagnostics: unknown;
    lastExportSession: unknown;
    flightRecorder: FlightEvent[];
    workbenchLogs?: readonly unknown[];
}

export function maskTitle(title?: string | null): { maskedTitle: string; titleLength: number } {
    if (!title || typeof title !== 'string') {
        return { maskedTitle: '[empty]', titleLength: 0 };
    }
    const len = title.length;
    if (len <= 3) {
        return { maskedTitle: '***', titleLength: len };
    }
    const prefix = title.slice(0, 2);
    const suffix = len > 5 ? title.slice(-2) : title.slice(-1);
    return {
        maskedTitle: `${prefix}***${suffix} [len:${len}]`,
        titleLength: len
    };
}

export function explainStateDerivation(c: Readonly<Partial<DomainConversationIndex>>, rec?: ExportActivityRecord | null): string {
    if (!rec) {
        return 'No export record in storage (unexported)';
    }
    const st = rec.status;
    if (st === 'pending_assets') {
        return 'Export record has status=pending_assets';
    }
    if (st === 'partial') {
        return 'Export record marked partial / failed assets; requires incremental retry';
    }
    const derived = resolveConversationExportState(c, rec);
    if (derived.hasNewerActivity) {
        return 'Source update version advanced past the saved export version, or observed message count increased';
    }
    if (derived.needsIncrementalExport) return 'Source version is unknown; refresh is required before incremental skipping';
    return 'Export record is clean and up to date with conversation activity';
}

export interface BuildSnapshotOptions {
    accountId?: string | null;
    conversations?: readonly Readonly<DomainConversationIndex>[];
    exportedIds?: unknown;
    workbenchLogs?: readonly unknown[];
}

function stringOr(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Raw recovery data is interpreted once, before calling typed state consumers. */
function readExportActivity(value: unknown): ExportActivityRecord | undefined {
    if (!object(value)) return undefined;
    const { exportedAt, chatTime, status, format } = value;
    const timestamp = (v: unknown): v is number | undefined => v === undefined || typeof v === 'number' && Number.isFinite(v);
    if (Object.keys(value).some(key => !['exportedAt', 'chatTime', 'status', 'format'].includes(key))
        || typeof exportedAt !== 'number' || !timestamp(exportedAt) || !timestamp(chatTime)
        || status !== 'ok' && status !== 'partial'
        || format !== 'markdown' && format !== 'html' && format !== 'pdf' && format !== 'json') return undefined;
    return { exportedAt, chatTime, status, format };
}

function readExportActivities(value: unknown, issues: string[]): ReadonlyMap<string, ExportActivityRecord> {
    const records = new Map<string, ExportActivityRecord>();
    if (!object(value)) { issues.push('Invalid export record container'); return records; }
    for (const [id, raw] of Object.entries(value)) {
        const record = readExportActivity(raw);
        if (record) records.set(id, record);
        else issues.push(`Rejected export record: ${id}`);
    }
    return records;
}

export async function buildDiagnosticSnapshot(options: BuildSnapshotOptions = {}): Promise<DiagnosticSnapshot> {
    const slot = options.accountId || '';
    const settings = await getSettings();
    const recoveryIssues: string[] = [];
    const rawIndexes: unknown = options.conversations ?? (slot ? await listIndexes(slot) : []);
    const convs: DomainConversationIndex[] = [];
    if (!Array.isArray(rawIndexes)) recoveryIssues.push('Invalid index container');
    else for (const [position, row] of rawIndexes.entries()) {
        try {
            convs.push(restoreConversationIndex(row));
        } catch { recoveryIssues.push(`Rejected index at position ${position}`); }
    }
    const exportRecoveryIssues: string[] = [];
    const expMap = readExportActivities(options.exportedIds ?? (slot ? await listExportRecords(slot) : {}), exportRecoveryIssues);

    const accountIds = (await listAccounts()).map(account => account.id);

    const stateMirror: MaskedConversationMirror[] = convs.map(c => {
        const nid = normId(c?.key.conversationId);
        const rec = expMap.get(nid) ?? expMap.get(c.key.conversationId) ?? null;
        const derived = resolveConversationExportState(c, rec);
        const { maskedTitle, titleLength } = maskTitle(c?.title);

        return {
            id: nid,
            maskedTitle,
            titleLength,
            titleSource: c?.titleSource,
            createdAt: c.createdAt,
            updatedAt: c?.updatedAt,
            messageCount: undefined,
            exportRecord: rec ? {
                exportedAt: rec.exportedAt,
                chatTime: rec.chatTime,
                status: rec.status,
            } : null,
            derivedState: {
                state: derived.state,
                hasNewerActivity: derived.hasNewerActivity,
                needsIncrementalExport: derived.needsIncrementalExport,
                isFailed: derived.isFailed,
                isUnexported: derived.isUnexported,
                isExportedClean: derived.isExportedClean,
                badgeKind: derived.badge.kind,
                explanation: explainStateDerivation(c, rec)
            }
        };
    });

    return {
        diagnosticVersion: '3.0.0',
        indexRecoveryIssues: recoveryIssues,
        exportRecoveryIssues,
        generatedAt: new Date().toISOString(),
        environment: {
            extensionVersion: getExtensionVersion(),
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
            platform: typeof navigator !== 'undefined' ? ('userAgentData' in navigator && object(navigator.userAgentData) && typeof navigator.userAgentData.platform === 'string' ? navigator.userAgentData.platform : navigator.platform) : undefined,
            accountId: slot,
            isDevMode: settings.developerMode
        },
        storageOverview: {
            totalConversations: convs.length,
            totalExportedRecords: expMap.size,
            accountIds,
            preferences: {
                format: settings.defaultFormat,
                useZip: settings.useZip,
                lang: settings.language,
                suppressDirectWritePrompt: !!settings.directWritePromptShown,
                hasCompletedTour: !!settings.tourAutoHandled,
                lastSeenFeatureVersion: settings.lastSeenFeatureVersion
            }
        },
        conversationsStateMirror: stateMirror,
        syncDiagnostics: null,
        lastExportSession: null,
        flightRecorder: FlightRecorder.getEntries(),
        workbenchLogs: options.workbenchLogs
    };
}
