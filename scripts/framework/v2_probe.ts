import { readConversationKey, type ConversationKey } from '../../src/core/domain/conversationKey.js';
import { clearLocalScanRecords } from '../../src/core/application/localCleanup.js';
/** Test-only access to public v2 owners. Bundled by the Python harness, never shipped. */
import { getSettings, updateSettings } from '../../src/core/application/settings/index.js';
import * as storage from '../../src/core/storage/storageService.js';
import { ensureV2Ready } from '../../src/core/api/runtimeReady.js';
import { parseGeminiTakeoutZipArchive, readTakeoutBytes } from '../../src/core/imports/takeout/readArchive.js';
import { readConversation } from '../../src/core/domain/readConversation.js';

export function accountId(): string {
    const id = (document.getElementById('accountIdSelect') as HTMLSelectElement | null)?.value;
    if (!id) throw new Error('No Registry account selected');
    return id;
}
export async function snapshot() {
    await ensureV2Ready();
    const id = accountId();
    const [account, rows, coverage, records] = await Promise.all([
        storage.getAccount(id), storage.listIndexes(id), storage.getCoverage(id, 'recent'), storage.listExportRecords(id),
    ]);
    if (!account || account.providerId !== 'gemini') throw new Error('Selected account is not Gemini');
    return { accountId: id, account, rows, coverage, exportIds: Object.keys(records).sort(), records };
}
export async function storedConversation(input: ConversationKey) {
    await ensureV2Ready();
    const key = readConversationKey(input);
    const [index, detail, exportRecord] = await Promise.all([
        storage.getIndex(key), storage.getDetail(key), storage.getExportRecord(key),
    ]);
    return { index, detail, exportRecord };
}
export async function conversations(ids: string[]) {
    const state = await snapshot();
    return Promise.all(ids.map(async id => {
        const domain = await readConversation({ accountId: state.accountId, conversationId: id });
        return { id, ok: domain !== null, account: state.account, domain,
            summary: state.rows.find(row => row.key.conversationId === id) };
    }));
}
/** Scan reset clears both trusted Coverage and export records (frozen L3a contract). */
export async function clearScanRecords() {
    await ensureV2Ready();
    await clearLocalScanRecords(accountId());
}
export async function inspectTakeout(encoded: string, mediaPaths: string[]) {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const account = await storage.getAccount(accountId());
    if (!account) throw new Error('Takeout account missing');
    const archive = await (globalThis as unknown as {JSZip:{loadAsync(bytes:Uint8Array):Promise<{files:Record<string,{async(kind:string):Promise<Uint8Array>}>}>}}).JSZip.loadAsync(bytes);
    const parsed = await parseGeminiTakeoutZipArchive(bytes, {account, providerId:'gemini', readArchive:async () => archive});
    const resources: Record<string, {assetId:string;sourcePath:string;bytes:string}[]> = {};
    for (const result of parsed) {
        resources[result.conversationId] = [];
        for (const [assetId, bound] of Object.entries(result.archiveResources)) {
            const data = await readTakeoutBytes(bound.entry);
            if (!data?.byteLength) throw new Error('Takeout source entry empty');
            let binary = ''; for (const byte of data) binary += String.fromCharCode(byte);
            resources[result.conversationId].push({assetId,sourcePath:bound.path,bytes:btoa(binary)});
        }
    }
    const mediaDigests: Record<string,string> = {};
    for (const path of mediaPaths) {
        const entry = archive.files[path];
        if (!entry) throw new Error('Missing archive media: ' + path);
        const data = await entry.async('uint8array');
        if (!data.byteLength) throw new Error('Empty archive media: ' + path);
        mediaDigests[path] = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>))]
            .map(byte => byte.toString(16).padStart(2,'0')).join('');
    }
    return {ids:parsed.map(result => result.conversationId), sourceFacts:Object.fromEntries(parsed.map(result => [result.conversationId, result.conversation])), resources, mediaDigests};
}
Object.assign(globalThis, { __tier2V2: { accountId, snapshot, conversations, storedConversation, clearScanRecords, inspectTakeout,
    getAccount: storage.getAccount, listAccounts: storage.listAccounts,
    getSettings, updateSettings,
    setDirectoryHandle: storage.setDirectoryHandle } });
