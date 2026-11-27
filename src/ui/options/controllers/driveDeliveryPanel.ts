import {
    DriveAuthError,
    DriveAuthorizationExpired,
    connectDriveDelivery,
    isDriveDeliveryConfigured,
    requestDrivePermissions,
} from '../../../runtime/capabilities/googleDriveDelivery.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

export function mountDriveDeliveryPanel() {
    const reconnect = control('button', 'driveConnect');
    const switchAccount = control('button', 'driveSwitch');
    const destination = control('a', 'driveDestination');
    const status = el('driveConnectionStatus');
    const lifetime = new AbortController();
    let session: Awaited<ReturnType<typeof connectDriveDelivery>> | undefined;
    let pending = false;
    let exporting = false;
    let needsReconnect = false;
    let expiredEmail = '';
    let statusState:
        | 'idle'
        | 'connecting'
        | 'switching'
        | 'connected'
        | 'switch_failed'
        | 'permission_denied'
        | 'cancelled'
        | 'unavailable'
        | 'unconfigured'
        | 'expired' = 'idle';

    function accountLabel(email: string) {
        return text('Export account: ', '导出账号：') + email;
    }
    function renderStatus() {
        switch (statusState) {
            case 'connecting':
                status.textContent = text('Connecting to Google Drive…', '正在连接 Google Drive…');
                return;
            case 'switching':
                status.textContent = text('Opening Google account chooser…', '正在打开 Google 账号选择窗口…');
                return;
            case 'connected':
                status.textContent = session ? accountLabel(session.email) : text('Connect to Google Drive.', '连接 Google Drive。');
                return;
            case 'switch_failed':
                status.textContent = session
                    ? accountLabel(session.email) + text(' · Account switch did not complete.', ' · 未完成账号切换。')
                    : text('Drive connection unavailable. Reconnect to continue.', 'Drive 连接不可用，请重新连接。');
                return;
            case 'permission_denied':
                status.textContent = text(
                    'Google Drive permission was not granted. Reconnect to authorize.',
                    '未授予 Google Drive 权限，请点击重新连接并授权。',
                );
                return;
            case 'cancelled':
                status.textContent = text(
                    'Google Drive authorization was cancelled. Reconnect to continue.',
                    '已取消 Google Drive 授权，请重新连接。',
                );
                return;
            case 'unavailable':
                status.textContent = text('Drive connection unavailable. Reconnect to continue.', 'Drive 连接不可用，请重新连接。');
                return;
            case 'unconfigured':
                status.textContent = text('Google Drive authorization is unavailable in this installation.', '当前安装无法使用 Google Drive 授权。');
                return;
            case 'expired':
                status.textContent = text('Reconnect to continue: ', '请重新连接：') + expiredEmail;
                return;
            default:
                status.textContent = text('Connect to Google Drive.', '连接 Google Drive。');
        }
    }
    function updateControls() {
        reconnect.hidden = !needsReconnect || pending;
        switchAccount.hidden = !session && !needsReconnect;
        reconnect.disabled = switchAccount.disabled = pending || exporting;
    }
    async function connect(mode: 'switch' | 'connect' | 'restore') {
        if (pending || exporting) return;
        pending = true;
        // Request optional Drive permissions synchronously within the user gesture before any await.
        const permissionPromise = mode === 'restore' ? Promise.resolve(true) : requestDrivePermissions();
        statusState = mode === 'switch' ? 'switching' : 'connecting';
        renderStatus();
        updateControls();
        try {
            if (!await permissionPromise) {
                needsReconnect = !session;
                statusState = session ? 'switch_failed' : 'permission_denied';
                renderStatus();
                return;
            }
            if (!await isDriveDeliveryConfigured()) {
                statusState = 'unconfigured';
                renderStatus();
                return;
            }
            const connected = await connectDriveDelivery(lifetime.signal, mode);
            session = connected;
            destination.removeAttribute('href');
            needsReconnect = false;
            statusState = 'connected';
            renderStatus();
            // Folder discovery is read-only and does not delay account selection or upload.
            void connected.findExportFolderUrl().then(href => {
                if (session === connected && href && !destination.hasAttribute('href')) destination.href = href;
            }).catch(() => {});
        } catch (error) {
            if (mode !== 'restore') {
                console.warn('[DriveDelivery] Authorization failed:', error);
            }
            needsReconnect = !session;
            if (session) {
                statusState = 'switch_failed';
            } else if (error instanceof DriveAuthError && error.code === 'permission_denied') {
                statusState = mode === 'restore' ? 'idle' : 'permission_denied';
            } else if (error instanceof DriveAuthError && error.code === 'cancelled') {
                statusState = 'cancelled';
            } else if (error instanceof DriveAuthError && error.code === 'unconfigured') {
                statusState = 'unconfigured';
            } else {
                statusState = 'unavailable';
            }
            renderStatus();
        } finally { pending = false; updateControls(); }
    }
    const radio = control('input', 'driveDeliveryRadio');
    let suppressRadioChange = false;
    const triggerConnect = () => { if (!session && !pending) void connect('connect'); };
    radio.addEventListener('click', () => {
        suppressRadioChange = true;
        setTimeout(() => { suppressRadioChange = false; }, 0);
        triggerConnect();
    });
    radio.addEventListener('change', () => {
        if (suppressRadioChange) return;
        if (radio.checked) triggerConnect();
    });
    reconnect.addEventListener('click', () => { void connect('connect'); });
    switchAccount.addEventListener('click', () => { void connect('switch'); });
    renderStatus();
    updateControls();
    void isDriveDeliveryConfigured().then(enabled => {
        if (!enabled && statusState === 'idle') {
            statusState = 'unconfigured';
            renderStatus();
        }
    });
    return {
        restoreConnection() { void isDriveDeliveryConfigured().then(enabled => { if (enabled) return connect('restore'); }); },
        renderLanguage() { renderStatus(); },
        setExporting(value: boolean) { exporting = value; updateControls(); },
        dispose: () => lifetime.abort(),
        writer(signal: AbortSignal) {
            const connected = session;
            if (!connected || pending) throw new Error(text('Connect Google Drive first.', '请先连接 Google Drive。'));
            return async (fileName: string, data: Blob) => {
                try {
                    const href = await connected.upload(fileName, data, signal);
                    if (session === connected) destination.href = href;
                } catch (error) {
                    if (session === connected && error instanceof DriveAuthorizationExpired) {
                        session = undefined;
                        destination.removeAttribute('href');
                        needsReconnect = true;
                        expiredEmail = connected.email;
                        statusState = 'expired';
                        renderStatus();
                        updateControls();
                    }
                    throw error;
                }
            };
        },
    };
}
