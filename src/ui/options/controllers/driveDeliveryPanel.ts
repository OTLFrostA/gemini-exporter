import { connectDriveDelivery, isDriveDeliveryConfigured } from '../../../runtime/capabilities/googleDriveDelivery.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

export function mountDriveDeliveryPanel() {
    el('driveDeliveryCard').hidden = !isDriveDeliveryConfigured();
    const choose = control('button', 'driveChooseFolder');
    const folder = el('driveFolder');
    const reconnect = control('button', 'driveConnect');
    let parent = 'root';
    const link = control('a', 'openDriveExport');
    const status = el('driveConnectionStatus');
    const lifetime = new AbortController();
    let session: Awaited<ReturnType<typeof connectDriveDelivery>> | undefined;
    let pending = false;
    let exporting = false;

    function updateControls() {
        reconnect.disabled = pending || exporting;
        choose.disabled = !session || pending || exporting;
    }
    async function connect() {
        if (pending) return;
        pending = true;
        session = undefined;
        link.hidden = true;
        parent = 'root';
        folder.textContent = text('My Drive', '我的云端硬盘');
        status.textContent = text('Connecting to Google Drive…', '正在连接 Google Drive…');
        updateControls();
        try {
            const connected = await connectDriveDelivery(lifetime.signal);
            session = connected;
            status.textContent = connected.email;
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally { pending = false; updateControls(); }
    }
    control('input', 'driveDeliveryRadio').addEventListener('click', () => { if (!session) void connect(); });
    reconnect.addEventListener('click', () => { void connect(); });
    choose.addEventListener('click', async () => {
        if (!session || pending) return;
        pending = true;
        updateControls();
        try {
            const dialog = control('dialog', 'drivePickerDialog');
            const frame = document.createElement('iframe');
            frame.title = text('Choose a Google Drive folder', '选择 Google Drive 文件夹');
            dialog.append(frame);
            let item;
            try {
                dialog.showModal();
                item = await session.chooseFolder(frame, dialog);
            } finally {
                dialog.close();
                frame.remove();
            }
            if (item) {
                parent = item.id;
                folder.textContent = item.name;
            }
            status.textContent = session.email;
        } catch (error) {
            parent = '';
            folder.textContent = text('Choose a folder', '请选择文件夹');
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally { pending = false; updateControls(); }
    });
    status.textContent = text('Connect to choose a Drive folder.', '连接后可选择 Drive 文件夹。');
    updateControls();
    return {
        setExporting(value: boolean) { exporting = value; updateControls(); },
        dispose: () => lifetime.abort(),
        writer(signal: AbortSignal) {
            const connected = session;
            if (!connected || pending || !parent) throw new Error(text('Connect Google Drive and choose a folder first.', '请先连接 Google Drive 并选择目标文件夹。'));
            const selectedParent = parent;
            const destination = folder.textContent;
            link.hidden = true;
            return async (fileName: string, data: Blob) => {
                link.href = await connected.upload(selectedParent, fileName, data, signal);
                link.textContent = text('Open in Drive', '在 Drive 中打开') + ' · ' + destination + ' / ' + fileName;
                link.hidden = false;
            };
        },
    };
}
