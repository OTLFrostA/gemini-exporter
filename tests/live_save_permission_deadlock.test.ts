export {};
const test = require('node:test');
const assert = require('node:assert');

const {
    downloadViaDownloadsAPI,
    saveViaDownloadsFallback,
    handleLiveSaveViaHandle
} = require('../src/background/liveSaveHandler.js');
const idbStore = require('../src/core/storage/idbHandleStore.js');
const liveStorage = require('../src/core/storage/liveStorageManager.js');
const { StorageService } = require('../src/core/storage/storageService.js');
const DirHandleController = require('../src/ui/controllers/dirHandleController.js');

test('liveSavePermissionDeadlock - downloadViaDownloadsAPI triggers chrome.downloads.download', async () => {
    let downloadArgs: any = null;
    const origChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
        downloads: {
            download: (options: any, cb: (id?: number) => void) => {
                downloadArgs = options;
                cb(12345);
            }
        },
        runtime: { lastError: null }
    };

    try {
        const ok = await downloadViaDownloadsAPI('chat_test.md', '# Title\nHello', 'text/markdown');
        assert.strictEqual(ok, true);
        assert.ok(downloadArgs);
        assert.strictEqual(downloadArgs.filename, 'gemini_export/chat_test.md');
        assert.strictEqual(downloadArgs.conflictAction, 'overwrite');
        assert.strictEqual(downloadArgs.saveAs, false);
        assert.ok(downloadArgs.url.startsWith('data:text/markdown;base64,'));
    } finally {
        (globalThis as any).chrome = origChrome;
    }
});

test('liveSavePermissionDeadlock - saveViaDownloadsFallback executes zero data loss save', async () => {
    const downloadedFiles: Array<{ filename: string; url: string }> = [];
    let savedLiveConfig: any = null;
    let savedExportRecord: any = null;

    const origChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
        downloads: {
            download: (options: any, cb: (id?: number) => void) => {
                downloadedFiles.push({ filename: options.filename, url: options.url });
                cb(999);
            }
        },
        runtime: { lastError: null }
    };

    const origSetLiveConfig = liveStorage.setLiveConfig;
    liveStorage.setLiveConfig = async (patch: any) => {
        savedLiveConfig = patch;
    };

    const origSaveExportRecord = StorageService.saveExportRecord;
    StorageService.saveExportRecord = async (slot: string, id: string, meta: any) => {
        savedExportRecord = { slot, id, meta };
    };

    try {
        const chat = {
            title: 'Quantum Physics',
            messages: [
                { role: 'user', content: 'What is superposition?' },
                { role: 'model', content: 'Superposition is...' }
            ]
        };
        const assets = [
            { fileName: 'quantum_diagram.png', subDir: 'assets', base64: Buffer.from('fake_image_bytes').toString('base64') }
        ];

        const result = await saveViaDownloadsFallback(chat, 'Quantum Physics', 'chat_qp_1', 'Quantum_Physics_1234.md', assets, 'u0');

        assert.strictEqual(result.ok, true);
        assert.strictEqual(result.fallback, 'downloads');
        assert.strictEqual(result.error, 'permission_prompt_needed');
        assert.strictEqual(result.targetFile, 'Quantum_Physics_1234.md');

        // Verify both Markdown and asset were downloaded into gemini_export/
        assert.strictEqual(downloadedFiles.length, 2);
        assert.strictEqual(downloadedFiles[0].filename, 'gemini_export/Quantum_Physics_1234.md');
        assert.strictEqual(downloadedFiles[1].filename, 'gemini_export/assets/quantum_diagram.png');

        // Verify config updated with permission prompt needed
        assert.ok(savedLiveConfig);
        assert.strictEqual(savedLiveConfig.dirError, 'permission_prompt_needed');
        assert.strictEqual(savedLiveConfig.lastSavedTitle, 'Quantum Physics');

        // Verify export record preserved in SSoT
        assert.ok(savedExportRecord);
        assert.strictEqual(savedExportRecord.slot, 'u0');
        assert.strictEqual(savedExportRecord.id, 'chat_qp_1');
    } finally {
        (globalThis as any).chrome = origChrome;
        liveStorage.setLiveConfig = origSetLiveConfig;
        StorageService.saveExportRecord = origSaveExportRecord;
    }
});

test('liveSavePermissionDeadlock - handleLiveSaveViaHandle falls back when handle queryPermission is prompt', async () => {
    let downloadsCalled = false;
    const origChrome = (globalThis as any).chrome;
    (globalThis as any).chrome = {
        downloads: {
            download: (options: any, cb: (id?: number) => void) => {
                downloadsCalled = true;
                cb(101);
            }
        },
        runtime: { lastError: null }
    };

    const origGetStored = idbStore.getStoredDirHandle;
    idbStore.getStoredDirHandle = async () => ({
        name: 'MyVault',
        queryPermission: async () => 'prompt' // degraded by browser restart
    });

    try {
        const payload = {
            chat: { title: 'Test Chat', messages: [{ role: 'user', content: 'Hi' }] },
            safeTitle: 'Test Chat',
            nid: 'chat_test_1'
        };

        const res = await handleLiveSaveViaHandle(payload);
        assert.strictEqual(res.ok, true);
        assert.strictEqual(res.fallback, 'downloads');
        assert.strictEqual(res.error, 'permission_prompt_needed');
        assert.strictEqual(downloadsCalled, true);
    } finally {
        (globalThis as any).chrome = origChrome;
        idbStore.getStoredDirHandle = origGetStored;
    }
});

test('liveSavePermissionDeadlock - dirHandleController preserves pending handle on prompt and enables reauthorization', async () => {
    let clearedHandle = false;
    let savedHandle: any = null;

    const origGetStored = idbStore.getStoredDirHandle;
    const origSaveStored = idbStore.saveStoredDirHandle;

    let permissionState = 'prompt';
    const mockDegradedHandle = {
        name: 'Vault_Obsidian',
        queryPermission: async () => permissionState,
        requestPermission: async () => {
            permissionState = 'granted';
            return 'granted';
        },
        keys: async function* () {
            yield 'file.txt';
        }
    };

    idbStore.getStoredDirHandle = async () => mockDegradedHandle;
    idbStore.saveStoredDirHandle = async (h: any) => {
        if (h === null) clearedHandle = true;
        savedHandle = h;
        return true;
    };

    try {
        // Step 1: restoreSavedDirHandle while permission is 'prompt'
        const restored = await DirHandleController.restoreSavedDirHandle();
        assert.strictEqual(restored, null, 'Cannot use handle directly when permission is prompt');
        assert.strictEqual(clearedHandle, false, 'Handle must NOT be wiped from IndexedDB when directory physically exists!');

        // Step 2: pendingPermissionHandle is retained
        const pending = DirHandleController.getPendingPermissionHandle();
        assert.ok(pending, 'Pending permission handle must be preserved');
        assert.strictEqual(pending.name, 'Vault_Obsidian');

        // Step 3: user triggers reauthorization via user click
        const reauthOk = await DirHandleController.reauthorizeDirHandle();
        assert.strictEqual(reauthOk, true, 'reauthorizeDirHandle must succeed when user grants permission');

        // Step 4: handle is now active and pending is cleared
        const active = DirHandleController.getDirHandle();
        assert.ok(active);
        assert.strictEqual(active.name, 'Vault_Obsidian');
        assert.strictEqual(DirHandleController.getPendingPermissionHandle(), null);
    } finally {
        idbStore.getStoredDirHandle = origGetStored;
        idbStore.saveStoredDirHandle = origSaveStored;
    }
});
