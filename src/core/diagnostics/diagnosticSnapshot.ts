import { parseLegacyConversationIndex } from '../parsers/legacyStorage/parseIndex.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../domain/conversationIndex.js';
import { getExtensionVersion, STORAGE_KEYS } from '../utils/constants.js';
import { normId } from '../utils/pathUtils.js';
import { isTakeoutConversation, resolveConversationExportState, type ExportActivityRecord } from '../utils/titleUtils.js';
import { FlightRecorder, type FlightEvent } from './flightRecorder.js';

export interface MaskedConversationMirror {
    id: string;
    maskedTitle: string;
    titleLength: number;
    titleSource?: string;
    createdAt?: number;
    updatedAt?: number;
    messageCount?: number;
    isTakeout: boolean;
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
        currentSlot: string;
        isDevMode: boolean;
    };
    storageOverview: {
        totalConversations: number;
        totalExportedRecords: number;
        accountSlots: string[];
        hasTakeoutData: boolean;
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
    if (st === 'partial' || rec.hasFailedAssets) {
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
    slot?: string | null;
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
    const { exportedAt, chatTime, messageCount, status, hasFailedAssets, isTruncated, truncated } = value;
    const timestamp = (v: unknown): v is string | number | undefined => v === undefined || typeof v === 'string' || typeof v === 'number' && Number.isFinite(v);
    if (!timestamp(exportedAt) || !timestamp(chatTime)
        || messageCount !== undefined && (typeof messageCount !== 'number' || !Number.isSafeInteger(messageCount) || messageCount < 0)
        || status !== undefined && typeof status !== 'string'
        || hasFailedAssets !== undefined && typeof hasFailedAssets !== 'boolean'
        || isTruncated !== undefined && typeof isTruncated !== 'boolean'
        || truncated !== undefined && typeof truncated !== 'boolean') return undefined;
    return { exportedAt, chatTime, messageCount, status, hasFailedAssets, isTruncated, truncated };
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
    const slot = options.slot || 'u0';
    let rawStorage: Record<string, unknown> = {};
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        try {
            rawStorage = await chrome.storage.local.get<Record<string, unknown>>(null);
        } catch {}
    }

    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
    const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;

    // Diagnostic recovery visibility: diagnostics may inspect unmigrated / corrupted raw storage to aid recovery from migration failures.
    const recoveryIssues: string[] = [];
    const rawIndexes: unknown = options.conversations ?? rawStorage[convKey] ?? (slot === 'u0' ? rawStorage.gemini_conversations_u0 : []) ?? [];
    const convs: DomainConversationIndex[] = [];
    if (!Array.isArray(rawIndexes)) recoveryIssues.push('Invalid index container');
    else for (const [position, row] of rawIndexes.entries()) {
        try {
            try { convs.push(restoreConversationIndex(row)); }
            catch { convs.push(parseLegacyConversationIndex(row)); recoveryIssues.push(`Historical index at position ${position}`); }
        } catch { recoveryIssues.push(`Rejected index at position ${position}`); }
    }
    const exportRecoveryIssues: string[] = [];
    const expMap = readExportActivities(options.exportedIds ?? rawStorage[expKey] ?? {}, exportRecoveryIssues);

    const rawSlots = rawStorage[STORAGE_KEYS.ACCOUNT_SLOTS];
    const slotsMap = object(rawSlots) ? rawSlots : {};
    const accountSlots = Object.keys(slotsMap).length > 0 ? Object.keys(slotsMap) : ['u0'];

    const stateMirror: MaskedConversationMirror[] = convs.map(c => {
        const nid = normId(c?.id);
        const rec = expMap.get(nid) ?? expMap.get(c.id) ?? null;
        const derived = resolveConversationExportState(c, rec);
        const { maskedTitle, titleLength } = maskTitle(c?.title);

        return {
            id: nid,
            maskedTitle,
            titleLength,
            titleSource: c?.titleSource,
            createdAt: c.createdAt,
            updatedAt: c?.updatedAt,
            messageCount: c.messageCount,
            isTakeout: isTakeoutConversation(c),
            exportRecord: rec ? {
                exportedAt: rec.exportedAt,
                chatTime: rec.chatTime,
                messageCount: rec.messageCount,
                status: rec.status,
                hasFailedAssets: rec.hasFailedAssets
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
            currentSlot: slot,
            isDevMode: !!rawStorage[STORAGE_KEYS.DEV_MODE]
        },
        storageOverview: {
            totalConversations: convs.length,
            totalExportedRecords: expMap.size,
            accountSlots,
            hasTakeoutData: !!rawStorage[STORAGE_KEYS.HAS_IMPORTED_TAKEOUT] || convs.some(c => isTakeoutConversation(c)),
            preferences: {
                format: stringOr(rawStorage[STORAGE_KEYS.FORMAT], 'md'),
                useZip: typeof rawStorage[STORAGE_KEYS.ZIP] !== 'undefined' ? !!rawStorage[STORAGE_KEYS.ZIP] : true,
                lang: stringOr(rawStorage[STORAGE_KEYS.LANG], 'zh'),
                suppressDirectWritePrompt: !!rawStorage[STORAGE_KEYS.SUPPRESS_DIRECT_WRITE_PROMPT],
                hasCompletedTour: !!rawStorage[STORAGE_KEYS.HAS_COMPLETED_TOUR],
                lastSeenFeatureVersion: stringOr(rawStorage[STORAGE_KEYS.LAST_SEEN_FEATURE_VERSION], '0.0.0')
            }
        },
        conversationsStateMirror: stateMirror,
        syncDiagnostics: rawStorage[STORAGE_KEYS.LAST_SYNC_DIAGNOSTICS] || null,
        lastExportSession: rawStorage[STORAGE_KEYS.LAST_EXPORT_SESSION] || null,
        flightRecorder: FlightRecorder.getEntries(),
        workbenchLogs: options.workbenchLogs
    };
}
