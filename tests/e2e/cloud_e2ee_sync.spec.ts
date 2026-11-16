import { readFile } from 'node:fs/promises';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { accountId, openOptions } from './uiFixture';
import { createMockCloudVaultHttp } from '../helpers/mockCloudVaultHttp';

const VAULT_ORIGIN = 'https://vault.example.test';
const SERVER_INVITE_CODE = 'my-private-vault-2026';

test('E2EE Cloud Vault full browser UI flow: zero-config key-derived auth + access code -> automatic encrypted upload -> zero-knowledge server audit -> cross-browser key import switches tenant & restores lossless Markdown', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);

    // 1. Boot mock zero-knowledge Cloud Vault HTTP contract double
    const serverStore = createMockCloudVaultHttp({
        serverAccessCode: SERVER_INVITE_CODE,
    });
    const serverHandler = serverStore.handler;

    // Route extension HTTPS requests to our real Cloud Server handler
    await context.route(`${VAULT_ORIGIN}/**`, async route => {
        const req = route.request();
        const postBuffer = req.postDataBuffer();
        const webReq = new Request(req.url(), {
            method: req.method(),
            headers: req.headers(),
            ...(postBuffer ? { body: new Uint8Array(postBuffer) } : {}),
        });
        const webRes = await serverHandler(webReq);
        const resBuffer = Buffer.from(await webRes.arrayBuffer());
        const headersObj: Record<string, string> = {};
        webRes.headers.forEach((v, k) => { headersObj[k] = v; });
        await route.fulfill({
            status: webRes.status,
            headers: headersObj,
            body: resBuffer,
        });
    });

    const page = await openOptions(context, extensionId);

    // 2. Open Vault modal, switch to Cloud Server tab, verify wrong access code is rejected, then connect with valid access code!
    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#cloudVaultModal')).toBeVisible();
    await page.locator('#btnVaultTabCloud').click();
    await page.locator('#cloudServerUrlInput').fill(VAULT_ORIGIN);
    await page.locator('#cloudAccessCodeInput').fill('wrong-passcode');
    await page.locator('#btnCloudConnect').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('access code');

    await page.locator('#cloudAccessCodeInput').fill(SERVER_INVITE_CODE);
    await page.locator('#btnCloudConnect').click();

    await expect(page.locator('#cloudConnectedEmail')).toContainText('vault.example.test');
    await expect(page.locator('#cloudSyncToggle')).toBeChecked();
    await expect(page.locator('#cloudIncludeDetailRow')).toBeHidden();
    // Enable full-body flag via internal settings API for this Markdown body round-trip assertion while UI keeps it hidden
    await page.evaluate(async () => {
        const api = Reflect.get(globalThis, 'uiFixture');
        await api.updateSettings({ cloudSyncIncludeDetail: true });
    });

    // Reveal & capture the generated GEK1-... Master Recovery Key
    await page.locator('#btnCloudRevealKey').click();
    const savedRecoveryKey = await page.locator('#cloudRecoveryKeyDisplay').inputValue();
    expect(savedRecoveryKey).toMatch(/^GEK1(?:-[0-9A-Z]{5}){11}$/);
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
    const helperExtPage = await context.newPage();
    await helperExtPage.goto(`chrome-extension://${extensionId}/src/ui/popup/popup.html`);
    await helperExtPage.evaluate(async id => {
        await chrome.runtime.sendMessage({ action: 'domainChanged', accountId: id }).catch(() => {});
    }, accountId);
    await helperExtPage.close();

    // Wait for automatic background E2EE push to land on the Cloud Vault server
    await expect.poll(() => serverStore.inspectRawBlobs().size, { timeout: 10000 }).toBe(1);

    // 4. Audit server's raw stored bytes: must carry GEE1 header and leak ZERO plaintext/metadata!
    const [storedKey, storedBytes] = [...serverStore.inspectRawBlobs().entries()][0]!;
    expect(Array.from(storedBytes.slice(0, 4))).toEqual([0x47, 0x45, 0x45, 0x31]); // "GEE1"
    const rawServerDump = storedKey + '::' + new TextDecoder('latin1').decode(storedBytes);
    for (const forbidden of [secretMarker, secretTitle, 'c_live_e2ee_auto', 'gemini']) {
        expect(rawServerDump).not.toContain(forbidden);
    }

    // 5. Simulate a brand-new non-Chrome browser (e.g. Edge/Brave):
    //    wipe local conversations AND wipe stored keys so connecting first generates a temporary Key B (`vault:<fpB>`),
    //    then paste `savedRecoveryKey` (Key A) to switch straight into `vault:<fpA>` and restore everything!
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#list .item')).toHaveCount(0);

    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnCloudDisconnect').click();
    await page.evaluate(async () => {
        await chrome.storage.sync.clear();
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_cloud_v1', 2);
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

    await page.locator('#btnVaultTabCloud').click();
    await page.locator('#btnCloudConnect').click();
    // Connected initially to empty temporary `vault:<fpB>`; now paste `savedRecoveryKey` (Key A) to switch & restore!
    await page.locator('#cloudImportKeyInput').fill(savedRecoveryKey);
    await page.locator('#btnCloudImportKey').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Restored 1');
    await page.locator('#btnCloudModalClose').click();

    // 6. Verify the conversation reappeared in the Workbench and exports 100% lossless Markdown!
    await expect(page.locator('#list .item')).toHaveCount(1);
    await expect(page.locator('#list')).toContainText(secretTitle);

    await page.locator('#btnSelectAll').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#btnExport').click();
    const download = await downloadPromise;
    const exportedMd = await readFile((await download.path())!, 'utf8');
    expect(exportedMd).toContain(secretTitle);
    expect(exportedMd).toContain('State the secret invariant.');
    expect(exportedMd).toContain(secretMarker);
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
    await page.locator('#btnLocalVaultPick').click();

    await expect(page.locator('#cloudConnectedEmail')).toContainText('LocalEncryptedVaultExperiment');
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 1');
    await expect(page.locator('#cloudSyncToggle')).toBeChecked();
    await expect(page.locator('#cloudIncludeDetailRow')).toBeHidden();

    await page.locator('#btnCloudRevealKey').click();
    const localRecoveryKey = await page.locator('#cloudRecoveryKeyDisplay').inputValue();
    expect(localRecoveryKey).toMatch(/^GEK1(?:-[0-9A-Z]{5}){11}$/);
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
    await page.locator('#btnLocalVaultPick').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('Saved 1');
    await page.locator('#btnCloudRevealKey').click();
    const keyA = await page.locator('#cloudRecoveryKeyDisplay').inputValue();
    await page.locator('#btnCloudDisconnect').click();
    await page.locator('#btnCloudModalClose').click();

    // 2. Wipe local conversation list AND replace browser's stored key with a different auto-generated Key B
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#list .item')).toHaveCount(0);

    await page.evaluate(async () => {
        // Seed a local conversation on "new browser" and overwrite Chrome Sync + IDB key slot with a different valid GEK1 key
        await chrome.storage.sync.clear();
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_cloud_v1', 2);
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

    // 3. Connect to ConflictVaultFolder -> browser auto-generates fresh Key B -> detects mismatch immediately!
    await page.locator('#btnCloudVaultSetup').click();
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
        await chrome.storage.sync.clear();
        await new Promise<void>((resolve, reject) => {
            const req = indexedDB.open('gemini_exporter_cloud_v1', 2);
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
