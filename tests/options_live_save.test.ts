export {};
const test = require('node:test');
const assert = require('node:assert');
const OptionsSettings = require('../src/ui/options/modules/optionsSettings.js');
const LiveStorageManager = require('../src/core/storage/liveStorageManager.js');

test('optionsSettings - initLiveSaveSettings binds controls and updates config', async () => {
    let savedConfig: any = null;

    const mockElements: Record<string, any> = {
        liveSaveDiskToggle: { checked: false, dataset: {}, addEventListener: function(e: string, fn: Function) { this.onChange = fn; } },
        liveSaveDiskBox: { style: { display: 'none' } },
        btnSetLiveDir: { dataset: {}, addEventListener: function(e: string, fn: Function) { this.onClick = fn; } },
        liveDirLabel: { textContent: '' },
        liveSaveStatusTag: { textContent: '' }
    };

    const origDoc = (global as any).document;
    (global as any).document = {
        getElementById: (id: string) => mockElements[id] || null
    };

    const origGetLiveConfig = LiveStorageManager.getLiveConfig;
    const origSetLiveConfig = LiveStorageManager.setLiveConfig;
    const origGetLiveDirHandle = LiveStorageManager.getLiveDirHandle;

    LiveStorageManager.getLiveConfig = async () => ({
        enabledDisk: false,
        format: 'markdown',
        includeAssets: true,
        dirName: 'MyVault',
        lastSavedAt: 1710000000000
    });

    LiveStorageManager.setLiveConfig = async (patch: any) => {
        savedConfig = patch;
        return { ...LiveStorageManager.DEFAULT_LIVE_CONFIG, ...patch };
    };

    LiveStorageManager.getLiveDirHandle = async () => ({
        name: 'MyVault'
    });

    try {
        await OptionsSettings.initLiveSaveSettings();

        // Check initial restored state
        assert.strictEqual(mockElements.liveSaveDiskToggle.checked, false);
        assert.strictEqual(mockElements.liveSaveDiskBox.style.display, 'none');
        assert.ok(mockElements.liveDirLabel.textContent.includes('MyVault'));

        // Toggle Disk Save on
        mockElements.liveSaveDiskToggle.checked = true;
        await mockElements.liveSaveDiskToggle.onChange();
        assert.strictEqual(mockElements.liveSaveDiskBox.style.display, 'flex');
        assert.strictEqual(savedConfig.enabledDisk, true);
    } finally {
        (global as any).document = origDoc;
        LiveStorageManager.getLiveConfig = origGetLiveConfig;
        LiveStorageManager.setLiveConfig = origSetLiveConfig;
        LiveStorageManager.getLiveDirHandle = origGetLiveDirHandle;
    }
});
