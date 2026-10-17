import type { ConversationKey } from '../../src/core/domain/conversationKey.js';
import type { DomainConversationIndex } from '../../src/core/domain/conversationIndex.js';
import type { TrustedDomainBody } from '../../src/core/domain/runtimeValidation.js';
import { restoreDomainDetail } from '../../src/core/domain/runtimeValidation.js';
import type { ExportRecord, ExportRequest } from '../../src/core/application/export/types.js';
import type { GlobalSettings } from '../../src/core/application/settings/index.js';
import type { AIProvider } from '../../src/core/provider/aiProvider.js';
import type { ExportArtifact } from '../../src/core/export/artifacts.js';
import type { SourceResourceContext } from '../../src/core/provider/sourceResources.js';

// Unit tests isolate IO at the public contract. The six-module integration suite
// separately exercises the production IndexedDB backend.
export function stubModule(path: string, exports: object): void {
    const filename = require.resolve(path);
    require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
}
export const account = { id: '10000000-0000-4000-8000-000000000001', providerId: 'gemini', providerAccountId: 'fixture' };
export const key = (conversationId = 'first'): ConversationKey => ({ accountId: account.id, conversationId });
export const address = (key: ConversationKey): string => JSON.stringify([key.accountId, key.conversationId]);
export const indexes = new Map<string, DomainConversationIndex>();
export const details = new Map<string, TrustedDomainBody>();
export const records = new Map<string, ExportRecord>();
export const events: string[] = [];
export const deliveries: ExportArtifact[][] = [];
export const contexts: SourceResourceContext[] = [];
export let settings: Partial<GlobalSettings> = {};
export const state = {
    failRead: false, failSettingsWrite: false, failRecord: '', failDelivery: 0, failDelete: '',
    directory: {} as FileSystemDirectoryHandle | null,
    onDelivery: undefined as (() => void) | undefined,
    sourceContext: undefined as SourceResourceContext | undefined,
    pdfPrepared: [] as string[], pdfBindings: {} as Readonly<Record<string, string>>, disposed: 0,
};
export const provider: AIProvider = {
    id: 'gemini', name: 'Fixture', hostPatterns: [],
    async checkReadiness() { return { ready: true }; }, matchesUrl() { return true; },
    async listConversations() { return 'source_end'; },
    async fetchConversationDetail() { events.push('refresh'); },
    async acquireResource(_key, asset) {
        events.push(`acquire:${asset.id}`);
        return { bytes: new Uint8Array([1, 2, 3]), mediaType: asset.mediaType };
    },
};
const defaultFetch = provider.fetchConversationDetail, defaultAcquire = provider.acquireResource, defaultList = provider.listConversations;
const storage = {
    async getIndex(key: ConversationKey) { if (state.failRead) throw new Error('read failed'); return indexes.get(address(key)) ?? null; },
    async getDetail(key: ConversationKey) { return details.get(address(key)) ?? null; },
    async getExportRecord(key: ConversationKey) { if (state.failRead) throw new Error('read failed'); return records.get(address(key)) ?? null; },
    async putExportRecord(key: ConversationKey, record: ExportRecord) {
        events.push(`record:${key.conversationId}`);
        if (state.failRecord === key.conversationId) throw new Error('record failed');
        records.set(address(key), record);
    },
    async listExportRecords(accountId: string) {
        return Object.fromEntries([...records].filter(([id]) => JSON.parse(id)[0] === accountId).map(([id, record]) => [JSON.parse(id)[1], record]));
    },
    async deleteExportRecord(key: ConversationKey) {
        events.push(`delete-record:${key.conversationId}`);
        if (state.failDelete === 'record') throw new Error('delete failed');
        records.delete(address(key));
    },
    async deleteDetail(key: ConversationKey) {
        events.push(`delete-detail:${key.conversationId}`);
        if (state.failDelete === 'detail') throw new Error('delete failed');
        details.delete(address(key));
    },
    async deleteIndex(key: ConversationKey) { events.push(`delete-index:${key.conversationId}`); indexes.delete(address(key)); },
    async clearStoredAccountData(accountId: string) { events.push(`clear-account:${accountId}`); },
    async getDirectoryHandle() { return state.directory; },
    async getStoredSettings() { if (state.failRead) throw new Error('read failed'); return structuredClone(settings); },
    async patchStoredSettings(patch: Partial<GlobalSettings>) {
        if (state.failSettingsWrite) throw new Error('write failed');
        events.push('settings-write'); settings = { ...settings, ...patch };
    },
};
stubModule('../../src/core/storage/storageService.js', storage);
stubModule('../../src/core/api/accountRegistry.js', { async getAccount(id: string) { return { ...account, id }; } });
stubModule('../../src/core/provider/providerRegistry.js', { ProviderRegistry: { get() { return provider; } } });
stubModule('../../src/core/provider/taskProvider.js', {
    createTaskProvider(_providerId: string, resources: SourceResourceContext): AIProvider {
        contexts.push(resources);
        state.sourceContext = resources;
        return provider;
    },
});
async function deliver(files: readonly ExportArtifact[]) {
    events.push('delivery'); deliveries.push([...files]);
    if (state.failDelivery === deliveries.length) throw new Error('delivery failed');
    state.onDelivery?.();
}
stubModule('../../src/core/export/delivery/index.js', { startBrowserDownload: (file: ExportArtifact) => deliver([file]), writeToFolder: deliver });
stubModule('../../src/core/export/pdf/compileDocumentPdf.js', { async compileDocumentPdf(_doc: unknown, bindings: Readonly<Record<string, string>>, prepared: ReadonlyMap<string, unknown>) {
    state.pdfPrepared = [...prepared.keys()]; state.pdfBindings = bindings;
    return { pdfBytes: new Uint8Array([37, 80, 68, 70]), diagnostics: [] };
} });
stubModule('../../src/core/export/typst/typstSandboxCompiler.js', { TypstSandboxCompiler: class { dispose() { state.disposed++; } } });
stubModule('../../src/core/export/typst/fonts/localFontProvider.js', { async resolveLocalFonts() { return {}; } });
stubModule('../../src/core/export/typst/fonts/mountRuntimeFonts.js', { async mountRuntimeFonts() { return { effectiveFonts: { diagnostics: [] } }; } });
const { __setModuleOverride } = require('../../src/core/utils/moduleOverrides.js');
__setModuleOverride('JSZip', require('../../lib/jszip.min.js'));

export function seed(id = 'first', options: { updatedAt?: number; savedAt?: number; quality?: 'complete' | 'partial' | 'unknown'; assets?: boolean } = {}) {
    const conversationKey = key(id);
    const index: DomainConversationIndex = { key: conversationKey, title: `Title ${id}`, titleSource: 'provider', updatedAt: options.updatedAt ?? 100 };
    const detail = restoreDomainDetail({ key: conversationKey, savedAt: options.savedAt ?? 100,
        quality: { status: options.quality ?? 'complete' },
        messages: [{ role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: `Body ${id}` }] },
            ...(options.assets ? [{ type: 'image', assetId: 'image' }, { type: 'file', assetId: 'file' }] : [])] }],
        assets: options.assets ? [{ id: 'image', kind: 'image', mediaType: 'image/png' }, { id: 'file', kind: 'file' }, { id: 'unused', kind: 'file' }] : [] });
    indexes.set(address(conversationKey), index); details.set(address(conversationKey), detail);
    return { index, detail };
}
export function request(patch: Partial<ExportRequest> = {}): ExportRequest {
    return { keys: [key()], format: 'markdown', delivery: 'browserDownload', useZip: false, includeAssets: true, skipUnchanged: false, ...patch };
}
export function reset(): void {
    indexes.clear(); details.clear(); records.clear(); events.length = 0; deliveries.length = 0; contexts.length = 0; settings = {};
    Object.assign(state, { failRead: false, failSettingsWrite: false, failRecord: '', failDelivery: 0, failDelete: '', directory: {},
        onDelivery: undefined, sourceContext: undefined, pdfPrepared: [], pdfBindings: {}, disposed: 0 });
    Object.assign(provider, { fetchConversationDetail: defaultFetch, acquireResource: defaultAcquire, listConversations: defaultList });
}
