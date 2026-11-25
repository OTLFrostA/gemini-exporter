import { getSettings, updateSettings } from '../../application/settings/index.js';
import { renderDriveMarkdown } from '../../application/export/renderDriveMarkdown.js';
import { getAccount } from '../api/accountRegistry.js';
import { listIndexes } from '../../l3a/storageService.js';
import type { Account } from '../../l2/accountRegistry.js';
import { DEFAULT_ACCOUNT_KEY } from '../../l2/accountRegistry.js';
import { DRIVE_FILE_SCOPE, isDriveFileId, type DriveExportConnection } from '../../shared/types/driveExport.js';
import { isRecord } from '../../shared/utils/typeGuards.js';
import { createDriveDocumentClient, assertOwnedDocument, DriveHttpError, type DriveUser } from './driveDocumentClient.js';

const CONNECTION_LOCK = 'ge-drive-export-connection';
const RUN_LOCK = 'ge-drive-export-run';
export const DRIVE_EXPORT_STATUS_KEY = 'ge-drive-export-status';

interface Receipt { id: string; digest: string | null }
interface RunStatus {
    folderId: string;
    exported: number;
    unchanged: number;
    skipped: number;
    failed: number;
    finishedAt: number;
}

/** No OAuth client in the checked-in production manifest. Only configured development builds can activate this feature. */
export function isDriveExportConfigured(): boolean {
    if (typeof chrome.runtime?.getManifest !== 'function') return false;
    const config = chrome.runtime.getManifest().oauth2;
    return !!config?.client_id && config.scopes?.length === 1
        && config.scopes[0] === DRIVE_FILE_SCOPE && !!chrome.identity && !!chrome.alarms;
}

async function authorizedClient(interactive: boolean) {
    if (!isDriveExportConfigured()) throw new Error('Drive export OAuth client is not configured');
    const result = await chrome.identity.getAuthToken({ interactive, scopes: [DRIVE_FILE_SCOPE] });
    if (!result.token || (result.grantedScopes && !result.grantedScopes.includes(DRIVE_FILE_SCOPE))) {
        throw new Error('Drive file permission is required');
    }
    return { client: createDriveDocumentClient(result.token), token: result.token };
}

function sameConnection(a: DriveExportConnection | null | undefined, b: DriveExportConnection): boolean {
    return a?.folderId === b.folderId && a.destinationPermissionId === b.destinationPermissionId
        && a.sourceAccountId === b.sourceAccountId;
}

export async function connectDriveExport(sourceAccountId: string,
    confirm: (source: Account, destination: DriveUser) => boolean): Promise<boolean> {
    const account = await getAccount(sourceAccountId);
    if (!account || account.providerAccountId === DEFAULT_ACCOUNT_KEY) throw new Error('Choose an identified source account');
    const { client } = await authorizedClient(true);
    const destination = await client.about();
    if (!confirm(account, destination)) return false;
    return navigator.locks.request(CONNECTION_LOCK, async () => {
        if ((await getSettings()).driveExport) throw new Error('Disconnect the existing Drive export first');
        const folderId = await client.createFolder();
        await updateSettings({ driveExport: { sourceAccountId, destinationPermissionId: destination.permissionId,
            destinationEmail: destination.email, folderId } });
        return true;
    });
}

export function disconnectDriveExport(): Promise<void> {
    // Wait only for the current document write, not the entire reconciliation.
    // Existing generated documents are deliberately left in the user's Drive.
    return navigator.locks.request(CONNECTION_LOCK, () => updateSettings({ driveExport: null }));
}

async function sha256(value: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readReceipt(key: string): Promise<Receipt | null> {
    const data = await chrome.storage.local.get<{ [key: string]: unknown }>(key);
    const value = data[key];
    if (value === undefined) return null;
    if (!isRecord(value) || !isDriveFileId(value.id)
        || !(value.digest === null || (typeof value.digest === 'string' && /^[a-f0-9]{64}$/.test(value.digest)))) {
        throw new TypeError('Invalid Drive export receipt');
    }
    return { id: value.id, digest: value.digest };
}

function saveReceipt(key: string, receipt: Receipt): Promise<void> {
    return chrome.storage.local.set({ [key]: receipt });
}

export async function readDriveExportStatus(): Promise<RunStatus | null> {
    const data = await chrome.storage.local.get<{ [DRIVE_EXPORT_STATUS_KEY]?: unknown }>(DRIVE_EXPORT_STATUS_KEY);
    const value = data[DRIVE_EXPORT_STATUS_KEY];
    if (!isRecord(value) || !isDriveFileId(value.folderId)
        || typeof value.exported !== 'number' || typeof value.unchanged !== 'number'
        || typeof value.skipped !== 'number' || typeof value.failed !== 'number'
        || typeof value.finishedAt !== 'number') return null;
    return { folderId: value.folderId, exported: value.exported, unchanged: value.unchanged,
        skipped: value.skipped, failed: value.failed, finishedAt: value.finishedAt };
}

/** Periodic reconciliation against current committed local facts.
 * Stable preallocated IDs are persisted before upload; a worker restart can recover
 * a successful but unacknowledged creation without creating another file.
 * No reverse sync, no automatic remote deletion, no use of local ExportRecord.
 */
export async function runDriveDocumentExport(): Promise<RunStatus | null> {
    if (!isDriveExportConfigured()) return null;
    return navigator.locks.request(RUN_LOCK, { ifAvailable: true }, async lock => {
        if (!lock) return null;
        const settings = await getSettings();
        const connection = settings.driveExport;
        if (!connection) return null;
        const status: RunStatus = { folderId: connection.folderId, exported: 0, unchanged: 0,
            skipped: 0, failed: 0, finishedAt: 0 };
        let token: string | undefined;
        try {
            const account = await getAccount(connection.sourceAccountId);
            if (!account || account.providerAccountId === DEFAULT_ACCOUNT_KEY) throw new Error('Source account unavailable');
            const authorized = await authorizedClient(false);
            token = authorized.token;
            const { client } = authorized;
            const user = await client.about();
            if (user.permissionId !== connection.destinationPermissionId) throw new Error('Drive account changed');
            const indexes = await listIndexes(account.id);
            const locale = settings.language ?? 'en';
            for (const index of indexes) {
                try {
                    const outcome = await navigator.locks.request(CONNECTION_LOCK, async () => {
                        if (!sameConnection((await getSettings()).driveExport, connection)) return 'stopped';
                        const document = await renderDriveMarkdown(index.key, account, locale);
                        if (!document) return 'skipped';
                        const exportKey = await sha256(JSON.stringify([account.id, index.key.conversationId]));
                        const digest = await sha256(document.markdown);
                        const receiptKey = 'ge-drive-export:' + connection.folderId + ':' + exportKey;
                        let receipt = await readReceipt(receiptKey);
                        if (receipt?.digest === digest) return 'unchanged';
                        if (!receipt) {
                            receipt = { id: await client.generateId(), digest: null };
                            await saveReceipt(receiptKey, receipt);
                        }
                        const remote = await client.getDocument(receipt.id);
                        if (remote) {
                            assertOwnedDocument(remote, receipt.id, connection.folderId, exportKey);
                            if (remote.digest === digest) {
                                await saveReceipt(receiptKey, { id: receipt.id, digest });
                                return 'unchanged';
                            }
                        } else if (receipt.digest !== null) {
                            // User removed or revoked access to an existing generated document.
                            // Never silently recreate it or redirect the upload.
                            throw new Error('Previously exported Drive document unavailable');
                        }
                        await client.writeDocument({ id: receipt.id, folderId: connection.folderId,
                            exportKey, digest, document, create: remote === null });
                        await saveReceipt(receiptKey, { id: receipt.id, digest });
                        return 'exported';
                    });
                    if (outcome === 'stopped') return null;
                    if (outcome === 'skipped') status.skipped++;
                    else if (outcome === 'unchanged') status.unchanged++;
                    else status.exported++;
                } catch (error) {
                    if (error instanceof DriveHttpError && (error.status === 401 || error.status === 403
                        || error.status === 429 || error.status >= 500)) throw error;
                    status.failed++;
                }
            }
        } catch (error) {
            status.failed++;
            if (error instanceof DriveHttpError && error.status === 401 && token) {
                await chrome.identity.removeCachedAuthToken({ token }).catch(() => {});
            }
        }
        status.finishedAt = Date.now();
        await navigator.locks.request(CONNECTION_LOCK, async () => {
            if (sameConnection((await getSettings()).driveExport, connection)) {
                await chrome.storage.local.set({ [DRIVE_EXPORT_STATUS_KEY]: status });
            }
        });
        return status;
    });
}
