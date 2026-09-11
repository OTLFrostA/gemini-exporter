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

    // 2. Verify no index README.md is written (pure conversation export)
    assert.strictEqual('README.md' in writtenFiles, false);

    // 4. Verify Badge feedback called
    assert.strictEqual(feedbackCalledWith, 'Quantum Computing Intro');
});

test('liveSaveCoordinator - executeLiveSave delegates via chrome.runtime.sendMessage when local handle is null', async () => {
    let sentMessage: any = null;
    let feedbackCalled = false;

    const mockStorage = {
        getLiveConfig: async () => ({
            enabledDisk: true,
            format: 'markdown',
            includeAssets: true,
            dirName: 'MyVault'
        }),
        getLiveDirHandle: async () => null, // No local handle
        setLiveConfig: async () => {}
    };

    const mockScraper = {
        parseDoc: (_doc: any, id: string) => ({
            id,
            title: 'Delegated Live Save Test',
            messages: [{ role: 'user', content: 'hello' }, { role: 'model', content: 'world' }],
            timestamp: Date.now()
        })
    };

    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (msg: any, cb: (res: any) => void) => {
                sentMessage = msg;
                if (cb) cb({ ok: true, handleName: 'MyVault' });
            }
        }
    };

    try {
        LiveSaveCoordinator.init({
            storageManager: mockStorage,
            scraper: mockScraper,
            badge: {
                showLiveSaveFeedback: () => { feedbackCalled = true; }
            },
            clientClass: null
        });

        const success = await LiveSaveCoordinator.executeLiveSave('c_delegated123', 'turn_complete');
        assert.strictEqual(success, true);
        assert.ok(sentMessage);
        const sent = sentMessage as any;
        assert.strictEqual(sent.action, 'liveSaveViaHandle');
        assert.strictEqual(sent.payload.safeTitle, 'Delegated Live Save Test');
        assert.strictEqual(feedbackCalled, true);
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('liveSaveCoordinator - executeLiveSave falls back to direct download when options handle unavailable', async () => {
    let directDownloadCalledWith: any = null;
    let feedbackCalled = false;

    const mockStorage = {
        getLiveConfig: async () => ({
            enabledDisk: true,
            format: 'markdown',
            includeAssets: true
        }),
        getLiveDirHandle: async () => null,
        setLiveConfig: async () => {}
    };

    const mockScraper = {
        parseDoc: (_doc: any, id: string) => ({
            id,
            title: 'Fallback Download Test',
            messages: [{ role: 'user', content: 'ping' }, { role: 'model', content: 'pong' }],
            timestamp: Date.now()
        })
    };

    // Save and mock triggerDirectDownload
    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (_msg: any, cb: (res: any) => void) => {
                if (cb) cb({ ok: false, error: 'no_dir_handle' });
            }
        }
    };

    try {
        LiveSaveCoordinator.init({
            storageManager: mockStorage,
            scraper: mockScraper,
            badge: {
                showLiveSaveFeedback: () => { feedbackCalled = true; }
            },
            downloadFn: (fileName: string, content: any) => {
                directDownloadCalledWith = { fileName, content: String(content) };
            },
            clientClass: null
        });

        const success = await LiveSaveCoordinator.executeLiveSave('c_fallback456', 'turn_complete');
        assert.strictEqual(success, true);
        assert.ok(directDownloadCalledWith);
        const downloaded = directDownloadCalledWith as { fileName: string; content: string };
        assert.strictEqual(downloaded.fileName, 'Fallback Download Test_fallback.md');
        assert.ok(downloaded.content.includes('ping'));
        assert.ok(downloaded.content.includes('pong'));
        assert.strictEqual(feedbackCalled, true);
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('liveSaveCoordinator - executeLiveSave uses background liveSaveDownload when options handle unavailable', async () => {
    let bgDownloadMsg: any = null;
    let feedbackCalled = false;

    const mockStorage = {
        getLiveConfig: async () => ({
            enabledDisk: true,
            format: 'markdown',
            includeAssets: true,
            dirName: 'MyVault'
        }),
        getLiveDirHandle: async () => null,
        setLiveConfig: async () => {}
    };

    const mockScraper = {
        parseDoc: (_doc: any, id: string) => ({
            id,
            title: 'BG Download Test',
            messages: [{ role: 'user', content: 'test bg' }],
            timestamp: Date.now()
        })
    };

    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (msg: any, cb: (res: any) => void) => {
                if (msg.action === 'liveSaveViaHandle') {
                    if (cb) cb({ ok: false, error: 'no_dir_handle' });
                } else if (msg.action === 'liveSaveDownload') {
                    bgDownloadMsg = msg;
                    if (cb) cb({ ok: true, downloadId: 42 });
                }
            }
        }
    };

    try {
        LiveSaveCoordinator.init({
            storageManager: mockStorage,
            scraper: mockScraper,
            badge: {
                showLiveSaveFeedback: () => { feedbackCalled = true; }
            },
            clientClass: null
        });

        const success = await LiveSaveCoordinator.executeLiveSave('c_bgdl789', 'turn_complete');
        assert.strictEqual(success, true);
        assert.ok(bgDownloadMsg);
        assert.strictEqual(bgDownloadMsg.action, 'liveSaveDownload');
        assert.strictEqual(bgDownloadMsg.filename, 'MyVault/BG Download Test_bgdl789.md');
        assert.ok(bgDownloadMsg.url.startsWith('data:text/markdown'));
        assert.strictEqual(feedbackCalled, true);
    } finally {
        (global as any).chrome = origChrome;
    }
});
