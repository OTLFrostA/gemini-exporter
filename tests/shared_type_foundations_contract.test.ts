import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, MessageCitation, MessageDocument } from '../src/types/conversation.js';
import type { LiveConversationRecord } from '../src/types/liveSave.js';
import type { I18nModule, TabServiceModule, TabStatusResult } from '../src/types/utils.js';
import type {
    AccountSlots, DirectoryHandle, DirHandleControllerContract, ExportControllerContract,
    ExportProgress, ExportRecord, FailedChat, IConversationsStore, IDialogView, IListView,
    OptionsExportOptions, OptionsSyncOptions, OptionsTakeoutOptions, OptionsSettingsOptions,
    ReconcileOptions, ScanCallbacks, ScanResponse, TakeoutImportResult, TourGuideContract,
    TourStep, UIExportCallbacks, UIExportOptions, UIExportResult
} from '../src/types/ui.js';
import type { ConversationExportState } from '../src/core/utils/titleUtils.js';
import type { ParserMessage, ParserDocument } from '../src/core/api/client/detailTypes.js';
import type { Citation } from '../src/core/parsers/gemini/rpc/extractors.js';
import type { PdfExportResult } from '../src/core/export/pdf/pdfExporter.js';
import { getAccountSlots } from '../src/ui/state/conversationsStore.js';
import { renderExportBanner, getLastFailedChats } from '../src/ui/views/dialogView.js';
import { getActiveEngine, runExport } from '../src/ui/controllers/exportController.js';
import { loadStore } from '../src/ui/options/modules/optionsInit.js';
import { STEPS } from '../src/ui/tour/tourSteps.js';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
// Check leaf contracts and awaited results, so an outer array/Promise cannot hide widening.
type Contracts = [
    Assert<Equal<ChatMessage['citations'], MessageCitation[] | undefined>>,
    Assert<Equal<ChatMessage['documents'], MessageDocument[] | undefined>>,
    Assert<Equal<LiveConversationRecord['messages'], ChatMessage[]>>,
    Assert<Equal<ReturnType<IConversationsStore['getAccountSlots']>, AccountSlots>>,
    Assert<Equal<ReturnType<typeof getAccountSlots>, AccountSlots>>,
    Assert<Equal<AccountSlots[string]['count'], number | undefined>>,
    Assert<Equal<Parameters<IConversationsStore['reconcileWithCloud']>[1], ReconcileOptions | undefined>>,
    Assert<Equal<ReturnType<NonNullable<IListView['resolveConversationExportState']>>, ConversationExportState>>,
    Assert<Equal<ReturnType<IDialogView['getLastFailedChats']>, FailedChat[]>>,
    Assert<Equal<ReturnType<typeof getLastFailedChats>, FailedChat[]>>,
    Assert<Equal<Awaited<ReturnType<DirHandleControllerContract['requestDirHandle']>>, DirectoryHandle>>,
    Assert<Equal<Awaited<ReturnType<DirHandleControllerContract['restoreSavedDirHandle']>>, DirectoryHandle | null>>,
    Assert<Equal<Parameters<DirHandleControllerContract['setDirHandle']>[0], DirectoryHandle | null>>,
    Assert<Equal<Parameters<NonNullable<ScanCallbacks['onFinished']>>[0]['res'], ScanResponse>>,
    Assert<Equal<TakeoutImportResult['conversations'][number]['title'], string>>,
    Assert<Equal<Parameters<ExportControllerContract['runExport']>, [UIExportOptions, UIExportCallbacks]>>,
    Assert<Equal<Awaited<ReturnType<typeof runExport>>, UIExportResult>>,
    Assert<Equal<ReturnType<typeof getActiveEngine>, ReturnType<ExportControllerContract['getActiveEngine']>>>,
    Assert<Equal<Parameters<NonNullable<UIExportCallbacks['onProgress']>>[0], ExportProgress>>,
    Assert<Equal<Parameters<NonNullable<UIExportCallbacks['onItemExported']>>[1], ExportRecord>>,
    Assert<Equal<TourGuideContract['STEPS'], TourStep[]>>,
    Assert<Equal<typeof STEPS, TourStep[]>>,
    Assert<Equal<Awaited<ReturnType<NonNullable<OptionsExportOptions['loadStore']>>>, void>>,
    Assert<Equal<Awaited<ReturnType<NonNullable<OptionsSyncOptions['loadStore']>>>, void>>,
    Assert<Equal<Awaited<ReturnType<NonNullable<OptionsTakeoutOptions['loadStore']>>>, void>>,
    Assert<Equal<Awaited<ReturnType<NonNullable<OptionsSettingsOptions['loadStore']>>>, void>>,
    Assert<Equal<Awaited<ReturnType<typeof loadStore>>, void>>,
    Assert<Equal<Parameters<TabServiceModule['sendToGeminiTab']>[0], unknown>>,
    Assert<Equal<Awaited<ReturnType<TabServiceModule['sendToGeminiTab']>>, unknown>>,
    Assert<Equal<TabStatusResult['response'], unknown>>,
    Assert<Equal<Parameters<I18nModule['t']>, [string, ...unknown[]]>>,
    Assert<ParserMessage extends ChatMessage ? true : false>,
    Assert<ParserDocument extends MessageDocument ? true : false>,
    Assert<Citation extends MessageCitation ? true : false>,
    Assert<PdfExportResult extends UIExportResult ? true : false>,
    // Negative relationships catch replacement by any/unknown/overly broad unions.
    Assert<Equal<number extends MessageCitation['url'] ? true : false, false>>,
    Assert<Equal<number[] extends MessageDocument['sections'] ? true : false, false>>,
    Assert<Equal<string extends ChatMessage['role'] ? true : false, false>>,
    Assert<Equal<((msg: { action: string }) => Promise<unknown>) extends TabServiceModule['sendToGeminiTab'] ? true : false, false>>
];
const contracts: Contracts = [
    true, true, true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true, true, true,
    true, true, true, true, true, true, true, true, true
];

// Both parser reports and locally synthesized Takeout/export reports cross this shared seam.
const reportMessage: ChatMessage = {
    role: 'model', content: 'Report', citations: [{ url: 'https://example.com', title: 'Source' }],
    documents: [{ type: 'file', id: 'report', name: 'report.md', localName: 'files/report.md',
        title: 'Report', contentMarkdown: '# Report', source: 'takeout-report' }]
};
const live: LiveConversationRecord = {
    id: 'conversation', title: 'Report', messages: [reportMessage],
    timestamp: 1700000000000, savedAt: 1700000000000, turnCount: 1
};
const slots: AccountSlots = { u0: { slot: 'u0', email: 'test@example.com', count: 1, lastSync: '2026-10-02' } };
const callbacks: UIExportCallbacks = {
    onProgress(progress) { const pct: number = progress.pct; void pct; },
    onItemExported(_id, record) { const time: string | number = record.exportedAt; void time; }
};
// Compiles without casts, mocks, any, or suppression: nullable clearing is part of the contract.
function clearDirectory(controller: DirHandleControllerContract): void { controller.setDirHandle(null); }
void clearDirectory;
void callbacks;

test('shared type foundations keep internal shapes and opaque transport boundaries', () => {
    assert.ok(contracts.every(Boolean));
    assert.equal(live.messages[0].documents?.[0].contentMarkdown, '# Report');
    assert.equal(slots.u0.count, 1);
});


test('completed session banner preserves missing/zero and positive failed-count behavior', () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const banner = { style: { display: '', borderColor: '', background: '' } };
    const bannerText = { innerHTML: '' };
    const resume = { style: { display: '' } };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
        getElementById(id: string) {
            if (id === 'exportSessionBanner') return banner;
            if (id === 'exportSessionText') return bannerText;
            if (id === 'btnResumeExport') return resume;
            return null;
        }
    } });
    try {
        for (const failedCount of [undefined, 0, 2]) {
            renderExportBanner({ status: 'completed', total: 3, current: 3,
                updatedAt: Date.now(), failedCount }, 'u0', false);
            assert.equal(banner.style.borderColor, failedCount === 2 ? '#f59e0b' : '#10b981');
            assert.equal(banner.style.background, failedCount === 2 ? '#221c12' : '#0e231b');
            assert.equal(resume.style.display, 'none');
        }
    } finally {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
