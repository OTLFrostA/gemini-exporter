import { driveFolderName, connectDriveDelivery, isDriveDeliveryConfigured } from '../../../runtime/capabilities/googleDriveDelivery.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

export function mountDriveDeliveryPanel() {
    el('driveDeliveryCard').hidden = !isDriveDeliveryConfigured();
    const reconnect = control('button', 'driveConnect');
    const link = control('a', 'openDriveExport');
    const status = el('driveConnectionStatus');
    const lifetime = new AbortController();
    let session: Awaited<ReturnType<typeof connectDriveDelivery>> | undefined;
    let pending = false;
    let exporting = false;

    function updateControls() {
        reconnect.disabled = pending || exporting;
    }
    async function connect(interactive: boolean) {
        if (pending) return;
        pending = true;
        session = undefined;
        link.hidden = true;
        status.textContent = text('Connecting to Google Drive…', '正在连接 Google Drive…');
        updateControls();
        try {
            const connected = await connectDriveDelivery(lifetime.signal, interactive);
            session = connected;
            status.textContent = connected.email;
        } catch (error) {
            status.textContent = interactive ? (error instanceof Error ? error.message : String(error))
                : text('Could not restore the connection. Click Connect to retry.', '未能恢复连接，点击「连接」重试。');
        } finally { pending = false; updateControls(); }
    }
    control('input', 'driveDeliveryRadio').addEventListener('click', () => { if (!session) void connect(true); });
    reconnect.addEventListener('click', () => { void connect(true); });
    status.textContent = text('Connect to Google Drive.', '连接 Google Drive。');
    updateControls();
    return {
        restoreConnection() { if (isDriveDeliveryConfigured()) void connect(false); },
        setExporting(value: boolean) { exporting = value; updateControls(); },
        dispose: () => lifetime.abort(),
        writer(signal: AbortSignal) {
            const connected = session;
            if (!connected || pending) throw new Error(text('Connect Google Drive first.', '请先连接 Google Drive。'));
            link.hidden = true;
            return async (fileName: string, data: Blob) => {
                link.href = await connected.upload(fileName, data, signal);
                link.textContent = text('Open in Drive', '在 Drive 中打开') + ' · ' + driveFolderName + ' / ' + fileName;
                link.hidden = false;
            };
        },
    };
}
