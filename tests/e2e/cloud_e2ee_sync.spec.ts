import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, launchExtensionContext, seedRegistryAccounts } from './fixtures';
import { accountId, openOptions } from './uiFixture';
import { createMockCloudVaultHttp } from '../helpers/mockCloudVaultHttp';

const VAULT_ORIGIN = 'https://vault.example.test';
const SERVER_INVITE_CODE = 'my-private-vault-2026';

async function generateAndLockKey(page: Page): Promise<string> {
    await page.locator('#btnGenerateOneTimeKey').click();
    const display = page.locator('#cloudRecoveryKeyDisplay');
    await expect(display).toHaveValue(/^GEK1(?:-[0-9A-Z]{5}){11}$/);
    const key = await display.inputValue();
    await page.locator('#btnConfirmOneTimeKey').click();
    await expect(page.locator('#vaultKeyLockedRow')).toBeVisible();
    await expect(display).toHaveValue('');
    return key;
}

async function notifyOptionsOfCommit(context: BrowserContext, extensionId: string): Promise<void> {
    const sender = await context.newPage();
    try {
        await sender.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
        await sender.evaluate(id => chrome.runtime.sendMessage({ action: 'domainChanged', accountId: id }).catch(() => {}), accountId);
    } finally { await sender.close(); }
}

test('Vault Options status does not load stored CryptoKey handles', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const setupPage = await openOptions(context, extensionId);
    await setupPage.locator('#btnCloudVaultSetup').click();
    await setupPage.locator('#btnGenerateOneTimeKey').click();
    await setupPage.locator('#btnConfirmOneTimeKey').click();
    const label = setupPage.locator('#vaultKeyFingerprintLabel');
    await expect(label).toContainText(/#[0-9a-f]{8}/);
    const fingerprintLabel = await label.innerText();
    await setupPage.close();

    await context.addInitScript(() => {
        if (location.protocol !== 'chrome-extension:') return;
        const get = IDBObjectStore.prototype.get;
        let keyringReads = 0;
        IDBObjectStore.prototype.get = function (query) {
            if (this.name === 'localKeys') keyringReads++;
            return get.call(this, query);
        };
        Object.defineProperty(window, 'vaultKeyringReads', { get: () => keyringReads });
    });
    const page = await openOptions(context, extensionId);
    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#vaultKeyLockedRow')).toBeVisible();
    await expect(page.locator('#vaultKeyFingerprintLabel')).toHaveText(fingerprintLabel);
    expect(await page.evaluate(() => Reflect.get(window, 'vaultKeyringReads'))).toBe(0);
});

test('Local vault reports Restored 0 when an older index-only record loses to local facts', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);
    await page.locator('#btnCloudVaultSetup').click();
    const recoveryKey = await generateAndLockKey(page);
    const seed = await build({
        stdin: { resolveDir: process.cwd(), loader: 'ts', contents: `
            import { deriveVaultKeyring, parseRecoveryKey } from './src/shared/crypto/index.ts';
            import { sealCloudConversation } from './src/application/cloud/cloudArchiveCodec.ts';
            import { createLocalFolderVaultClient } from './src/l1/cloud/localFolderVaultClient.ts';
            import { getAccount } from './src/l3a/storageService.ts';
            globalThis.seedStaleVault = async (accountId, recoveryKey) => {
                const proto = FileSystemDirectoryHandle.prototype;
                proto.queryPermission = async () => 'granted';
                proto.requestPermission = async () => 'granted';
                const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('StaleIndexVault', { create: true });
                Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
                const account = await getAccount(accountId);
                const keyring = await deriveVaultKeyring(await parseRecoveryKey(recoveryKey));
                const sealed = await sealCloudConversation({ keyring, revision: 1, account,
                    conversation: { index: { key: { accountId, conversationId: 'stale-index' }, title: 'Retained local conversation', titleSource: 'provider', updatedAt: 100 } } });
                const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', sealed.envelope));
                const sha256 = Array.from(digest, x => x.toString(16).padStart(2, '0')).join('');
                await createLocalFolderVaultClient(async () => root).putEncryptedRecord({ serverUrl: '', sessionToken: '',
                    blindRecordId: sealed.blindRecordId, expectedRevision: 0, envelope: sealed.envelope, sha256, keyFingerprint: keyring.keyFingerprint });
            };
        ` }, bundle: true, write: false, format: 'iife', platform: 'browser',
    });
    await page.evaluate(seed.outputFiles[0].text);
    await page.evaluate(async ({ accountId, recoveryKey }) => {
        await Reflect.get(globalThis, 'seedStaleVault')(accountId, recoveryKey);
        await Reflect.get(globalThis, 'uiFixture').ingestIndexes(accountId, [{ conversationId: 'stale-index',
            fields: { title: 'Retained local conversation', titleSource: 'provider', updatedAt: 200 } }]);
    }, { accountId, recoveryKey });
    await page.locator('#btnLocalVaultPick').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Restored');
    if (process.env.CLOUD_RESTORE_SCREENSHOT) {
        await page.screenshot({ path: process.env.CLOUD_RESTORE_SCREENSHOT, fullPage: true });
    }
    await expect(page.locator('#cloudModalFeedback')).toContainText('Restored 0');
    expect(await page.evaluate(async id => (await Reflect.get(globalThis, 'uiFixture').getIndex({ accountId: id, conversationId: 'stale-index' })).updatedAt, accountId)).toBe(200);
});

test('Cloud Vault displays the key once, pairs isolated profiles manually, and syncs encrypted changes both ways', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);

    // 1. Boot mock zero-knowledge Cloud Vault HTTP contract double
    const serverStore = createMockCloudVaultHttp({
        serverAccessCode: SERVER_INVITE_CODE,
    });
    const serverHandler = serverStore.handler;
    let serveStaleRevision = false;

    const authRequests: { mode?: string; rawKeyInRequest: boolean }[] = [];
    const routeVault = (browser: BrowserContext) => browser.route(`${VAULT_ORIGIN}/**`, async route => {
        const req = route.request();
        const postBuffer = req.postDataBuffer();
        const webReq = new Request(req.url(), {
            method: req.method(),
            headers: req.headers(),
            ...(postBuffer ? { body: new Uint8Array(postBuffer) } : {}),
        });
        if (req.method() === 'POST' && new URL(req.url()).pathname === '/v2/auth/key') {
            const contents = req.postData() ?? '';
            const body = JSON.parse(contents) as { mode?: string };
            authRequests.push({ mode: body.mode, rawKeyInRequest: /GEK1-[A-Z0-9]{5}/i.test(contents) });
        }
        let webRes = await serverHandler(webReq);
        if (serveStaleRevision && req.method() === 'GET' && new URL(req.url()).pathname === '/v2/vault/changes') {
            const feed = await webRes.json();
            for (const item of feed.items) item.revision++;
            webRes = Response.json(feed, { headers: webRes.headers });
        }
        const resBuffer = Buffer.from(await webRes.arrayBuffer());
        const headersObj: Record<string, string> = {};
        webRes.headers.forEach((v, k) => { headersObj[k] = v; });
        await route.fulfill({
            status: webRes.status,
            headers: headersObj,
            body: resBuffer,
        });
    });
    await routeVault(context);

    const page = await openOptions(context, extensionId);

    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#cloudVaultModal')).toBeVisible();
    await page.locator('#btnVaultTabCloud').click();
    await expect(page.locator('#btnCloudConnect')).toBeDisabled();
    await page.locator('#btnGenerateOneTimeKey').click();
    await expect(page.locator('#cloudRecoveryKeyDisplay')).toHaveValue(/^GEK1-/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#cloudVaultModal')).toBeHidden();
    await expect(page.locator('#cloudRecoveryKeyDisplay')).toHaveValue('');
    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#btnCloudConnect')).toBeDisabled();
    const savedRecoveryKey = await generateAndLockKey(page);
    const custody = await page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open('gemini_exporter_cloud_v2');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
                const request = db.transaction('localKeys').objectStore('localKeys').getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
            const handles = Object.values(rows[0] ?? {}).filter((value): value is CryptoKey => value instanceof CryptoKey);
            const blockedExports = await Promise.all(handles.map(key => crypto.subtle.exportKey('raw', key).then(() => false, () => true)));
            const sync = await chrome.storage.sync.get(null);
            return { rowCount: rows.length, blockedExports, plaintext: /GEK1-/i.test(JSON.stringify([rows, sync])) };
        } finally { db.close(); }
    });
    expect(custody).toEqual({ rowCount: 1, blockedExports: [true, true, true], plaintext: false });

    await expect(page.locator('#btnCloudConnect')).toContainText('Create & Connect Cloud Vault');
    await expect(page.locator('#btnCloudCreateRemoteVault')).toBeHidden();
    await page.locator('#cloudServerUrlInput').fill(VAULT_ORIGIN);
    await page.locator('#cloudAccessCodeInput').fill('wrong-passcode');
    await page.locator('#btnCloudConnect').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('access code');
    expect(serverStore.inspectTenantCount()).toBe(0);

    await page.locator('#cloudAccessCodeInput').fill(SERVER_INVITE_CODE);
    await page.locator('#btnCloudConnect').click();

    await expect(page.locator('#cloudConnectedTarget')).toContainText('vault.example.test');
    await expect(page.locator('#cloudSyncToggle')).toBeChecked();
    await expect(page.locator('#cloudIncludeDetailRow')).toBeHidden();
    // Enable full-body flag via internal settings API for this Markdown body round-trip assertion while UI keeps it hidden
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.updateSettings({ cloudSyncIncludeDetail: true });
    });

    await expect(page.locator('#cloudRecoveryKeyDisplay')).toHaveValue('');
    await page.locator('#btnCloudModalClose').click();

    // 3. Ingest a new conversation AFTER enabling the switch and broadcast domainChanged -> must automatically encrypt & upload!
    const secretMarker = 'TOP-SECRET-E2EE-PAYLOAD-MARKER-88412';
    const secretTitle = 'Zero-Knowledge Relativistic Derivation';
    const postSwitchTime = Date.now() + 5000;
    await page.evaluate(async ({ accountId, secretMarker, secretTitle, postSwitchTime }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestDetail(accountId, 'c_live_e2ee_auto', {
            savedAt: postSwitchTime,
            quality: { status: 'complete', sourceTurn: 'finished' },
            assets: [],
            messages: [
                { role: 'user', content: [{ type: 'paragraph', children: [{ type: 'text', text: 'State the secret invariant.' }] }] },
                { role: 'assistant', content: [{ type: 'paragraph', children: [{ type: 'text', text: secretMarker }] }] },
            ],
        }, { title: secretTitle, titleSource: 'provider', updatedAt: postSwitchTime });
    }, { accountId, secretMarker, secretTitle, postSwitchTime });
    await notifyOptionsOfCommit(context, extensionId);

    // Wait for automatic background E2EE push to land on the Cloud Vault server
    await expect.poll(() => serverStore.inspectRawBlobs().size, { timeout: 10000 }).toBe(1);

    // 4. Audit server's raw stored bytes: must carry GEE1 header and leak ZERO plaintext/metadata!
    const [storedKey, storedBytes] = [...serverStore.inspectRawBlobs().entries()][0]!;
    expect(Array.from(storedBytes.slice(0, 4))).toEqual([0x47, 0x45, 0x45, 0x31]); // "GEE1"
    const rawServerDump = storedKey + '::' + new TextDecoder('latin1').decode(storedBytes);
    for (const forbidden of [secretMarker, secretTitle, 'c_live_e2ee_auto', 'gemini']) {
        expect(rawServerDump).not.toContain(forbidden);
    }

    const peer = await launchExtensionContext();
    try {
        await routeVault(peer);
        await seedRegistryAccounts(peer);
        const other = await openOptions(peer, extensionId);
        await expect(other.locator('#list .item')).toHaveCount(0);
        await other.locator('#btnCloudVaultSetup').click();
        await other.locator('#btnVaultTabCloud').click();
        await expect(other.locator('#btnCloudConnect')).toBeDisabled();

        // Generate an uncreated offline key and import it as 'imported': Unlock probe returns 404 without creating a tenant, then reveals explicit Create option
        await other.locator('#btnGenerateOneTimeKey').click();
        await expect(other.locator('#cloudRecoveryKeyDisplay')).toHaveValue(/^GEK1(?:-[0-9A-Z]{5}){11}$/);
        const uncreatedOfflineKey = await other.locator('#cloudRecoveryKeyDisplay').inputValue();
        await other.keyboard.press('Escape');
        await other.locator('#btnCloudVaultSetup').click();
        await other.locator('#btnVaultTabCloud').click();
        await other.locator('#cloudImportKeyInput').fill(uncreatedOfflineKey);
        await other.locator('#btnCloudImportKey').click();
        await expect(other.locator('#btnCloudConnect')).toContainText('Unlock Existing Cloud Vault');
        await expect(other.locator('#btnCloudCreateRemoteVault')).toBeHidden();
        await other.locator('#cloudServerUrlInput').fill(VAULT_ORIGIN);
        await other.locator('#cloudAccessCodeInput').fill(SERVER_INVITE_CODE);
        await other.locator('#btnCloudConnect').click();
        await expect(other.locator('#cloudModalFeedback')).toContainText(/No existing vault|matches this Master Key/i);
        await expect(other.locator('#btnCloudCreateRemoteVault')).toBeVisible();
        expect(serverStore.inspectTenantCount()).toBe(1);

        // Now switch to Browser A's real Master Key and unlock!
        await other.locator('#btnToggleRekey').click();
        await other.locator('#cloudImportKeyInput').fill(savedRecoveryKey);
        await other.locator('#btnCloudImportKey').click();
        await expect(other.locator('#cloudImportKeyInput')).toHaveValue('');
        await expect(other.locator('#cloudRecoveryKeyDisplay')).toHaveValue('');
        await expect(other.locator('#btnCloudCreateRemoteVault')).toBeHidden();
        serveStaleRevision = true;
        await other.locator('#btnCloudConnect').click();
        await expect(other.locator('#cloudModalFeedback')).toContainText('Could not reach the Cloud Vault server');
        await expect(other.locator('#list .item')).toHaveCount(0);
        serveStaleRevision = false;
        await other.locator('#btnCloudSyncNow').click();
        await expect(other.locator('#cloudModalFeedback')).toContainText('Restored 1');
        await other.locator('#btnCloudModalClose').click();

        await expect(other.locator('#list .item')).toHaveCount(1);
        await expect(other.locator('#list')).toContainText(secretTitle);
        await other.locator('#btnSelectAll').click();
        const downloadPromise = other.waitForEvent('download');
        await other.locator('#btnExport').click();
        const exportedMd = await readFile((await (await downloadPromise).path())!, 'utf8');
        expect(exportedMd).toContain(secretTitle);
        expect(exportedMd).toContain('State the secret invariant.');
        expect(exportedMd).toContain(secretMarker);

        // Browser B authors another conversation. The enabled outbox uploads it without manually syncing B.
        await other.evaluate(async id => {
            const api = Reflect.get(globalThis, 'uiFixture');
            await api.ingestIndexes(id, [{
                conversationId: 'c_second_profile',
                fields: { title: 'From the paired browser', titleSource: 'provider', updatedAt: Date.now() + 5000 },
            }]);
        }, accountId);
        await notifyOptionsOfCommit(peer, extensionId);
        await expect.poll(() => serverStore.inspectRawBlobs().size).toBe(2);
        await page.locator('#btnCloudVaultSetup').click();
        await page.locator('#btnCloudSyncNow').click();
        await page.locator('#btnCloudModalClose').click();
        await expect(page.locator('#list')).toContainText('From the paired browser');
        expect(serverStore.inspectTenantCount()).toBe(1);

        // Connected one-step Key Rotation: click Change Key -> Generate Random Key while connected -> rotates & re-backs up both chats!
        await page.locator('#btnCloudVaultSetup').click();
        await page.locator('#btnToggleRekey').click();
        await expect(page.locator('#btnGenerateOneTimeKey')).toBeVisible();
        await generateAndLockKey(page);
        await expect(page.locator('#cloudModalFeedback')).toContainText('Rotated to new Master Key');
        await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 2');
        expect(serverStore.inspectTenantCount()).toBe(2);
        expect(authRequests.map(entry => entry.mode)).toEqual(['create', 'create', 'unlock', 'unlock', 'create']);
        expect(authRequests.some(entry => entry.rawKeyInRequest)).toBe(false);
    } finally {
        await peer.close();
    }
});

test('Options Sync Now preserves a same-conversation update queued by the background worker during PUT', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const server = createMockCloudVaultHttp({ serverAccessCode: SERVER_INVITE_CODE });
    const putRevisions: string[] = [];
    let releaseFirstPut!: () => void;
    const firstPutGate = new Promise<void>(resolve => { releaseFirstPut = resolve; });
    await context.route(`${VAULT_ORIGIN}/**`, async route => {
        const req = route.request();
        if (req.method() === 'PUT') {
            putRevisions.push(req.headers()['x-expected-revision'] ?? '');
            if (putRevisions.length === 1) await firstPutGate;
        }
        const body = req.postDataBuffer();
        const response = await server.handler(new Request(req.url(), {
            method: req.method(),
            headers: req.headers(),
            ...(body ? { body: new Uint8Array(body) } : {}),
        }));
        await route.fulfill({
            status: response.status,
            headers: Object.fromEntries(response.headers),
            body: Buffer.from(await response.arrayBuffer()),
        });
    });
    const sourceUrl = 'https://gemini.google.com/app/ace01234';
    await context.route(sourceUrl, route => route.fulfill({ contentType: 'text/html', body: '<title>Gemini</title>' }));
    const source = await context.newPage();
    await source.goto(sourceUrl);
    const page = await openOptions(context, extensionId);
    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnVaultTabCloud').click();
    await generateAndLockKey(page);
    await page.locator('#cloudServerUrlInput').fill(VAULT_ORIGIN);
    await page.locator('#cloudAccessCodeInput').fill(SERVER_INVITE_CODE);
    await page.locator('#btnCloudConnect').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 0');

    const original = {
        conversationId: 'c_outbox_ipc_race',
        fields: { title: 'Original title', titleSource: 'provider', updatedAt: Date.now() },
    };
    await page.evaluate(async ({ accountId, original }) => {
        await Reflect.get(globalThis, 'uiFixture').ingestIndexes(accountId, [original]);
    }, { accountId, original });

    try {
        await page.locator('#btnCloudSyncNow').click();
        await expect.poll(() => putRevisions).toEqual(['0']);

        // Send the passive ingestion IPC from a real, authorized Gemini tab.
        const response = await page.evaluate(async ({ accountId, original, sourceUrl }) => {
            const [tab] = await chrome.tabs.query({ url: sourceUrl });
            if (tab?.id === undefined) throw new Error('Missing Gemini source tab');
            const [injection] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (id, item) => chrome.runtime.sendMessage({ action: 'domainIngest', accountId: id, operation: 'indexes', items: [item] }),
                args: [accountId, {
                    ...original,
                    fields: { ...original.fields, title: 'New title', updatedAt: original.fields.updatedAt + 1 },
                }],
            });
            return injection.result;
        }, { accountId, original, sourceUrl });
        expect(response).toMatchObject({ ok: true });

        // The worker requests this lock only after its outbox enqueue transaction commits.
        await expect.poll(() => page.evaluate(async () => {
            const { held, pending } = await navigator.locks.query();
            const lock = 'gemini_exporter_cloud_sync_op_lock';
            return held?.some(entry => entry.name === lock) && pending?.some(entry => entry.name === lock);
        })).toBe(true);
        expect(putRevisions).toEqual(['0']);
    } finally {
        releaseFirstPut();
    }

    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 2');
    await expect.poll(() => page.evaluate(async () => {
        const { held, pending } = await navigator.locks.query();
        return [...(held ?? []), ...(pending ?? [])].some(entry => entry.name === 'gemini_exporter_cloud_sync_op_lock');
    })).toBe(false);
    expect(putRevisions).toEqual(['0', '1']);
    expect([...server.inspectRawBlobs().keys()]).toEqual([expect.stringMatching(/\/r2$/)]);
});

test('Cloud Vault access code stays out of storage that Gemini content scripts can read', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const server = createMockCloudVaultHttp({ serverAccessCode: SERVER_INVITE_CODE });
    const authCodes: (string | undefined)[] = [];
    await context.route(`${VAULT_ORIGIN}/**`, async route => {
        const req = route.request();
        if (new URL(req.url()).pathname === '/v2/auth/key') {
            authCodes.push((JSON.parse(req.postData() ?? '{}') as { accessCode?: string }).accessCode);
        }
        const body = req.postDataBuffer();
        const response = await server.handler(new Request(req.url(), {
            method: req.method(),
            headers: req.headers(),
            ...(body ? { body: new Uint8Array(body) } : {}),
        }));
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    });
    const sourceUrl = 'https://gemini.google.com/app/access-code-probe';
    await context.route(sourceUrl, route => route.fulfill({ contentType: 'text/html', body: '<title>Gemini</title>' }));
    const source = await context.newPage();
    await source.goto(sourceUrl);
    const page = await openOptions(context, extensionId);
    const contentWorldStorage = (): Promise<string> => page.evaluate(async url => {
        const [tab] = await chrome.tabs.query({ url });
        if (tab?.id === undefined) throw new Error('Missing Gemini source tab');
        const [injection] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async () => JSON.stringify(await chrome.storage.local.get(null)),
        });
        return String(injection.result);
    }, sourceUrl);

    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnVaultTabCloud').click();
    await generateAndLockKey(page);
    await page.locator('#cloudServerUrlInput').fill(VAULT_ORIGIN);
    await page.locator('#cloudAccessCodeInput').fill(SERVER_INVITE_CODE);
    await page.locator('#btnCloudConnect').click();
    await expect(page.locator('#cloudConnectedTarget')).toContainText('vault.example.test');
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 0');

    const afterConnect = await contentWorldStorage();
    expect(afterConnect).toContain('gemini_exporter_v2_settings');
    expect(afterConnect).not.toContain(SERVER_INVITE_CODE);
    await page.reload();
    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#cloudAccessCodeInput')).toHaveValue('');
    expect(authCodes).toEqual([SERVER_INVITE_CODE]);
});

test('Local Encrypted Folder Vault UI flow: zero-login folder pick -> automatic .gee1 ciphertext write on disk -> zero plaintext leak -> wipe & local decryption restore', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);

    // Mount a real Chromium OPFS directory handle behind showDirectoryPicker so IDB structured-clone & disk I/O are 100% native
    await page.evaluate(() => {
        const proto = FileSystemDirectoryHandle.prototype as unknown as Record<string, unknown>;
        proto.queryPermission = async () => 'granted';
        proto.requestPermission = async () => 'granted';
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: async () => {
                const opfsRoot = await navigator.storage.getDirectory();
                return opfsRoot.getDirectoryHandle('LocalEncryptedVaultExperiment', { create: true });
            },
        });
    });

    // Seed a pre-existing conversation BEFORE connecting the vault: picking the folder must automatically back it up with ZERO extra clicks!
    const preExistingTitle = 'Pre-Existing History Auto Backed Up';
    await page.evaluate(async ({ accountId, preExistingTitle }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestIndexes(accountId, [{
            conversationId: 'c_pre_existing_00',
            fields: { title: preExistingTitle, titleSource: 'provider', updatedAt: 1700000000000 },
        }]);
    }, { accountId, preExistingTitle });

    // 1. Open Vault modal (defaults to Local Encrypted Folder tab!) and pick local folder
    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#cloudVaultModal')).toBeVisible();
    await expect(page.locator('#btnCloudBackfill')).toHaveCount(0); // Redundant dual button removed!
    await expect(page.locator('#btnVaultTabLocal')).toHaveAttribute('aria-selected', 'true');
    await generateAndLockKey(page);
    await page.locator('#btnLocalVaultPick').click();

    await expect(page.locator('#cloudConnectedTarget')).toContainText('LocalEncryptedVaultExperiment');
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 1');
    await expect(page.locator('#cloudSyncToggle')).toBeChecked();
    await expect(page.locator('#cloudIncludeDetailRow')).toBeHidden();

    await page.locator('#btnCloudModalClose').click();

    // 2. Simulate scanning a mobile/other-device conversation where ONLY Index metadata exists (no local Detail!)
    const localTitle = 'Mobile Cross-Device Index Only Chat';
    const postTime = Date.now() + 5000;
    await page.evaluate(async ({ accountId, localTitle, postTime }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestIndexes(accountId, [{
            conversationId: 'c_local_vault_01',
            fields: { title: localTitle, titleSource: 'provider', updatedAt: postTime },
        }]);
    }, { accountId, localTitle, postTime });

    const helperExtPage = await context.newPage();
    await helperExtPage.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
    await helperExtPage.evaluate(async id => {
        await chrome.runtime.sendMessage({ action: 'domainChanged', accountId: id }).catch(() => {});
    }, accountId);
    await helperExtPage.close();

    // 3. Inspect real files written inside the folder: BOTH pre-existing + mobile Index conversations are encrypted on disk!
    await expect.poll(async () => page.evaluate(async () => {
        try {
            const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('LocalEncryptedVaultExperiment');
            const manifestFile = await (await root.getFileHandle('vault-manifest.json')).getFile();
            const manifest = JSON.parse(await manifestFile.text());
            return Object.keys(manifest.records ?? {}).length;
        } catch {
            return 0;
        }
    }), { timeout: 10000 }).toBe(2);

    const diskInspection = await page.evaluate(async () => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('LocalEncryptedVaultExperiment');
        const manifestText = await (await (await root.getFileHandle('vault-manifest.json')).getFile()).text();
        const manifest = JSON.parse(manifestText) as { records: Record<string, unknown> };
        const blindId = Object.keys(manifest.records)[0]!;
        const recordsDir = await root.getDirectoryHandle('records');
        const gee1Bytes = new Uint8Array(await (await (await recordsDir.getFileHandle(`${blindId}.gee1`)).getFile()).arrayBuffer());
        return {
            manifestText,
            blindId,
            byteLength: gee1Bytes.byteLength,
            magic: Array.from(gee1Bytes.slice(0, 4)),
            rawLatin1: new TextDecoder('latin1').decode(gee1Bytes),
        };
    });

    expect(diskInspection.blindId).toMatch(/^[0-9a-f]{64}$/);
    expect(diskInspection.magic).toEqual([0x47, 0x45, 0x45, 0x31]); // "GEE1"
    expect(diskInspection.byteLength).toBeLessThan(600); // Compact Index-only ciphertext (~220 bytes)
    for (const sensitive of [localTitle, preExistingTitle, 'c_local_vault_01', 'c_pre_existing_00', 'gemini']) {
        expect(diskInspection.manifestText).not.toContain(sensitive);
        expect(diskInspection.rawLatin1).not.toContain(sensitive);
    }

    // Fault only the manifest commit in both extension execution contexts.
    const injectManifestFailure = () => {
        Reflect.set(globalThis, 'failVaultManifestClose', true);
        const original = FileSystemFileHandle.prototype.createWritable;
        FileSystemFileHandle.prototype.createWritable = async function (...args) {
            const stream = await original.apply(this, args);
            if (this.name === 'vault-manifest.json') {
                const close = stream.close.bind(stream);
                stream.close = async () => {
                    if (Reflect.get(globalThis, 'failVaultManifestClose')) {
                        Reflect.set(globalThis, 'vaultManifestCloseFailed', true);
                        await stream.abort();
                        throw new Error('Injected manifest close failure');
                    }
                    await close();
                };
            }
            return stream;
        };
    };
    const worker = context.serviceWorkers()[0]!;
    await page.evaluate(injectManifestFailure);
    await worker.evaluate(injectManifestFailure);
    await page.evaluate(async ({ accountId, postTime }) => {
        await Reflect.get(globalThis, 'uiFixture').ingestIndexes(accountId, [{
            conversationId: 'c_local_vault_01',
            fields: { title: 'Uncommitted replacement', titleSource: 'provider', updatedAt: postTime + 1 },
        }]);
    }, { accountId, postTime });
    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnCloudSyncNow').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Sync complete');
    const failedInPage = await page.evaluate(() => Reflect.get(globalThis, 'vaultManifestCloseFailed') === true);
    const failedInWorker = await worker.evaluate(() => Reflect.get(globalThis, 'vaultManifestCloseFailed') === true);
    expect(failedInPage || failedInWorker).toBe(true);
    await page.evaluate(() => Reflect.set(globalThis, 'failVaultManifestClose', false));
    await worker.evaluate(() => Reflect.set(globalThis, 'failVaultManifestClose', false));
    await page.locator('#btnCloudModalClose').click();

    // 4. Wipe extension's local conversation list, then restore catalog!
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#list .item')).toHaveCount(0);

    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnCloudSyncNow').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Restored 2');
    await page.locator('#btnCloudModalClose').click();

    await expect(page.locator('#list .item')).toHaveCount(2);
    await expect(page.locator('#list')).toContainText(localTitle);
    await expect(page.locator('#list')).toContainText(preExistingTitle);
});

test('Vault UI handles pre-generated wrong browser key gracefully: pauses sync without overwriting, guides importing original key, and supports two-step Reset Vault escape hatch', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);
    const page = await openOptions(context, extensionId);

    await page.evaluate(() => {
        const proto = FileSystemDirectoryHandle.prototype as unknown as Record<string, unknown>;
        proto.queryPermission = async () => 'granted';
        proto.requestPermission = async () => 'granted';
        Object.defineProperty(window, 'showDirectoryPicker', {
            configurable: true,
            value: async () => {
                const opfsRoot = await navigator.storage.getDirectory();
                return opfsRoot.getDirectoryHandle('ConflictVaultFolder', { create: true });
            },
        });
    });

    // 1. Seed a conversation and initialize ConflictVaultFolder with original Key A
    await page.evaluate(async ({ accountId }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestIndexes(accountId, [{
            conversationId: 'c_key_a_chat',
            fields: { title: 'Protected By Original Key A', titleSource: 'provider', updatedAt: 1710000000000 },
        }]);
    }, { accountId });

    await page.locator('#btnCloudVaultSetup').click();
    const keyA = await generateAndLockKey(page);
    await page.locator('#btnLocalVaultPick').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 1');
    await page.locator('#btnCloudDisconnect').click();
    await page.locator('#btnCloudModalClose').click();

    // 2. Wipe local conversation list AND replace browser's stored key with a different auto-generated Key B
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#list .item')).toHaveCount(0);

    await page.evaluate(async () => {
        // Simulate a browser with no installed vault key.
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_cloud_v2');
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['localKeys', 'syncedRecords'], 'readwrite');
                tx.objectStore('localKeys').clear();
                tx.objectStore('syncedRecords').clear();
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
        });
    });

    // Add a new local conversation on this "new browser" so we verify it does NOT pollute the Key A folder before unlock
    await page.evaluate(async ({ accountId }) => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.ingestIndexes(accountId, [{
            conversationId: 'c_new_browser_chat',
            fields: { title: 'Authored On Second Browser', titleSource: 'provider', updatedAt: 1720000000000 },
        }]);
    }, { accountId });

    // 3. Set up a different key and connect to ConflictVaultFolder; existing ciphertext must stay intact.
    await page.locator('#btnCloudVaultSetup').click();
    await generateAndLockKey(page);
    await page.locator('#btnLocalVaultPick').click();
    await expect(page.locator('#cloudKeyMismatchBox')).toBeVisible();
    await expect(page.locator('#cloudVaultSummary')).toContainText('Key mismatch');

    // Verify ConflictVaultFolder still has ONLY the 1 original file (zero split-brain overwrite!)
    const recordCountDuringLock = await page.evaluate(async () => {
        const root = await (await navigator.storage.getDirectory()).getDirectoryHandle('ConflictVaultFolder');
        const text = await (await (await root.getFileHandle('vault-manifest.json')).getFile()).text();
        return Object.keys(JSON.parse(text).records ?? {}).length;
    });
    expect(recordCountDuringLock).toBe(1);

    // 4. Paste original Key A and click Import -> unlocks, restores Key A chat, AND backs up new browser chat under Key A!
    await page.locator('#cloudImportKeyInput').fill(keyA);
    await page.locator('#btnCloudImportKey').click();
    await expect(page.locator('#cloudKeyMismatchBox')).toBeHidden();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Restored 1, Saved 1');
    await page.locator('#btnCloudModalClose').click();

    await expect(page.locator('#list .item')).toHaveCount(2);
    await expect(page.locator('#list')).toContainText('Protected By Original Key A');
    await expect(page.locator('#list')).toContainText('Authored On Second Browser');

    // 5. Simulate lost old key escape hatch: generate fresh browser key -> mismatch -> 2-step Reset Vault with Current Key!
    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnCloudDisconnect').click();
    await page.locator('#btnCloudModalClose').click();

    await page.evaluate(async () => {
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_cloud_v2');
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction(['localKeys', 'syncedRecords'], 'readwrite');
                tx.objectStore('localKeys').clear();
                tx.objectStore('syncedRecords').clear();
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            };
        });
    });

    await page.locator('#btnCloudVaultSetup').click();
    await generateAndLockKey(page);
    await page.locator('#btnLocalVaultPick').click();
    await expect(page.locator('#cloudKeyMismatchBox')).toBeVisible();
    // First click arms confirmation without erasing
    await page.locator('#btnCloudResetVault').click();
    await expect(page.locator('#btnCloudResetVault')).toContainText('Confirm Erase');
    // Second click resets vault and backs up both local conversations under the new key
    await page.locator('#btnCloudResetVault').click();
    await expect(page.locator('#cloudKeyMismatchBox')).toBeHidden();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 2');
});
