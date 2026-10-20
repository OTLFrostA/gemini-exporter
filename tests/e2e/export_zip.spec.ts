// Full browser integration against the v2 storage/Domain/Document/Packaging pipeline.
// L1 network parsing has separate source integration coverage; this isolates actual delivery.
import { test, expect, seedRegistryAccounts } from './fixtures';
import { openOptions, seedConversations, accountId } from './uiFixture';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const JSZip = require(path.resolve(__dirname, '../../lib/jszip.min.js'));
test.beforeEach(async ({ context }) => { await seedRegistryAccounts(context); });

test('v2 Workbench exports two Domain conversations as a real ZIP and commits separate records', async ({ context, extensionId }) => {
    const page = await openOptions(context, extensionId);
    const question = '请解释一下深度学习中的反向传播算法。';
    const answer = '反向传播（Backpropagation）是训练神经网络的核心算法，通过链式法则计算梯度。';
    await seedConversations(page, [
        { id: 'real_exp_001', title: '深度学习反向传播算法详解', question, body: answer },
        { id: 'real_exp_002', title: 'A separate conversation', body: 'A distinct answer for the archive' },
    ]);
    await page.locator('#btnSelectAll').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/);
    const zip = await JSZip.loadAsync(await readFile((await download.path())!));
    const entries: string[] = Object.keys(zip.files).filter(name => name.endsWith('.md'));
    expect(entries).toHaveLength(2);
    const contents: string[] = await Promise.all(entries.map(name => zip.file(name).async('string')));
    const joined = contents.join('\n');
    expect(joined).toContain('深度学习反向传播算法详解');
    expect(joined).toContain(question);
    expect(joined).toContain(answer);
    expect(joined).toContain('A distinct answer for the archive');
    await expect.poll(() => page.evaluate(async id => {
        const api = Reflect.get(globalThis, 'uiFixture');
        return Promise.all(['real_exp_001', 'real_exp_002'].map(conversationId =>
            api.getExportRecord({ accountId: id, conversationId }).then((value: { status?: string } | null) => value?.status)));
    }, accountId)).toEqual(['ok', 'ok']);
    await page.close();
});
