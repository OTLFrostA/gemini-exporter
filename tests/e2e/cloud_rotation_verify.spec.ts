import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, launchExtensionContext, seedRegistryAccounts } from './fixtures';
import { accountId, openOptions } from './uiFixture';
import { createMockCloudVaultHttp } from '../helpers/mockCloudVaultHttp';

const origin = 'https://vault.rotation.test';
const title = 'Conversation before rotation';

async function openCloud(page: Page): Promise<void> {
    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnVaultTabCloud').click();
}

async function generateAndConfirm(page: Page): Promise<string> {
    await page.locator('#btnGenerateOneTimeKey').click();
    const display = page.locator('#cloudRecoveryKeyDisplay');
    await expect(display).toBeVisible();
    const key = await display.inputValue();
    await page.locator('#btnConfirmOneTimeKey').click();
    return key;
}

async function connectWithKey(page: Page, key: string): Promise<void> {
    await openCloud(page);
    await page.locator('#cloudImportKeyInput').fill(key);
    await page.locator('#btnCloudImportKey').click();
    await page.locator('#cloudServerUrlInput').fill(origin);
    await page.locator('#btnCloudConnect').click();
}

async function activeVaultOwner(page: Page): Promise<string> {
    return page.evaluate(() => new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('gemini_exporter_cloud_v2');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const read = db.transaction('session').objectStore('session').get('active');
            read.onerror = () => reject(read.error);
            read.onsuccess = () => {
                db.close();
                resolve(read.result.ownerSubject);
            };
        };
    }));
}

for (const scenario of ['write failure', 'corrupt read-back', 'invalid cursor', 'verified backup', 'local deletion', 'paired upload'] as const) {
    test(`Cloud Vault rotation: ${scenario}`, async ({ context, extensionId }) => {
        const server = createMockCloudVaultHttp();
        await seedRegistryAccounts(context);
        const page = await openOptions(context, extensionId);
        let oldOwner = '';
        let rotating = false;
        let uploaded = 0;
        let uploadFromPeer: (() => Promise<void>) | undefined;
        const oldStillActiveAtWrites: boolean[] = [];
        const oldStillActiveAtReads: boolean[] = [];
        const candidatePaths = new Set<string>();
        const routeVault = (browser: BrowserContext) => browser.route(`${origin}/**`, async route => {
            const req = route.request();
            const { pathname } = new URL(req.url());
            const isCandidateWrite = rotating && browser === context && req.method() === 'PUT';
            const isCandidateRead = rotating && browser === context && req.method() === 'GET' && candidatePaths.has(pathname);
            if (isCandidateWrite) {
                oldStillActiveAtWrites.push(await activeVaultOwner(page) === oldOwner);
                if (uploaded === 0) await uploadFromPeer?.();
                if (scenario === 'write failure' && uploaded === 1) {
                    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Write unavailable"}' });
                    return;
                }
            }
            if (isCandidateRead) oldStillActiveAtReads.push(await activeVaultOwner(page) === oldOwner);
            const body = req.postDataBuffer();
            const response = await server.handler(new Request(req.url(), {
                method: req.method(), headers: req.headers(), ...(body ? { body: new Uint8Array(body) } : {}),
            }));
            if (isCandidateWrite && response.ok) {
                uploaded += 1;
                candidatePaths.add(pathname);
            }
            let responseBody = Buffer.from(await response.arrayBuffer());
            if (scenario === 'invalid cursor' && rotating && browser === context && uploaded === 2
                && req.method() === 'GET' && pathname === '/v2/vault/changes') {
                responseBody = Buffer.from(JSON.stringify({ ...JSON.parse(responseBody.toString()), nextSince: 0.5 }));
            }
            if (isCandidateRead && scenario === 'corrupt read-back') {
                responseBody[responseBody.length - 1] ^= 1;
            }
            await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: responseBody });
        });
        await routeVault(context);
        await openCloud(page);
        const oldKey = await generateAndConfirm(page);
        await page.locator('#cloudServerUrlInput').fill(origin);
        await page.locator('#btnCloudConnect').click();
        await expect(page.locator('#cloudSyncToggle')).toBeChecked();
        await page.evaluate(async ({ id, title }) => {
            await Reflect.get(globalThis, 'uiFixture').ingestIndexes(id, [1, 2].map(i => ({
                conversationId: `rotation-audit-${i}`,
                fields: { title: `${title} ${i}`, titleSource: 'provider', updatedAt: Date.now() + 5000 },
            })));
        }, { id: accountId, title });
        await page.locator('#btnCloudSyncNow').click();
        await expect.poll(() => server.inspectRawBlobs().size).toBe(2);
        if (scenario === 'local deletion') {
            await expect(page.locator('#btnCloudSyncNow')).toBeEnabled();
            await page.locator('#btnCloudSyncNow').click();
            await expect(page.locator('#btnCloudSyncNow')).toBeEnabled();
            await page.evaluate(async id => {
                await Reflect.get(globalThis, 'uiFixture').ingestDeletedConversation(id, 'rotation-audit-1');
            }, accountId);
            await page.evaluate(() => window.dispatchEvent(new Event('focus')));
            await expect(page.locator('#list')).not.toContainText(`${title} 1`);
            await expect(page.locator('#list')).toContainText(`${title} 2`);
            expect(server.inspectRawBlobs().size).toBe(2);
        }
        oldOwner = await activeVaultOwner(page);

        if (scenario === 'paired upload') {
            const peer = await launchExtensionContext();
            try {
                await routeVault(peer);
                await seedRegistryAccounts(peer);
                const paired = await openOptions(peer, extensionId);
                await connectWithKey(paired, oldKey);
                await expect(paired.locator('#list')).toContainText(`${title} 1`);
                uploadFromPeer = async () => {
                    await paired.evaluate(async id => {
                        await Reflect.get(globalThis, 'uiFixture').ingestIndexes(id, [{
                            conversationId: 'rotation-audit-3',
                            fields: { title: 'Uploaded by paired browser', titleSource: 'provider', updatedAt: Date.now() + 5000 },
                        }]);
                    }, accountId);
                    await paired.locator('#btnCloudSyncNow').click();
                    await expect.poll(() => server.inspectRawBlobs().size).toBe(3);
                };
                rotating = true;
                await page.locator('#btnToggleRekey').click();
                await generateAndConfirm(page);
                await expect.poll(() => oldStillActiveAtReads.length).toBe(2);
                await expect(page.locator('#btnCloudSyncNow')).toBeEnabled();
                expect.soft(await activeVaultOwner(page)).toBe(oldOwner);
                await expect(page.locator('#cloudModalFeedback')).toHaveAttribute('data-error', 'true');
                rotating = false;
                await page.locator('#btnCloudSyncNow').click();
                await expect(page.locator('#list')).toContainText('Uploaded by paired browser');
            } finally {
                await peer.close();
            }
            return;
        }

        rotating = true;
        await page.locator('#btnToggleRekey').click();
        const newKey = await generateAndConfirm(page);
        await expect.poll(() => oldStillActiveAtWrites.length).toBeGreaterThan(0);
        await expect(page.locator('#btnCloudSyncNow')).toBeEnabled();
        const feedback = page.locator('#cloudModalFeedback');
        const expectedSaved = scenario === 'local deletion' ? 1 : 2;
        const expectedReads = scenario === 'write failure' || scenario === 'invalid cursor' ? 0
            : scenario === 'corrupt read-back' ? 1 : expectedSaved;
        const failed = scenario === 'write failure' || scenario === 'invalid cursor' || scenario === 'corrupt read-back';
        expect.soft(oldStillActiveAtWrites).toEqual(Array(expectedSaved).fill(true));
        expect.soft(oldStillActiveAtReads).toEqual(Array(expectedReads).fill(true));
        expect.soft(uploaded).toBe(scenario === 'write failure' ? 1 : expectedSaved);
        expect.soft(await activeVaultOwner(page) === oldOwner).toBe(failed);
        if (failed) {
            await expect(feedback).toHaveAttribute('data-error', 'true');
            await expect(feedback).not.toContainText('Rotated to new Master Key');
            return;
        }

        await expect(feedback).toContainText('Rotated to new Master Key');
        await expect(feedback).toContainText(`Saved ${expectedSaved}`);
        if (scenario === 'local deletion') await expect(page.locator('#list')).not.toContainText(`${title} 1`);
        const peer = await launchExtensionContext();
        try {
            await routeVault(peer);
            await seedRegistryAccounts(peer);
            const restored = await openOptions(peer, extensionId);
            await expect(restored.locator('#list .item')).toHaveCount(0);
            await connectWithKey(restored, newKey);
            await expect(restored.locator('#list')).toContainText(`${title} 2`);
            if (scenario === 'local deletion') {
                await expect(restored.locator('#list')).not.toContainText(`${title} 1`);
            } else {
                await expect(restored.locator('#list')).toContainText(`${title} 1`);
            }
        } finally {
            await peer.close();
        }
    });
}
