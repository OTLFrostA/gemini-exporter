import { getSettings } from '../../../application/settings/index.js';
import { connectDriveExport, disconnectDriveExport, DRIVE_EXPORT_STATUS_KEY, isDriveExportConfigured,
    readDriveExportStatus, runDriveDocumentExport } from '../../../runtime/capabilities/googleDriveExport.js';
import { SETTINGS_KEY } from '../../../shared/types/settings.js';
import { requiredElement as control, elementById as el } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

/** Experimental, source-build only. No UI or authorization when the OAuth client is absent. */
export function mountDriveExportPanel(getSelectedAccount: () => string | null): void {
    if (!isDriveExportConfigured()) return;
    const card = el('driveExportCard');
    const summary = el('driveExportSummary');
    const connect = control('button', 'btnDriveExportConnect');
    const disconnect = control('button', 'btnDriveExportDisconnect');
    const run = control('button', 'btnDriveExportNow');
    let busy = false;
    card.hidden = false;
    const refresh = async (): Promise<void> => {
        const binding = (await getSettings()).driveExport;
        const status = await readDriveExportStatus();
        connect.hidden = !!binding;
        disconnect.hidden = !binding;
        run.hidden = !binding;
        connect.disabled = disconnect.disabled = run.disabled = busy;
        if (!binding) {
            summary.textContent = text('Off. Connect to export the selected account’s complete local conversations as readable Markdown.',
                '已关闭。连接后可将当前所选账号已完整采集的本地对话导出为可阅读 Markdown。');
            return;
        }
        const target = binding.destinationEmail;
        const counts = status?.folderId === binding.folderId
            ? text(' | Exported: ' + status.exported + ', unchanged: ' + status.unchanged + ', skipped: ' + status.skipped + ', failed: ' + status.failed,
                ' | 已导出：' + status.exported + '，未变化：' + status.unchanged + '，跳过：' + status.skipped + '，失败：' + status.failed)
            : '';
        summary.textContent = text('Auto export every 5 minutes to ', '每 5 分钟自动导出到 ') + target + counts;
    };
    const action = async (work: () => Promise<void>): Promise<void> => {
        if (busy) return;
        busy = true;
        connect.disabled = disconnect.disabled = run.disabled = true;
        try {
            await work();
            busy = false;
            await refresh();
        } catch {
            busy = false;
            await refresh().catch(() => {});
            summary.textContent = text('Drive export could not complete. Check authorization or disconnect and reconnect.',
                'Drive 导出未能完成，请检查授权或断开后重新连接。');
        }
    };
    connect.addEventListener('click', () => {
        const sourceAccountId = getSelectedAccount();
        if (!sourceAccountId) {
            summary.textContent = text('Select a source account first.', '请先选择一个来源账号。');
            return;
        }
        void action(async () => {
            await connectDriveExport(sourceAccountId, (source, destination) => {
                const label = source.providerId + ' / ' + (source.email ?? source.displayName ?? source.providerAccountId);
                return window.confirm(text(
                    'Automatically export all complete local conversations of ' + label + ' to ' + destination.email +
                    ' in a new Drive folder? Documents are readable, NOT end-to-end encrypted. Other apps you authorize may read them. Attachments are omitted. Generated files are updated when source content changes. Disconnect stops future uploads but keeps existing files.',
                    '是否将 ' + label + ' 已完整采集的所有本地对话自动导出至 ' + destination.email +
                    ' 的新 Drive 文件夹？文档为可阅读明文，不采用端到端加密；您授权的其他应用可能读取。暂不包含附件。源内容变化会更新生成的文档，断开连接停止后续上传但保留已导出文件。'));
            });
        });
    });
    disconnect.addEventListener('click', () => { void action(disconnectDriveExport); });
    run.addEventListener('click', () => { void action(async () => { await runDriveDocumentExport(); }); });
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, area: string): void => {
        if (area === 'local' && (SETTINGS_KEY in changes || DRIVE_EXPORT_STATUS_KEY in changes)) {
            void refresh().catch(() => {});
        }
    };
    chrome.storage.onChanged.addListener(onChanged);
    window.addEventListener('pagehide', () => chrome.storage.onChanged.removeListener(onChanged), { once: true });
    void refresh().catch(() => {});
}
