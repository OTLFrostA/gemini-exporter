import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { A, B, mount, read } from './helpers/uiPortHarness.js';
let browser: Browser, page: Page;
before(async () => { browser = await chromium.launch({ channel: 'chrome', chromiumSandbox: true, headless: true }); });
afterEach(async () => { await page?.close(); });
after(async () => { await browser?.close(); });

async function waitForAccountSuccess(platform: 'gemini' | 'chatgpt') {
    await page.waitForFunction(platform => document.getElementById(`btnConnectPlatform-${platform}`)?.dataset.connectionState === 'success', platform);
}

async function observeSuccessPause(buttonId = 'btnConnectPlatform-gemini') {
    await page.evaluate(buttonId => {
        const timing = { success: 0, advanced: 0 };
        Reflect.get(window, 'harness').feedbackTimings = timing;
        const observer = new MutationObserver(() => {
            if (!timing.success && document.getElementById(buttonId)?.dataset.connectionState === 'success') timing.success = performance.now();
            if (document.querySelector('.tour-title')?.textContent === 'Switch platforms and accounts') {
                timing.advanced = performance.now();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-connection-state'] });
    }, buttonId);
}
async function assertSuccessPause() {
    const timing = await read(page, 'feedbackTimings');
    assert.ok(timing.success > 0 && timing.advanced - timing.success >= 480, 'success feedback remains visible for 500ms before advancing');
}

for (const language of ['en', 'zh']) test(`authorization opens first with two separate explanations (${language})`, async () => {
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await mount(page, 'options', { accounts: [], tabs: [], geminiAccess: false, manifestVersion: '2.1.0', settings: { language } }, '?startTour=1');
    await page.locator('#btnAuthorizePlatforms').waitFor();
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    assert.equal(await page.locator('#tourSkipBtn').count(), 0);
    assert.equal(await page.locator('.tour-coach-card').count(), 2);
    for (const id of ['tourAuthorizationWhy', 'tourAuthorizationMore']) {
        assert.equal(await page.locator('#' + id).isVisible(), true);
        assert.equal(await page.locator('#' + id).evaluate(el => {
            const card = el.getBoundingClientRect();
            const menu = document.querySelector('.tour-authorization-menu')?.getBoundingClientRect();
            return !!menu && card.left >= 0 && card.right <= innerWidth && card.top >= 0 && card.bottom <= innerHeight
                && (card.right <= menu.left || card.left >= menu.right || card.bottom <= menu.top || card.top >= menu.bottom);
        }), true);
    }
    await page.screenshot({ path: `tests/output/visual_audit/onboarding-authorization-${language}.png`, animations: 'disabled' });
    for (const platform of ['gemini', 'grok', 'claude']) await page.locator(`input[value="${platform}"]`).uncheck();
    await page.locator('#btnAuthorizePlatforms').click();
    // Successful authorization advances without an extra Next click or a connected account.
    await page.locator('#btnConnectPlatform-chatgpt').waitFor();
    assert.deepEqual(await read(page, 'connectionRequests'), [[['chatgpt'], true]]);
    assert.equal(await page.locator('.tour-authorization-menu').count(), 0);
    assert.equal(await page.locator('.tour-title').innerText(), language === 'en' ? 'Connect an account' : '识别平台账号');
});

test('no accounts: visit only an authorized site, detect on return, then explain the account selector', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { accounts: [], tabs: [], geminiAccess: false, chatgptAccess: true }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.locator('#tourNextBtn').click();
    await page.getByRole('heading', { name: 'Connect an account', exact: true }).waitFor();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    assert.equal(await page.locator('.tour-platform-choices button').count(), 1);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await page.evaluate(() => Reflect.get(window, 'testUi').tour.nextStep());
    assert.equal(await page.locator('.tour-title').innerText(), 'Connect an account');
    await page.locator('#btnConnectPlatform-chatgpt').click();
    assert.deepEqual(await read(page, 'openedUrls'), ['https://chatgpt.com/']);
    assert.deepEqual(await read(page, 'signInRequests'), [{platform:'chatgpt',active:false}]);
    await page.evaluate(({ B }) => {
        Reflect.get(window, 'harness').accounts = [{ id: B, providerId: 'chatgpt', providerAccountId: 'signed-in-user' }];
        Reflect.get(window, 'harness').source = B;
        Reflect.get(window, 'harness').tabs = [{id: 2, url: 'https://chatgpt.com/'}];
        Reflect.get(window, 'harness').chatgptAccounts = Reflect.get(window, 'harness').accounts;
    }, { B });
    await page.getByRole('heading', { name: 'Switch platforms and accounts', exact: true }).waitFor();
    assert.equal(await page.locator('#accountIdSelect').inputValue(), B);
    await page.locator('#tourNextBtn').click();
    await page.getByRole('heading', { name: 'Scan conversations', exact: true }).waitFor();
});

test('the account lesson wraps Tab in both directions and blocks programmatic background focus', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { accounts: [], tabs: [] }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').click();
    const gemini = page.locator('#btnConnectPlatform-gemini');
    await gemini.waitFor();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    const focus = () => page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Tab');
    assert.equal(await focus(), 'tourCloseBtn');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await focus(), 'tourPrevBtn');
    await page.keyboard.press('Tab');
    assert.equal(await focus(), 'tourCloseBtn');
    await page.keyboard.press('Tab');
    assert.equal(await focus(), 'btnConnectPlatform-gemini');
    await page.locator('#btnThemeToggle').focus();
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('tour-popover')), true);
});

test('an import-only default account does not skip website account detection', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'default' }], tabs: [] }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.locator('#tourNextBtn').click();
    await page.getByRole('heading', { name: 'Connect an account', exact: true }).waitFor();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
});

test('closing during detection discards late results; revoking all access returns to authorization', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { accounts: [], tabs: [], holdDiscovery: true }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.locator('#tourNextBtn').click();
    await page.waitForFunction(() => typeof Reflect.get(window, 'harness').finishDiscovery === 'function');
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await page.locator('#tourCloseBtn').click();
    await page.evaluate(({ B }) => Reflect.get(window, 'harness').finishDiscovery(B), { B });
    assert.equal(await page.locator('.tour-popover').count(), 0);
    await page.evaluate(() => { Reflect.get(window, 'harness').holdDiscovery = false; });
    await page.locator('#btnTourGuide').click();
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.locator('#tourNextBtn').click();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    await page.evaluate(() => { const h = Reflect.get(window, 'harness'); h.geminiAccess = false; h.accessListener(); });
    await page.locator('.tour-authorization-menu').waitFor();
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
});

test('existing recognized accounts wait for a user action before advancing connection', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { initialOpenOptionsAccountId: B, source:B }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor();
    assert.equal(await page.locator('#accountIdSelect').inputValue(), B);
    await page.locator('#tourNextBtn').click();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('#btnDetectAccount:enabled').waitFor();
    assert.equal(await page.locator('.tour-title').innerText(), 'Connect an account');
    assert.equal(await page.locator('#tourNextBtn').isEnabled(), true);
    await observeSuccessPause();
    await page.locator('#btnDetectAccount').click();
    const connectedButton = page.locator('#btnConnectPlatform-gemini');
    await waitForAccountSuccess('gemini');
    assert.equal(await page.locator('.tour-title').innerText(), 'Connect an account');
    const expectedLabel = await page.evaluate(({ B }) => {
        const account = Reflect.get(window, 'harness').accounts.find((account: { id: string }) => account.id === B);
        return account.displayName || account.email || account.providerAccountId;
    }, { B });
    assert.equal(await connectedButton.innerText(), `Gemini · Identified: ${expectedLabel}`);
    await page.getByRole('heading', { name: 'Switch platforms and accounts', exact: true }).waitFor();
    await assertSuccessPause();
    assert.equal(await page.locator('#accountIdSelect').inputValue(), B);
    assert.equal(await page.locator('#btnDetectAccount').count(), 0);
    assert.deepEqual(await read(page, 'openedUrls'), undefined);
});

test('access revoked during a pending account lookup cannot advance the tutorial', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { accounts: [], tabs: [], holdDiscovery: true }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.locator('#tourNextBtn').click();
    await page.waitForFunction(() => typeof Reflect.get(window, 'harness').finishDiscovery === 'function');
    await page.evaluate(({ B }) => {
        const h = Reflect.get(window, 'harness');
        h.geminiAccess = false;
        h.accessListener();
        h.finishDiscovery(B);
    }, { B });
    await page.locator('.tour-authorization-menu').waitFor();
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
});

test('tutorial authorization reuses the Site access page title, description and menu', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { geminiAccess: false });
    const readPage = () => page.locator('.tour-popover').evaluate(popover => ({
        title: popover.querySelector('.tour-title')?.textContent,
        description: popover.querySelector('.tour-content')?.textContent,
        menu: popover.querySelector('.platform-authorization')?.textContent,
    }));
    await page.locator('#btnPlatformPermissions').click();
    await page.locator('#btnAuthorizePlatforms').waitFor();
    const siteAccess = await readPage();
    await page.locator('#platformAuthorizationDone').click();
    await page.locator('#btnTourGuide').click();
    await page.locator('#btnAuthorizePlatforms').waitFor();
    assert.deepEqual(await readPage(), siteAccess);
    assert.equal(await page.locator('.tour-coach-card').count(), 2);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
});

test('account discovery gives each authorized platform a full button row', async () => {
    page = await browser.newPage();
    await mount(page, 'options', {accounts:[],tabs:[],geminiAccess:true,chatgptAccess:true,grokAccess:true,claudeAccess:true}, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor(); await page.locator('#tourNextBtn').click();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    const bounds = await page.locator('.tour-platform-choices button').evaluateAll(buttons => buttons.map(button => {
        const {x,y,width,height}=button.getBoundingClientRect(); return {x,y,width,height};
    }));
    assert.equal(bounds.length,4);
    for(let i=1;i<bounds.length;i++) {
        assert.equal(bounds[i].x,bounds[0].x); assert.equal(bounds[i].width,bounds[0].width);
        assert.ok(bounds[i].y>=bounds[i-1].y+bounds[i-1].height);
    }
});

test('returning to account connection keeps the lesson open and allows Next with an existing account', async () => {
    page = await browser.newPage();
    await mount(page, 'options', { initialOpenOptionsAccountId: B, source:B, chatgptAccess:true }, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.locator('#tourNextBtn').click();
    await page.locator('#btnDetectAccount:enabled').click();
    await page.getByRole('heading',{name:'Switch platforms and accounts',exact:true}).waitFor();
    await page.locator('#tourPrevBtn').click();
    await page.getByRole('heading',{name:'Connect an account',exact:true}).waitFor();
    await page.locator('#tourNextBtn:enabled').waitFor();
    await page.getByRole('button',{name:'Connect ChatGPT',exact:true}).waitFor();
    await page.locator('#btnDetectAccount').click();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    assert.equal(await page.locator('.tour-title').innerText(),'Connect an account');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.locator('#btnDetectAccount:enabled').waitFor();
    assert.equal(await page.locator('.tour-title').innerText(),'Connect an account');
    await page.locator('#tourNextBtn').click();
    await page.getByRole('heading',{name:'Switch platforms and accounts',exact:true}).waitFor();
});

test('a stored ChatGPT account cannot advance connection until the scan source is verified', async () => {
    page=await browser.newPage();
    await mount(page,'options',{accounts:[{id:A,providerId:'chatgpt',providerAccountId:'stored'}],tabs:[],chatgptAccess:true,geminiAccess:false,connectionFailure:'chatgpt'},'?startTour=1');
    await page.locator('#tourNextBtn:enabled').waitFor(); await page.locator('#tourNextBtn').click();
    await page.getByRole('heading',{name:'Connect an account',exact:true}).waitFor();
    await page.locator('#btnDetectAccount:enabled').waitFor();
    assert.equal(await page.locator('#tourNextBtn').isEnabled(),false);
    await page.locator('#btnConnectPlatform-chatgpt').click();
    assert.equal(await page.locator('#btnConnectPlatform-chatgpt').getAttribute('data-connection-state'), 'loading');
    assert.equal(await page.locator('.tour-title').innerText(),'Connect an account');
    await page.evaluate(()=>{
        const h=Reflect.get(window,'harness');
        h.connectionFailure=null;
        h.tabs=[{id:2,url:'https://chatgpt.com/'}];
        h.chatgptAccounts=h.accounts;
    });
    await page.getByRole('heading',{name:'Switch platforms and accounts',exact:true}).waitFor();
    assert.equal(await page.locator('#accountIdSelect').inputValue(),A);
});

async function openAccountLesson(patch: Record<string, unknown> = {}) {
    page = await browser.newPage();
    await mount(page, 'options', patch, '?startTour=1');
    await page.locator('#tourNextBtn:enabled').click();
    await page.locator('#btnDetectAccount:enabled').waitFor();
}

test('a cached account still paints loading and success inside its own connection button', async () => {
    await openAccountLesson({ settings: { language: 'zh' } });
    const button = page.locator('#btnConnectPlatform-gemini');
    const clickedAt = Date.now();
    await button.click();
    assert.equal(await button.getAttribute('data-connection-state'), 'loading');
    assert.equal(await button.getAttribute('aria-busy'), 'true');
    assert.match(await button.innerText(), /正在连接 Gemini/);
    assert.equal(await button.locator('.tour-account-icon').evaluate(el => getComputedStyle(el).animationName), 'tour-account-spin');
    await waitForAccountSuccess('gemini');
    assert.ok(Date.now() - clickedAt >= 350, 'cached success must not erase loading before it paints');
    assert.match(await button.innerText(), /成功识别：A/);
    assert.equal(await button.getAttribute('aria-busy'), 'false');
    await page.screenshot({path:'tests/output/visual_audit/onboarding-account-button-success.png'});
    await page.getByRole('heading', { name: '切换平台与账号', exact: true }).waitFor();
});

test('concurrent platform links wait for the last requested platform and retain separate identities', async () => {
    await openAccountLesson({ accounts: [
        {id:A,providerId:'gemini',providerAccountId:'gemini-user',displayName:'Gemini Alice'},
        {id:B,providerId:'chatgpt',providerAccountId:'chatgpt-user',displayName:'ChatGPT Bob'},
    ], chatgptAccess:true, connectedAccountIds:[A,B] });
    await page.evaluate(() => { Reflect.get(window,'harness').holdDiscoveryPlatforms=['gemini','chatgpt']; });
    await page.locator('#btnConnectPlatform-gemini').click();
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.waitForFunction(() => {
        const finish=Reflect.get(window,'harness').finishPlatformDiscovery;
        return finish?.gemini && finish?.chatgpt;
    });
    await page.evaluate(({A}) => Reflect.get(window,'harness').finishPlatformDiscovery.gemini(A), {A});
    await waitForAccountSuccess('gemini');
    assert.match(await page.locator('#btnConnectPlatform-gemini').innerText(), /Gemini Alice/);
    assert.equal(await page.locator('#btnConnectPlatform-chatgpt').getAttribute('data-connection-state'), 'loading');
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.tour-title').innerText(), 'Connect an account');
    assert.equal(await page.locator('#tourNextBtn').isDisabled(), true);
    await observeSuccessPause('btnConnectPlatform-chatgpt');
    await page.evaluate(({B}) => Reflect.get(window,'harness').finishPlatformDiscovery.chatgpt(B), {B});
    await waitForAccountSuccess('chatgpt');
    assert.match(await page.locator('#btnConnectPlatform-chatgpt').innerText(), /ChatGPT Bob/);
    await page.getByRole('heading', {name:'Switch platforms and accounts',exact:true}).waitFor();
    await assertSuccessPause();
});

test('starting another link during success feedback cancels the pending automatic advance', async () => {
    await openAccountLesson({chatgptAccess:true,accounts:[
        {id:A,providerId:'gemini',providerAccountId:'gemini-user'},
        {id:B,providerId:'chatgpt',providerAccountId:'chatgpt-user'},
    ],connectedAccountIds:[A,B]});
    await page.evaluate(() => { Reflect.get(window,'harness').holdDiscoveryPlatforms=['chatgpt']; });
    await page.locator('#btnConnectPlatform-gemini').click();
    await waitForAccountSuccess('gemini');
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.tour-title').innerText(), 'Connect an account');
    assert.equal(await page.locator('#btnConnectPlatform-chatgpt').getAttribute('data-connection-state'),'loading');
    await page.evaluate(({B})=>Reflect.get(window,'harness').finishPlatformDiscovery.chatgpt(B),{B});
    await page.getByRole('heading',{name:'Switch platforms and accounts',exact:true}).waitFor();
});

test('an unrecognized ChatGPT account times out without borrowing Gemini and can be retried in place', async () => {
    await openAccountLesson({chatgptAccess:true,accounts:[
        {id:A,providerId:'gemini',providerAccountId:'gemini-user'},
        {id:B,providerId:'chatgpt',providerAccountId:'chatgpt-user'},
    ],connectedAccountIds:[A,B]});
    await page.clock.install();
    await page.locator('#btnConnectPlatform-gemini').click();
    await waitForAccountSuccess('gemini');
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.clock.fastForward(15001);
    const chatgpt = page.locator('#btnConnectPlatform-chatgpt');
    await page.locator('#btnConnectPlatform-chatgpt[data-connection-state=error]').waitFor();
    assert.match(await chatgpt.innerText(), /Account not identified/);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(),true);
    assert.equal(await page.locator('#btnConnectPlatform-gemini').getAttribute('data-connection-state'),'success');
    await page.evaluate(({B})=>{
        const h=Reflect.get(window,'harness');
        h.tabs=[{id:2,url:'https://chatgpt.com/'}];
        h.chatgptAccounts=h.accounts.filter((account:{id:string})=>account.id===B);
    },{B});
    await chatgpt.click();
    await waitForAccountSuccess('chatgpt');
    assert.match(await chatgpt.innerText(),/chatgpt-user/);
    assert.deepEqual(await read(page,'openedUrls'),['https://gemini.google.com/','https://chatgpt.com/']);
    await page.getByRole('heading',{name:'Switch platforms and accounts',exact:true}).waitFor();
});

test('a hung account probe reaches its deadline and late success cannot overwrite the failed attempt', async () => {
    await openAccountLesson({chatgptAccess:true,accounts:[
        {id:A,providerId:'gemini',providerAccountId:'gemini-user'},
        {id:B,providerId:'chatgpt',providerAccountId:'chatgpt-user'},
    ],connectedAccountIds:[A,B]});
    await page.clock.install();
    await page.evaluate(()=>{Reflect.get(window,'harness').holdDiscoveryPlatforms=['chatgpt'];});
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.waitForFunction(()=>Reflect.get(window,'harness').finishPlatformDiscovery?.chatgpt);
    await page.clock.fastForward(15001);
    await page.locator('#btnConnectPlatform-chatgpt[data-connection-state=error]').waitFor();
    await page.evaluate(({B})=>Reflect.get(window,'harness').finishPlatformDiscovery.chatgpt(B),{B});
    await page.waitForTimeout(650);
    assert.equal(await page.locator('#btnConnectPlatform-chatgpt').getAttribute('data-connection-state'),'error');
    assert.equal(await page.locator('#tourNextBtn').isDisabled(),true);
    assert.equal(await page.locator('.tour-title').innerText(),'Connect an account');
});

test('revoking a requested platform stops its pending identity check and blocks continuation', async () => {
    await openAccountLesson({chatgptAccess:true,accounts:[
        {id:A,providerId:'gemini',providerAccountId:'gemini-user'},
        {id:B,providerId:'chatgpt',providerAccountId:'chatgpt-user'},
    ],connectedAccountIds:[A,B]});
    await page.evaluate(()=>{Reflect.get(window,'harness').holdDiscoveryPlatforms=['chatgpt'];});
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.waitForFunction(()=>Reflect.get(window,'harness').finishPlatformDiscovery?.chatgpt);
    await page.evaluate(()=>{
        const h=Reflect.get(window,'harness');
        h.chatgptAccess=false;
        h.accessListener();
    });
    await page.locator('#btnConnectPlatform-chatgpt[data-connection-state=error]').waitFor();
    await page.evaluate(({B})=>Reflect.get(window,'harness').finishPlatformDiscovery.chatgpt(B),{B});
    assert.match(await page.locator('#btnConnectPlatform-chatgpt').innerText(),/Site access required/);
    assert.equal(await page.locator('#tourNextBtn').isDisabled(),true);
    assert.equal(await page.locator('#btnConnectPlatform-gemini').getAttribute('data-connection-state'),'idle');
});

test('closing while a platform is connecting cancels its timers and ignores late account results', async () => {
    await openAccountLesson({chatgptAccess:true,accounts:[
        {id:A,providerId:'gemini',providerAccountId:'gemini-user'},
        {id:B,providerId:'chatgpt',providerAccountId:'chatgpt-user'},
    ],connectedAccountIds:[A,B]});
    await page.clock.install();
    await page.evaluate(()=>{Reflect.get(window,'harness').holdDiscoveryPlatforms=['chatgpt'];});
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.waitForFunction(()=>Reflect.get(window,'harness').finishPlatformDiscovery?.chatgpt);
    await page.locator('#tourCloseBtn').click();
    await page.evaluate(({B})=>Reflect.get(window,'harness').finishPlatformDiscovery.chatgpt(B),{B});
    await page.clock.fastForward(16000);
    assert.equal(await page.locator('.tour-popover').count(),0);
    assert.equal(await page.locator('#accountIdSelect').inputValue(),A);
});

test('a platform page that cannot be opened fails only its own button and stays retryable', async () => {
    await openAccountLesson({chatgptAccess:true});
    await page.evaluate(()=>{ chrome.tabs.create = async () => { throw new Error('Tab creation failed'); }; });
    await page.locator('#btnConnectPlatform-chatgpt').click();
    await page.locator('#btnConnectPlatform-chatgpt[data-connection-state=error]').waitFor();
    assert.match(await page.locator('#btnConnectPlatform-chatgpt').innerText(),/Could not open platform/);
    assert.equal(await page.locator('#btnConnectPlatform-chatgpt').isEnabled(),true);
    assert.equal(await page.locator('#btnConnectPlatform-gemini').getAttribute('data-connection-state'),'idle');
    assert.equal(await page.locator('#tourNextBtn').isDisabled(),true);
});

test('revoking an untouched platform does not turn it into a requested failed link', async () => {
    await openAccountLesson({chatgptAccess:true});
    await page.evaluate(()=>{ Reflect.get(window,'harness').holdDiscoveryPlatforms=['gemini']; });
    await page.locator('#btnConnectPlatform-gemini').click();
    await page.waitForFunction(()=>Reflect.get(window,'harness').finishPlatformDiscovery?.gemini);
    await page.evaluate(()=>{
        const h=Reflect.get(window,'harness');
        h.chatgptAccess=false;
        h.accessListener();
    });
    await page.locator('#btnConnectPlatform-chatgpt').waitFor({state:'detached'});
    await page.evaluate(({A})=>Reflect.get(window,'harness').finishPlatformDiscovery.gemini(A),{A});
    await page.getByRole('heading',{name:'Switch platforms and accounts',exact:true}).waitFor();
});

test('clicking a loading platform cancels connection immediately and focus never auto-restarts an errored platform', async () => {
    await openAccountLesson({ chatgptAccess: true, accounts: [{ id: A, providerId: 'gemini', providerAccountId: 'gemini-user' }], connectedAccountIds: [A] });
    await page.clock.install();
    await page.evaluate(() => { Reflect.get(window, 'harness').holdDiscoveryPlatforms = ['chatgpt']; });

    const chatgpt = page.locator('#btnConnectPlatform-chatgpt');
    await chatgpt.click();
    assert.equal(await chatgpt.getAttribute('data-connection-state'), 'loading');
    assert.match(await chatgpt.innerText(), /Cancel/);

    // Clicking while loading cancels immediately back to idle
    await chatgpt.click();
    assert.equal(await chatgpt.getAttribute('data-connection-state'), 'idle');
    assert.match(await chatgpt.innerText(), /Connect ChatGPT/);

    // Start again, let deadline expire into error, then verify window focus does NOT auto-restart it
    await chatgpt.click();
    await page.clock.fastForward(15001);
    await page.locator('#btnConnectPlatform-chatgpt[data-connection-state=error]').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    assert.equal(await chatgpt.getAttribute('data-connection-state'), 'error');
});
