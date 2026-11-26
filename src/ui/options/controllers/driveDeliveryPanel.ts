import { DriveAuthorizationExpired, driveFolderName, connectDriveDelivery, isDriveDeliveryConfigured, preloadDriveAccountClient } from '../../../runtime/capabilities/googleDriveDelivery.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

export function mountDriveDeliveryPanel() {
    const configured = isDriveDeliveryConfigured();
    el('driveDeliveryCard').hidden = !configured;
    if (configured) preloadDriveAccountClient();
    const reconnect = control('button', 'driveConnect');
    const switchAccount = control('button', 'driveSwitch');
    const link = control('a', 'openDriveExport');
    const status = el('driveConnectionStatus');
    const lifetime = new AbortController();
    let session: Awaited<ReturnType<typeof connectDriveDelivery>> | undefined;
    let pending = false;
    let exporting = false;
    let needsReconnect = false;

    function updateControls() {
        reconnect.hidden = !needsReconnect || pending;
        switchAccount.hidden = !session && !needsReconnect;
        reconnect.disabled = switchAccount.disabled = pending || exporting;
    }
    function accountLabel(email: string) {
        return text('Export account: ', '导出账号：') + email;
    }
    async function connect(mode: 'switch' | 'connect' | 'restore') {
        if (pending || exporting) return;
        pending = true;
        link.hidden = true;
        status.textContent = mode === 'switch'
            ? text('Opening Google account chooser…', '正在打开 Google 账号选择窗口…')
            : text('Connecting to Google Drive…', '正在连接 Google Drive…');
        updateControls();
        try {
            session = await connectDriveDelivery(lifetime.signal, mode);
            needsReconnect = false;
            status.textContent = accountLabel(session.email);
        } catch {
            needsReconnect = !session;
            status.textContent = session
                ? accountLabel(session.email) + text(' · Account switch did not complete.', ' · 未完成账号切换。')
                : text('Drive connection unavailable. Reconnect to continue.', 'Drive 连接不可用，请重新连接。');
        } finally { pending = false; updateControls(); }
    }
    control('input', 'driveDeliveryRadio').addEventListener('click', () => { if (!session) void connect('connect'); });
    reconnect.addEventListener('click', () => { void connect('connect'); });
    switchAccount.addEventListener('click', () => { void connect('switch'); });
    status.textContent = text('Connect to Google Drive.', '连接 Google Drive。');
    updateControls();
    return {
        restoreConnection() { if (configured) void connect('restore'); },
        setExporting(value: boolean) { exporting = value; updateControls(); },
        dispose: () => lifetime.abort(),
        writer(signal: AbortSignal) {
            const connected = session;
            if (!connected || pending) throw new Error(text('Connect Google Drive first.', '请先连接 Google Drive。'));
            link.hidden = true;
            return async (fileName: string, data: Blob) => {
                try {
                    const href = await connected.upload(fileName, data, signal);
                    if (!fileName.includes('/')) {
                        link.href = href;
                        link.textContent = text('Open in Drive', '在 Drive 中打开') + ' · ' + driveFolderName + ' / ' + fileName;
                        link.hidden = false;
                    }
                } catch (error) {
                    if (error instanceof DriveAuthorizationExpired) {
                        session = undefined;
                        needsReconnect = true;
                        status.textContent = text('Reconnect to continue: ', '请重新连接：') + connected.email;
                        updateControls();
                    }
                    throw error;
                }
            };
        },
    };
}
