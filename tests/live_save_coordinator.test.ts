export {};
const test = require('node:test');
const assert = require('node:assert');
const LiveSaveCoordinator = require('../src/content/liveSaveCoordinator.js');

test('liveSaveCoordinator - executeLiveSave with direct Disk persistence', async () => {
    let writtenFiles: Record<string, string> = {};
    let feedbackCalledWith: string | null = null;

    const mockStorage = {
        getLiveConfig: async () => ({
            enabledDisk: true,
            format: 'markdown',
            includeAssets: true,
            updateIndex: true,
            dirName: 'ObsidianVault'
        }),
        getLiveDirHandle: async () => ({
            name: 'ObsidianVault'
        }),
        setLiveConfig: async () => {}
    };

    const mockScraper = {
        parseDoc: (doc: any, id: string) => ({
            id,
            title: 'Quantum Computing Intro',
            messages: [
                { role: 'user', content: 'What is superposition?' },
                { role: 'model', content: 'Superposition is a fundamental principle of quantum mechanics.' }
            ],
            timestamp: 1710000000000
        })
    };

    class MockFsWriter {
        dirHandle: any;
        folderName: string;
        constructor(handle: any, folder: string) {
            this.dirHandle = handle;
            this.folderName = folder;
        }
        async init() {}
        async writeFile(subDir: string, name: string, content: string) {
            const path = subDir ? `${subDir}/${name}` : name;
            writtenFiles[path] = content;
            return name;
        }
    }

    const mockBadge = {
        showLiveSaveFeedback: (title: string) => {
            feedbackCalledWith = title;
        }
    };

    LiveSaveCoordinator.init({
        storageManager: mockStorage,
        scraper: mockScraper,
        fsWriterClass: MockFsWriter,
        badge: mockBadge,
        clientClass: null // Force fallback to scraper
    });

    const success = await LiveSaveCoordinator.executeLiveSave('c_9876543210abcdef', 'turn_complete');
    assert.strictEqual(success, true);

    // 1. Verify Disk FsWriter persistence
    const expectedFile = 'Quantum Computing Intro_98765432.md';
    assert.ok(expectedFile in writtenFiles);
    assert.ok(writtenFiles[expectedFile].includes('What is superposition?'));
    assert.ok(writtenFiles[expectedFile].includes('Superposition is a fundamental principle'));

    // 3. Verify README.md index updated
    assert.ok('README.md' in writtenFiles);
    assert.ok(writtenFiles['README.md'].includes('Quantum Computing Intro'));

    // 4. Verify Badge feedback called
    assert.strictEqual(feedbackCalledWith, 'Quantum Computing Intro');
});
