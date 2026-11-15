import { readFile } from 'node:fs/promises';
import { test, expect, seedRegistryAccounts } from './fixtures';
import { accountId, openOptions } from './uiFixture';
import {
    createGoogleOidcVerifier,
    encodeBase64UrlBytes,
    type JsonWebKeyWithKid,
} from '../../cloud-server/src/auth/googleOidc';
import { createCloudServerHandler } from '../../cloud-server/src/router';
import { createInMemoryVaultStore } from '../../cloud-server/src/storage/vaultStore';

const GOOGLE_CLIENT_ID = '777777777777-e2etest.apps.googleusercontent.com';
const VAULT_ORIGIN = 'https://vault.example.test';
const SESSION_SECRET = 'playwright-e2e-vault-session-hmac-secret-32bytes+';

test('E2EE Cloud Vault full browser UI flow: Google OIDC sign-in -> post-toggle automatic encrypted upload -> zero-knowledge server audit -> wipe & cross-device recovery -> lossless Markdown export', async ({ context, extensionId }) => {
    await seedRegistryAccounts(context);

    // 1. Boot real zero-knowledge Cloud Server handler + real RSA-2048 OIDC keypair in Node
    const rsaPair = await crypto.subtle.generateKey(
        {
            name: 'RSASSA-PKCS1-v1_5',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['sign', 'verify'],
    );
    const pubJwk = await crypto.subtle.exportKey('jwk', rsaPair.publicKey);
    const jwkWithKid: JsonWebKeyWithKid = { ...pubJwk, kid: 'e2e-rsa-1', alg: 'RS256', use: 'sig' };
    const oidcVerifier = createGoogleOidcVerifier(async () => ({ keys: [jwkWithKid], maxAgeMs: 3600_000 }));
    const serverStore = createInMemoryVaultStore();
    const serverHandler = createCloudServerHandler({
        store: serverStore,
        oidcVerifier,
        config: {
            sessionHmacSecret: SESSION_SECRET,
            googleClientIds: [GOOGLE_CLIENT_ID],
            allowedOrigins: [`chrome-extension://${extensionId}`],
        },
    });

    const signGoogleIdTokenWithNonce = async (nonce: string): Promise<string> => {
        const nowSec = Math.floor(Date.now() / 1000);
        const h = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', kid: 'e2e-rsa-1' })));
        const p = encodeBase64UrlBytes(new TextEncoder().encode(JSON.stringify({
            iss: 'https://accounts.google.com',
            aud: GOOGLE_CLIENT_ID,
            sub: 'e2e_google_user_42',
            email: 'e2e-researcher@example.com',
            email_verified: true,
            nonce,
            iat: nowSec - 5,
            exp: nowSec + 3600,
        })));
        const input = new Uint8Array(new TextEncoder().encode(`${h}.${p}`));
        const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsaPair.privateKey, input));
        return `${h}.${p}.${encodeBase64UrlBytes(sig)}`;
    };

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
    await page.exposeFunction('__e2eSignGoogleOidc', signGoogleIdTokenWithNonce);

    // Mock browser-native OAuth popup (`chrome.identity.launchWebAuthFlow`) to return real RSA-signed ID token
    await page.evaluate(() => {
        Object.defineProperty(chrome.permissions, 'contains', {
            configurable: true,
            value: async () => true,
        });
        Object.defineProperty(chrome, 'identity', {
            configurable: true,
            value: {
                getRedirectURL: (path = '') => `https://${chrome.runtime.id}.chromiumapp.org/${path}`,
                launchWebAuthFlow: async (details: { url: string }) => {
                    const authUrl = new URL(details.url);
                    const state = authUrl.searchParams.get('state') ?? '';
                    const nonce = authUrl.searchParams.get('nonce') ?? '';
                    const signFn = Reflect.get(window, '__e2eSignGoogleOidc') as (n: string) => Promise<string>;
                    const jwt = await signFn(nonce);
                    const redirect = authUrl.searchParams.get('redirect_uri') ?? '';
                    return `${redirect}#state=${encodeURIComponent(state)}&id_token=${encodeURIComponent(jwt)}`;
                },
            },
        });
    });

    // 2. Open Cloud Vault modal, sign in with Google, and verify auto-sync toggle turns ON
    await page.locator('#btnCloudVaultSetup').click();
    await expect(page.locator('#cloudVaultModal')).toBeVisible();
    await page.locator('#cloudServerUrlInput').fill(VAULT_ORIGIN);
    await page.locator('#cloudGoogleClientIdInput').fill(GOOGLE_CLIENT_ID);
    await page.locator('#btnCloudConnectGoogle').click();

    await expect(page.locator('#cloudConnectedEmail')).toHaveText('e2e-researcher@example.com');
    await expect(page.locator('#cloudSyncToggle')).toBeChecked();

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
    for (const forbidden of [secretMarker, secretTitle, 'c_live_e2ee_auto', 'e2e-researcher@example.com', 'gemini']) {
        expect(rawServerDump).not.toContain(forbidden);
    }

    // 5. Simulate catastrophic local loss / moving to a clean device: wipe local conversations AND disconnect,
    //    then reconnect, import the saved GEK1 recovery key, and click "Sync & Restore Now"!
    await page.locator('#btnMoreActions').click();
    await page.locator('#btnClearScan').click();
    await page.locator('#btnCleanupConfirm').click();
    await expect(page.locator('#list .item')).toHaveCount(0);

    // Disconnect and wipe local cloud session cursor so pull starts fresh from seq = 0 like a brand-new machine
    await page.locator('#btnCloudVaultSetup').click();
    await page.locator('#btnCloudDisconnect').click();
    await expect(page.locator('#btnCloudConnectGoogle')).toBeVisible();

    await page.locator('#btnCloudConnectGoogle').click();
    await expect(page.locator('#cloudConnectedEmail')).toHaveText('e2e-researcher@example.com');
    await page.locator('#cloudImportKeyInput').fill(savedRecoveryKey);
    await page.locator('#btnCloudImportKey').click();
    await expect(page.locator('#cloudModalFeedback')).toContainText('verified');

    await page.locator('#btnCloudSyncNow').click();
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
