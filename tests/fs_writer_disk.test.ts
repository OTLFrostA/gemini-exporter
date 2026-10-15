export {};
const test = require('node:test');
const assert = require('node:assert');

const { FsWriter } = require('../src/core/engine/writers/fsWriter.js');

// FsWriter owns the folder, relative-path routing, writable lifecycle and bytes.
// Conversation filename selection/cid6 is an upstream contract covered by
// buildExportFileName tests; recomputing cid6 here would only test the fixture.
test('fsWriter - writes supplied conversation and asset paths under export folder', async () => {
    const written: Record<string, unknown> = {};
    let closeCount = 0;
    const mockDir = {
        name: 'MyVault',
        getDirectoryHandle: async (folder: string) => ({
            name: folder,
            getFileHandle: async (file: string) => ({
                createWritable: async () => ({
                    write: async (content: any) => { written[`${folder}/${file}`] = content; },
                    close: async () => { closeCount++; },
                    abort: async () => {}
                })
            }),
            getDirectoryHandle: async (subFolder: string) => ({
                name: subFolder,
                getFileHandle: async (assetFile: string) => ({
                    createWritable: async () => ({
                        write: async (content: any) => { written[`${folder}/${subFolder}/${assetFile}`] = content; },
                        close: async () => { closeCount++; },
                        abort: async () => {}
                    })
                })
            })
        })
    };

    const writer = new FsWriter(mockDir, 'gemini_export');
    await writer.init();

    const markdown = '# Quantum Computing\n\nContent';
    const imageBytes = new Uint8Array([1, 2, 3]);
    const markdownReceipt = await writer.writeFile('Quantum Computing_abcdef.md', markdown);
    const assetReceipt = await writer.writeFile('assets/abcdef_t1_img1.png', imageBytes);

    assert.strictEqual(markdownReceipt, 'Quantum Computing_abcdef.md');
    assert.strictEqual(assetReceipt, 'assets/abcdef_t1_img1.png');
    assert.deepStrictEqual(Object.keys(written).sort(), [
        'gemini_export/Quantum Computing_abcdef.md',
        'gemini_export/assets/abcdef_t1_img1.png',
    ].sort());
    assert.strictEqual(written['gemini_export/Quantum Computing_abcdef.md'], markdown);
    assert.deepStrictEqual(written['gemini_export/assets/abcdef_t1_img1.png'], imageBytes);
    assert.strictEqual(closeCount, 2, 'both successful writes must close their file handles');
});

test('fsWriter - invokes abort() on writable when write operation fails', async () => {
    let abortCalled = false;
    let closeCalled = false;
    const mockDir = {
        name: 'MyVault',
        getDirectoryHandle: async () => ({
            getFileHandle: async () => ({
                createWritable: async () => ({
                    write: async () => {
                        throw new Error('Simulated disk full during write');
                    },
                    close: async () => { closeCalled = true; },
                    abort: async () => { abortCalled = true; }
                })
            })
        })
    };

    const writer = new FsWriter(mockDir, 'gemini_export');
    await writer.init();

    await assert.rejects(
        writer.writeFile('broken.md', 'some content'),
        /Simulated disk full during write/
    );

    assert.strictEqual(abortCalled, true, 'abort() must be called when write throws');
    assert.strictEqual(closeCalled, false, 'close() must not be called when write throws');
});

