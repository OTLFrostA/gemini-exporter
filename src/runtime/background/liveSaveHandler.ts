import type { DirectoryHandle } from '../capabilities/directoryHandle.js';
import { getSettings } from '../../application/settings/index.js';
import { runExport } from '../../application/export/runExport.js';
import { getDirectoryHandle } from '../../l3a/storageService.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import type { ExportResult } from '../../application/export/types.js';
import { startKeepAlive } from './keepAlive.js';

export async function runLiveSave(key: ConversationKey): Promise<ExportResult | null> {
    const settings = await getSettings();
    if (!settings.enabledDisk || settings.defaultFormat !== 'markdown') return null;
    const handle = await getDirectoryHandle() as DirectoryHandle | null;
    if (!handle) throw new Error('Choose a Live Save directory in Options');
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Reauthorize the Live Save directory in Options');
    // The Worker has no durable task resume. Best-effort Chrome API activity
    // during this one execution cannot be confused with a delivery receipt.
    const stopKeepAlive = startKeepAlive();
    try {
        return await runExport({ keys: [key], format: 'markdown', delivery: 'folderWriter',
            includeAssets: settings.includeAssets, skipUnchanged: false });
    } finally {
        stopKeepAlive();
    }
}
