import { connectDriveDelivery, isDriveDeliveryConfigured } from '../../../runtime/capabilities/googleDriveDelivery.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { text } from '../../shared/settings.js';

export function mountDriveDeliveryPanel() {
    el('driveDeliveryCard').hidden = !isDriveDeliveryConfigured();
    const folder = control('select', 'driveFolder');
    const name = control('input', 'driveNewFolderName');
    const reconnect = control('button', 'driveConnect');
    const create = control('button', 'driveCreateFolder');
    const link = control('a', 'openDriveExport');
    const status = el('driveConnectionStatus');
    const lifetime = new AbortController();
    let session: Awaited<ReturnType<typeof connectDriveDelivery>> | undefined;
    let pending = false;
    let exporting = false;

    function updateControls() {
        reconnect.disabled = pending || exporting;
        folder.disabled = name.disabled = create.disabled = !session || pending || exporting;
    }
    async function connect() {
        if (pending) return;
        pending = true;
        session = undefined;
        link.hidden = true;
        folder.replaceChildren(new Option(text('My Drive', '我的云端硬盘'), 'root'));
        status.textContent = text('Connecting to Google Drive…', '正在连接 Google Drive…');
        updateControls();
        try {
            const connected = await connectDriveDelivery(lifetime.signal);
            for (const item of await connected.listFolders()) folder.add(new Option(item.name, item.id));
            session = connected;
            status.textContent = connected.email;
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : String(error);
        } finally { pending = false; updateControls(); }
    }
    control('input', 'driveDeliveryRadio').addEventListener('click', () => { if (!session) void connect(); });
    reconnect.addEventListener('click', () => { void connect(); });
    create.addEventListener('click', async () => {
        if (!session || pending) return;
        if (!name.value.trim()) { name.focus(); return; }
        pending = true;
        updateControls();
        try {
            const item = await session.createFolder(folder.value, name.value.trim());
            folder.add(new Option(item.name, item.id));
            folder.value = item.id;
            name.value = '';
            status.textContent = session.email;
        } catch (error) {
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
            if (!connected || pending) throw new Error(text('Connect Google Drive and choose a folder first.', '请先连接 Google Drive 并选择目标文件夹。'));
            const parent = folder.value;
            const destination = folder.selectedOptions[0].text;
            link.hidden = true;
            return async (fileName: string, data: Blob) => {
                link.href = await connected.upload(parent, fileName, data, signal);
                link.textContent = text('Open in Drive', '在 Drive 中打开') + ' · ' + destination + ' / ' + fileName;
                link.hidden = false;
            };
        },
    };
}
