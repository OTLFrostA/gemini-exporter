import type { DirectoryHandle } from '../core/engine/writers/directoryHandle.js';
import { getSettings } from '../core/application/settings/index.js';
import { runExport } from '../core/application/export/runExport.js';
import { getDirectoryHandle } from '../core/storage/storageService.js';
import type { ConversationKey } from '../core/domain/conversationKey.js';
import type { ExportResult } from '../core/application/export/types.js';

export async function runLiveSave(key: ConversationKey): Promise<ExportResult | null> {
    const settings = await getSettings();
    if (!settings.enabledDisk || settings.defaultFormat !== 'markdown') return null;
    const handle = await getDirectoryHandle() as DirectoryHandle | null;
    if (!handle) throw new Error('Choose a Live Save directory in Options');
    if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('Reauthorize the Live Save directory in Options');
    return runExport({ keys: [key], format: 'markdown', delivery: 'folderWriter',
        useZip: false, includeAssets: settings.includeAssets, skipUnchanged: true });
}
