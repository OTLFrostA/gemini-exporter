const { historicalFixture } = require('./helpers/nativeFixture.js');
export {};
const test = require('node:test');
const assert = require('node:assert');
const LiveSaveCoordinator = require('../src/content/liveSaveCoordinator.js');

test('B3 Safety 1: RPC/provider success beats DOM scraper', async () => {
    let scraperCalled = false;
    class MockClient {
        async getConversationDetail(id: string) {
            return historicalFixture({
                id,
                title: 'RPC Authority Title',
                messages: [{ role: 'user', content: 'from RPC', timestamp: 1710000000000 }],
                chatTime: 1710000000000,
                updatedAt: 1710000000000,
                timestamp: 1710000000000
            });
        }
    }
    const mockScraper = {
        parseDoc: () => {
            scraperCalled = true;
            return historicalFixture({
                id: 'dom_id',
                title: 'DOM Scraped Title',
                messages: [{ role: 'user', content: 'from DOM' }]
            });
        }
    };

    LiveSaveCoordinator.init({
        clientClass: MockClient,
        scraper: mockScraper
    });

    const detail = await LiveSaveCoordinator.resolveConversationDetail('c_rpc_beats_dom');
    assert.ok(detail);
    assert.strictEqual(detail.conversation.title, 'RPC Authority Title');
    assert.deepStrictEqual(detail.conversation.messages[0].content, [{ type: 'paragraph', children: [{ type: 'text', text: 'from RPC' }] }]);
    assert.strictEqual(scraperCalled, false, 'DOM scraper must not be called when RPC detail succeeds');
});

test('B3 Safety 2: RPC empty/failure falls back to DOM scraper', async () => {
    let scraperCalled = false;
    class FailingClient {
        async getConversationDetail() {
            throw new Error('Network error on RPC');
        }
    }
    const mockScraper = {
        parseDoc: () => {
            scraperCalled = true;
            return historicalFixture({
                id: 'c_fallback_test',
                title: 'DOM Fallback Title',
                messages: [{ role: 'user', content: 'from DOM fallback' }]
            });
        }
    };

    LiveSaveCoordinator.init({
        clientClass: FailingClient,
        scraper: mockScraper
    });

    const detail = await LiveSaveCoordinator.resolveConversationDetail('c_fallback_test');
    assert.ok(detail);
    assert.strictEqual(detail.conversation.title, 'DOM Fallback Title');
    assert.deepStrictEqual(detail.conversation.messages[0].content, [{ type: 'paragraph', children: [{ type: 'text', text: 'from DOM fallback' }] }]);
    assert.strictEqual(scraperCalled, true, 'DOM scraper must be called when RPC throws');

    // Also test RPC returning empty messages array
    class EmptyMessagesClient {
        async getConversationDetail(id: string) {
            return historicalFixture({ id, title: 'Empty', messages: [] });
        }
    }
    scraperCalled = false;
    LiveSaveCoordinator.init({
        clientClass: EmptyMessagesClient,
        scraper: mockScraper
    });

    const detail2 = await LiveSaveCoordinator.resolveConversationDetail('c_empty_test');
    assert.ok(detail2);
    assert.strictEqual(detail2.conversation.title, 'DOM Fallback Title');
    assert.strictEqual(scraperCalled, true, 'DOM scraper must be called when RPC returns 0 messages');
});

test('B3 Safety 3: runtime preserves source timestamps without repairing missing conversation time', async () => {
    class TimestampClient {
        async getConversationDetail(id: string) {
            return historicalFixture({
                id,
                title: 'Timestamp Test',
                chatTime: null, // missing/non-finite
                updatedAt: null,
                timestamp: null,
                messages: [
                    { role: 'user', content: 'msg1', timestamp: 1000 },
                    { role: 'model', content: 'msg2', timestamp: 5000 },
                    { role: 'user', content: 'msg3', timestamp: 3000 },
                    { role: 'model', content: 'msg4', timestamp: -1 },
                    { role: 'user', content: 'msg5', timestamp: null }
                ]
            });
        }
    }

    LiveSaveCoordinator.init({
        clientClass: TimestampClient
    });

    const detail = await LiveSaveCoordinator.resolveConversationDetail('c_timestamp_test');
    assert.ok(detail);
    assert.strictEqual(detail.conversation.chatTime, undefined);
    assert.strictEqual(detail.conversation.updatedAt, null);
    assert.strictEqual(detail.conversation.timestamp, null);
});

test('B3 Safety 4: mock mode triggers feedback and returns true without disk/IPC', async () => {
    let feedbackCalledWith: string | null = null;
    let storageQueried = false;

    const mockBadge = {
        showLiveSaveFeedback: (title: string) => {
            feedbackCalledWith = title;
        }
    };
    const mockStorage = {
        getLiveConfig: async () => {
            storageQueried = true;
            return { enabledDisk: false, format: 'markdown', includeAssets: true };
        },
        getLiveDirHandle: async () => null,
        setLiveConfig: async () => {}
    };
    const mockScraper = {
        parseDoc: () => historicalFixture(({
            id: 'c_mock_test',
            title: 'Mock Mode Session',
            messages: [{ role: 'user', content: 'hi' }]
        }))
    };

    LiveSaveCoordinator.init({
        badge: mockBadge,
        storageManager: mockStorage,
        scraper: mockScraper,
        clientClass: null
    });

    const success = await LiveSaveCoordinator.executeLiveSave('c_mock_test', 'turn_complete', { mockMode: true });
    assert.strictEqual(success, true);
    assert.strictEqual(feedbackCalledWith, 'Mock Mode Session');
    assert.strictEqual(storageQueried, false, 'Storage config should not be queried in mockMode');
});

test('B3 Safety 5: live-save IPC success delegates and triggers feedback', async () => {
    let sentMessage: any = null;
    let feedbackCalled = false;

    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (msg: any, cb: (res: any) => void) => {
                sentMessage = msg;
                if (cb) cb({ ok: true, handleName: 'TargetVault' });
            }
        }
    };

    try {
        LiveSaveCoordinator.init({
            storageManager: {
                getLiveConfig: async () => ({ enabledDisk: true, format: 'markdown', includeAssets: false }),
                getLiveDirHandle: async () => null,
                setLiveConfig: async () => {}
            },
            scraper: {
                parseDoc: () => historicalFixture(({
                    id: 'c_ipc_01',
                    title: 'IPC Chat',
                    messages: [{ role: 'user', content: 'query' }, { role: 'model', content: 'answer' }]
                }))
            },
            badge: {
                showLiveSaveFeedback: () => { feedbackCalled = true; }
            },
            clientClass: null
        });

        const success = await LiveSaveCoordinator.executeLiveSave('c_ipc_01');
        assert.strictEqual(success, true);
        assert.ok(sentMessage);
        assert.strictEqual(sentMessage.action, 'liveSaveViaHandle');
        assert.strictEqual(sentMessage.payload.safeTitle, 'IPC Chat');
        assert.strictEqual(feedbackCalled, true);
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('B3 Safety 6: partial asset result is treated as saved + warning', async () => {
    let warningCalledWith: string | null = null;

    const origChrome = (global as any).chrome;
    (global as any).chrome = {
        runtime: {
            sendMessage: (_msg: any, cb: (res: any) => void) => {
                if (cb) {
                    cb({
                        ok: false,
                        failedAssets: [{ file: 'failed_image.png', error: 'decode error' }]
                    });
                }
            }
        }
    };

    try {
        LiveSaveCoordinator.init({
            storageManager: {
                getLiveConfig: async () => ({ enabledDisk: true, format: 'markdown', includeAssets: false }),
                getLiveDirHandle: async () => null,
                setLiveConfig: async () => {}
            },
            scraper: {
                parseDoc: () => historicalFixture(({
                    id: 'c_partial_ipc',
                    title: 'Partial IPC Chat',
                    messages: [{ role: 'user', content: 'test' }]
                }))
            },
            badge: {
                showLiveSaveWarning: (msg: string) => { warningCalledWith = msg; }
            },
            clientClass: null
        });

        const success = await LiveSaveCoordinator.executeLiveSave('c_partial_ipc');
        assert.strictEqual(success, true, 'Partial save with failed assets must be treated as saved (true)');
        assert.ok(warningCalledWith !== null);
        assert.ok(warningCalledWith!.includes('部分附件保存失败') || warningCalledWith!.includes('Some attachments failed to save'));
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('B3 Safety 7: permission/directory errors map exactly as expected', async () => {
    const errorCases = [
        { err: 'permission_prompt_needed', expectedFragmentZh: '目录权限待续期', expectedFragmentEn: 'Folder permission degraded' },
        { err: 'permission_not_granted', expectedFragmentZh: '目录权限待续期', expectedFragmentEn: 'Folder permission degraded' },
        { err: 'dir_not_found', expectedFragmentZh: '目标目录已删除', expectedFragmentEn: 'Folder deleted' },
        { err: 'no_dir_handle', expectedFragmentZh: '目录未就绪', expectedFragmentEn: 'Folder not ready' }
    ];

    for (const testCase of errorCases) {
        let warningCalledWith: string | null = null;
        const origChrome = (global as any).chrome;
        (global as any).chrome = {
            runtime: {
                sendMessage: (_msg: any, cb: (res: any) => void) => {
                    if (cb) cb({ ok: false, error: testCase.err });
                }
            }
        };

        try {
            LiveSaveCoordinator.init({
                storageManager: {
                    getLiveConfig: async () => ({ enabledDisk: true, format: 'markdown', includeAssets: false, dirName: 'ConfiguredDir' }),
                    getLiveDirHandle: async () => null,
                    setLiveConfig: async () => {}
                },
                scraper: {
                    parseDoc: () => historicalFixture(({
                        id: 'c_err_test',
                        title: 'Error Test',
                        messages: [{ role: 'user', content: 'ping' }]
                    }))
                },
                badge: {
                    showLiveSaveWarning: (msg: string) => { warningCalledWith = msg; }
                },
                clientClass: null
            });

            const success = await LiveSaveCoordinator.executeLiveSave('c_err_test');
            assert.strictEqual(success, false, `Must return false for ${testCase.err}`);
            assert.ok(warningCalledWith !== null, `Warning badge must be called for ${testCase.err}`);
            assert.ok(
                warningCalledWith!.includes(testCase.expectedFragmentZh) || warningCalledWith!.includes(testCase.expectedFragmentEn),
                `Warning message "${warningCalledWith}" must contain expected text for error ${testCase.err}`
            );
        } finally {
            (global as any).chrome = origChrome;
        }
    }
});

test('B3 Safety 8: failed image download does not rewrite source URL', async () => {
    LiveSaveCoordinator.init({
        assetFetcher: {
            fetchImageBuffer: async () => null // download failure
        }
    });

    const originalUrl = 'https://images.example.com/failed.png';
    interface TestAttachment {
        type?: string;
        src?: string;
        name?: string;
        localName?: string;
    }
    interface TestImage {
        resolvedUrl?: string;
        name?: string;
        localName?: string;
        src?: string;
        url?: string;
    }

    const att8: TestAttachment = { type: 'image', src: originalUrl, name: 'failed.png' };
    const img8: TestImage = { resolvedUrl: originalUrl, name: 'failed.png' };
    const chat = {
        messages: [
            {
                role: 'model',
                content: `Image here: ![my-pic](${originalUrl})`,
                attachments: [att8],
                images: [img8]
            }
        ]
    };
    const failures: Array<{ file: string; error: string }> = [];

    const collected = await LiveSaveCoordinator.processAndSaveImages(historicalFixture(chat), 'c_0123456789fail', null, failures);
    assert.strictEqual(collected.length, 0);
    assert.strictEqual(failures.length, 1);
    assert.ok(failures[0].file.endsWith('.png'));

    // Critical invariant: failed assets must not be rewritten
    assert.ok(chat.messages[0].content.includes(originalUrl));
    assert.strictEqual(chat.messages[0].attachments[0].src, originalUrl);
    assert.strictEqual(chat.messages[0].attachments[0].localName, undefined);
    assert.strictEqual(chat.messages[0].images[0].resolvedUrl, originalUrl);
});

test('B3 Safety 9: successful image save rewrites attachment/image/Markdown paths exactly', async () => {
    let writtenToSubDir = '';
    let writtenFile = '';
    const mockWriter = {
        writeFile: async (subDir: string, fileName: string) => {
            writtenToSubDir = subDir;
            writtenFile = fileName;
        }
    };
    const mockFetcher = {
        fetchImageBuffer: async () => ({
            buffer: Buffer.from('png-bytes-here'),
            ext: 'png',
            mimeType: 'image/png'
        })
    };

    LiveSaveCoordinator.init({ assetFetcher: mockFetcher });

    const photoUrl = 'https://cdn.example.com/photo.jpg';
    interface TestTargetAttachment {
        type?: string;
        src?: string;
        name?: string;
        localName?: string;
    }
    interface TestTargetImage {
        resolvedUrl?: string;
        name?: string;
        localName?: string;
        src?: string;
        url?: string;
    }

    const targetAtt: TestTargetAttachment = { type: 'image', src: photoUrl, name: 'photo.jpg' };
    const targetImg: TestTargetImage = { resolvedUrl: photoUrl, name: 'photo.jpg' };
    const chat = {
        messages: [
            {
                role: 'model',
                content: `Look at this: ![The Photo](${photoUrl})`,
                attachments: [targetAtt],
                images: [targetImg]
            }
        ]
    };
    const failures: Array<{ file: string; error: string }> = [];
    const native = historicalFixture(chat); const before = structuredClone(native.conversation);
    const collected = await LiveSaveCoordinator.processAndSaveImages(native, 'c_9988776655443322', mockWriter, failures);

    assert.strictEqual(collected.length, 1);
    assert.strictEqual(failures.length, 0);
    assert.strictEqual(writtenToSubDir, 'assets');
    assert.ok(writtenFile.startsWith('443322_'));

    const expectedLocal = `assets/${writtenFile}`;
    assert.strictEqual(native.resourceHints[native.conversation.assets[0].id].archivePath, expectedLocal);
    assert.deepStrictEqual(native.conversation, before);
});

test('B3 Safety 10: deterministic image filename behavior and collision handling', async () => {
    const mockFetcher = {
        fetchImageBuffer: async () => ({
            buffer: Buffer.from('img-bytes'),
            ext: 'png',
            mimeType: 'image/png'
        })
    };
    LiveSaveCoordinator.init({ assetFetcher: mockFetcher });

    // Two distinct URLs that share candidateName 'photo.png' in turn 0
    const chat = {
        messages: [
            {
                role: 'model',
                content: 'Two pics',
                attachments: [
                    { type: 'image', src: 'https://ex.com/pic1.png', name: 'my_pic.png' },
                    { type: 'image', src: 'https://ex.com/pic2.png', name: 'my_pic.png' }
                ]
            }
        ]
    };
    const collected = await LiveSaveCoordinator.processAndSaveImages(historicalFixture(chat), 'c_1234567890abcdef', null, []);
    assert.strictEqual(collected.length, 2);
    // cid6 is abcdef, turn 1 => t1
    assert.ok(collected[0].fileName.startsWith('abcdef_t1_my_pic.png'));
    // Second must be deduplicated
    assert.ok(collected[1].fileName.startsWith('abcdef_t1_my_pic_'));
    assert.notStrictEqual(collected[0].fileName, collected[1].fileName);
});

test('B3 Safety 11: bounded concurrency (IMAGE_FETCH_CONCURRENCY = 4) completes all images', async () => {
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    const mockFetcher = {
        fetchImageBuffer: async () => {
            currentConcurrent++;
            if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
            await new Promise((r) => setTimeout(r, 10));
            currentConcurrent--;
            return {
                buffer: Buffer.from('test-image-data'),
                ext: 'png',
                mimeType: 'image/png'
            };
        }
    };
    LiveSaveCoordinator.init({ assetFetcher: mockFetcher });

    const messages = [];
    for (let i = 0; i < 10; i++) {
        messages.push({
            role: 'model',
            content: `![img${i}](https://ex.com/image_${i}.png)`
        });
    }
    const chat = { messages };
    const collected = await LiveSaveCoordinator.processAndSaveImages(historicalFixture(chat), 'c_concurrency123', null, []);

    assert.strictEqual(collected.length, 10);
    assert.ok(maxConcurrent <= 4, `Max concurrency should not exceed 4 (observed: ${maxConcurrent})`);
});

test('B3 Safety 12: arrayBufferToBase64 covers all 5 required input types', () => {
    const rawText = 'Antigravity Batch B3 LiveSaveCoordinator';
    const nodeBuf = Buffer.from(rawText);
    const expectedB64 = nodeBuf.toString('base64');

    // 1. ArrayBuffer
    const ab = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(ab), expectedB64);

    // 2. Uint8Array
    const u8 = new Uint8Array(ab);
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(u8), expectedB64);

    // 3. Non-zero byteOffset view
    const padded = new Uint8Array(u8.length + 8);
    padded.set([1, 2, 3, 4], 0);
    padded.set(u8, 4);
    padded.set([5, 6, 7, 8], 4 + u8.length);
    const offsetView = new Uint8Array(padded.buffer, padded.byteOffset + 4, u8.length);
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(offsetView), expectedB64);

    // 4. Node Buffer (when available)
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(nodeBuf), expectedB64);

    // 5. Unsupported values -> empty string
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(null), '');
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(undefined), '');
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64(12345), '');
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64('some-string'), '');
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64({}), '');
    assert.strictEqual(LiveSaveCoordinator.arrayBufferToBase64([]), '');
});

test('B3 Safety 13: direct directory path calls export completion with title/timestamp/failure data', async () => {
    let completionInput: any = null;
    let savedConfig: any = null;

    class TestWriter {
        async init() {}
        async writeFile() {}
    }

    LiveSaveCoordinator.init({
        storageManager: {
            getLiveConfig: async () => ({ enabledDisk: true, format: 'markdown', includeAssets: false }),
            getLiveDirHandle: async () => ({ name: 'DirVault' }),
            setLiveConfig: async (cfg: any) => { savedConfig = cfg; }
        },
        scraper: {
            parseDoc: () => historicalFixture(({
                id: 'c_completion_test',
                title: 'Export Record Complete Test',
                titleSource: 'dom',
                titles: { dom: 'Export Record Complete Test' },
                messages: [{ role: 'user', content: 'test msg' }],
                timestamp: 1715000000000
            }))
        },
        completeExport: async (_records: any, _slot: string, input: any) => {
            completionInput = input;
            return null;
        },
        fsWriterClass: TestWriter,
        clientClass: null,
        badge: { showLiveSaveFeedback: () => {} }
    });

    const success = await LiveSaveCoordinator.executeLiveSave('c_completion_test');
    assert.strictEqual(success, true);
    assert.ok(completionInput);
    assert.strictEqual(completionInput.conversationId, 'completion_test');
    assert.strictEqual(completionInput.titleCandidate, 'Export Record Complete Test');
    assert.strictEqual(completionInput.titleProvenance, 'dom');
    assert.strictEqual(completionInput.format, 'markdown');
    assert.ok(savedConfig);
    assert.strictEqual(savedConfig.lastSavedTitle, 'Export Record Complete Test');
    assert.ok(typeof savedConfig.lastSavedAt === 'number');
});

test('B3 Safety 14: queue serialization and survival of prior rejection', async () => {
    const executionOrder: string[] = [];
    let shouldRejectFirst = true;

    class DelayedWriter {
        async init() {}
        async writeFile() {
            if (shouldRejectFirst) {
                shouldRejectFirst = false;
                executionOrder.push('first_rejected');
                throw new Error('Forced failure on first write');
            }
            executionOrder.push('second_succeeded');
        }
    }

    LiveSaveCoordinator.init({
        storageManager: {
            getLiveConfig: async () => ({ enabledDisk: true, format: 'markdown', includeAssets: false }),
            getLiveDirHandle: async () => ({ name: 'Vault' }),
            setLiveConfig: async () => {}
        },
        scraper: {
            parseDoc: (_doc: any, id: string) => historicalFixture(({
                id,
                title: `Chat ${id}`,
                messages: [{ role: 'user', content: `content ${id}` }]
            }))
        },
        fsWriterClass: DelayedWriter,
        clientClass: null,
        badge: { showLiveSaveFeedback: () => {} }
    });

    // Launch both saves concurrently
    const p1 = LiveSaveCoordinator.executeLiveSave('c_queued_01');
    const p2 = LiveSaveCoordinator.executeLiveSave('c_queued_02');

    const res1 = await p1;
    const res2 = await p2;

    assert.strictEqual(res1, false, 'First save should fail due to forced error');
    assert.strictEqual(res2, true, 'Second save must execute and succeed despite first rejection (queue survives)');
    assert.deepStrictEqual(executionOrder, ['first_rejected', 'second_succeeded']);
    assert.strictEqual(LiveSaveCoordinator.isCurrentlySaving(), false, '_isSaving must reset to false');
});
