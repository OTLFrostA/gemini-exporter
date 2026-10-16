import type { Account } from '../src/core/domain/accountRegistry.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, MessageCitation, MessageDocument } from '../src/types/conversation.js';
import type { LiveConversationRecord } from '../src/types/liveSave.js';
import type { I18nModule, TabServiceModule, TabStatusResult } from '../src/types/utils.js';
import type {
    DirectoryHandle, DirHandleControllerContract, ExportControllerContract,
    ExportProgress, ExportRecord, FailedChat, IConversationsStore, IDialogView, IListView,
    OptionsExportOptions, OptionsSyncOptions, OptionsTakeoutOptions, OptionsSettingsOptions,
    ReconcileOptions, ScanCallbacks, ScanResponse, TakeoutImportResult, TourGuideContract,
    TourStep, UIExportCallbacks, UIExportOptions, UIExportResult
} from '../src/types/ui.js';
import type { ConversationExportState } from '../src/core/utils/titleUtils.js';
import type { DomainMessage, DomainAsset } from '../src/core/domain/conversationDetail.js';
import type { Citation } from '../src/core/parsers/gemini/rpc/extractors.js';
import type { PdfExportResult } from '../src/core/export/pdf/pdfExporter.js';
import { getAccounts } from '../src/ui/state/conversationsStore.js';
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
    Assert<Equal<ReturnType<IConversationsStore['getAccounts']>, Account[]>>,
    Assert<Equal<ReturnType<typeof getAccounts>, Account[]>>,
    Assert<Equal<Account['email'], string | undefined>>,
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
    Assert<Equal<DomainMessage['content'][number]['type'] extends string ? true : false, true>>,
    Assert<Equal<DomainAsset['document'] extends object | undefined ? true : false, true>>,
    Assert<Citation extends MessageCitation ? true : false>,
    Assert<PdfExportResult extends UIExportResult ? true : false>,
    // Negative relationships catch replacement by any/unknown/overly broad unions.
    Assert<Equal<number extends MessageCitation['url'] ? true : false, false>>,
    Assert<Equal<number[] extends MessageDocument['sections'] ? true : false, false>>,
    Assert<Equal<string extends ChatMessage['role'] ? true : false, false>>,
    Assert<Equal<((msg: { action: string }) => Promise<unknown>) extends TabServiceModule['sendToGeminiTab'] ? true : false, false>>
];
// Assert<> constraints are checked by tsc, not by runtime truthiness.
// Keep the tuple exported so the type-only contract stays inspectable.
export type SharedTypeFoundationContracts = Contracts;

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
const slots: Account[] = [{ id: '10000000-0000-4000-8000-000000000001', providerId: 'gemini', providerAccountId: '101', email: 'test@example.com' }];
const callbacks: UIExportCallbacks = {
    onProgress(progress) { const pct: number = progress.pct; void pct; },
    onItemExported(_id, record) { const time: string | number = record.exportedAt; void time; }
};
// Compiles without casts, mocks, any, or suppression: nullable clearing is part of the contract.
function clearDirectory(controller: DirHandleControllerContract): void { controller.setDirHandle(null); }
void clearDirectory;
void callbacks;
void live;
void slots;

test('completed session banner distinguishes failed exports from successful sessions', () => {
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
        const state: Array<{ message: string; border: string; background: string }> = [];
        for (const failedCount of [undefined, 0, 2]) {
            renderExportBanner({ status: 'completed', total: 3, current: 3,
                updatedAt: Date.now(), failedCount }, '10000000-0000-4000-8000-000000000001', false);
            assert.equal(banner.style.display, 'flex', 'fresh completed sessions remain visible');
            assert.equal(resume.style.display, 'none', 'a completed run must not offer resume');
            state.push({ message: bannerText.innerHTML, border: banner.style.borderColor,
                background: banner.style.background });
        }
        assert.equal(state[0].message, state[1].message,
            'a missing failure count must behave exactly like zero failures');
        assert.notEqual(state[1].message, state[2].message,
            'a partial completion must explain its failed items');
        assert.match(state[2].message, /2/, 'the actual failed count must be displayed');
        assert.notEqual(state[0].border, state[2].border,
            'partial and fully successful sessions need distinct visual statuses');
        assert.notEqual(state[0].background, state[2].background);

        renderExportBanner({ status: 'completed', total: 3, current: 3,
            updatedAt: Date.now() - 3600000, failedCount: 2 }, '10000000-0000-4000-8000-000000000001', false);
        assert.equal(banner.style.display, 'none', 'stale completion must not keep showing');
        renderExportBanner({ status: 'completed', total: 3, current: 3,
            updatedAt: Date.now(), failedCount: 2, accountId: '10000000-0000-4000-8000-000000000002' }, '10000000-0000-4000-8000-000000000001', false);
        assert.equal(banner.style.display, 'none', 'another account session must not leak into this tab');
        renderExportBanner({ status: 'completed', total: 3, current: 3,
            updatedAt: Date.now() }, '10000000-0000-4000-8000-000000000001', true);
        assert.equal(banner.style.display, 'none', 'a running export hides prior completion');
    } finally {
        if (previous) Object.defineProperty(globalThis, 'document', previous);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
