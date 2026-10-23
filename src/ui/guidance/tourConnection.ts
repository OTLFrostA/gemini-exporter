import { getAccount } from '../../runtime/api/accountRegistry.js';
import { sendTabMessage } from '../../runtime/capabilities/tabService.js';
import { requestChatGPTConnection, discoverChatGPTAccounts } from '../../runtime/capabilities/chatgptDiscovery.js';
import { requestClaudeConnection, discoverClaudeAccounts } from '../../runtime/capabilities/claudeDiscovery.js';
import type { Account } from '../../l2/accountRegistry.js';
import { text } from '../shared/settings.js';

interface Platform {
    id: string;
    name: string;
    url: string;
    urls: string[];
    buttonId: string;
    request?: () => Promise<boolean>;
    discover?: () => Promise<Account[]>;
}
const platforms: Platform[] = [
    { id: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', urls: ['https://gemini.google.com/*'], buttonId: 'tourBtnOpenGemini' },
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', urls: ['https://chatgpt.com/*', 'https://chat.openai.com/*'], buttonId: 'tourBtnConnectChatGPT', request: requestChatGPTConnection, discover: discoverChatGPTAccounts },
    { id: 'claude', name: 'Claude', url: 'https://claude.ai/', urls: ['https://claude.ai/*'], buttonId: 'tourBtnConnectClaude', request: requestClaudeConnection, discover: discoverClaudeAccounts },
];

/** One initial check; subsequent source checks require a click or a return from sign-in. */
export function mountTourConnection(popover: HTMLElement, footer: HTMLElement,
    connected: (accountId: string) => Promise<void>): () => void {
    let active = true;
    let busy = false;
    let awaitingReturn: Platform | undefined;
    const box = document.createElement('div');
    box.className = 'tour-action-box';
    const status = document.createElement('div');
    status.className = 'tour-status-indicator tour-status-warn';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    box.append(status);
    popover.insertBefore(box, footer);
    const buttons: HTMLButtonElement[] = [];
    const show = (message: string) => { if (active) status.textContent = message; };
    const signedInHint = (platform: Platform) => show(text(
        `Sign in to ${platform.name}, then return here. Click Connect again to retry.`,
        `请在 ${platform.name} 登录后返回这里；也可以再次点击连接重试。`));
    const verify = async (platform: Platform, id: string): Promise<string | null> => {
        const account = await getAccount(id);
        return account?.providerId === platform.id && account.providerAccountId !== 'default' ? account.id : null;
    };
    const tab = async (platform: Platform) => {
        const tabs = await chrome.tabs.query({ url: platform.urls });
        return tabs.find(item => item.active) ?? tabs[0];
    };
    const probe = async (platform: Platform, source: chrome.tabs.Tab | undefined): Promise<string | null> => {
        if (source?.id === undefined) return null;
        const response = await sendTabMessage(source.id, { action: 'getAccountContext' }, 3000);
        if (!response || typeof response !== 'object' || !('ok' in response) || response.ok !== true
            || !('accountContext' in response) || !response.accountContext || typeof response.accountContext !== 'object') return null;
        const context = response.accountContext;
        return 'providerId' in context && context.providerId === platform.id
            && 'accountId' in context && typeof context.accountId === 'string'
            ? verify(platform, context.accountId) : null;
    };
    const accept = async (id: string) => { if (active) await connected(id); };
    const run = (work: () => Promise<void>) => {
        if (!active || busy) return;
        busy = true;
        buttons.forEach(button => { button.disabled = true; });
        void work().catch(() => show(text('Connection unavailable. Please try again.', '无法检查连接，请重试。')))
            .finally(() => {
                busy = false;
                if (active) buttons.forEach(button => { button.disabled = false; });
            });
    };
    for (const platform of platforms) {
        const button = document.createElement('button');
        button.id = platform.buttonId;
        button.className = 'tour-action-btn';
        button.textContent = text(`Connect ${platform.name}`, `连接 ${platform.name}`);
        button.addEventListener('click', () => {
            if (!active || busy) return;
            // Start optional permission requests directly in the user's click.
            const permission = platform.request?.() ?? Promise.resolve(true);
            run(async () => {
                if (!await permission) {
                    show(text(`Allow access to ${platform.name} to connect.`, `请允许访问 ${platform.name} 后再连接。`));
                    return;
                }
                if (!active) return;
                const source = await tab(platform);
                let id: string | null = null;
                if (platform.discover && source) {
                    try {
                        const accounts = await platform.discover();
                        if (accounts[0]) id = await verify(platform, accounts[0].id);
                    } catch (error) {
                        if (!(error instanceof Error) || !/\b(?:401|403)\b/.test(error.message)) throw error;
                    }
                } else if (!platform.discover) {
                    try { id = await probe(platform, source); }
                    catch { if (active && source?.id !== undefined) await chrome.tabs.reload(source.id); }
                }
                if (!active) return;
                if (id) { await accept(id); return; }
                signedInHint(platform);
                awaitingReturn = platform;
                if (source?.id === undefined) await chrome.tabs.create({ url: platform.url });
                else await chrome.tabs.update(source.id, { active: true });
            });
        });
        buttons.push(button);
        box.append(button);
    }
    const returned = () => {
        if (!active || busy || !awaitingReturn || document.hidden) return;
        const platform = awaitingReturn;
        awaitingReturn = undefined;
        run(async () => {
            const accounts = platform.discover ? await platform.discover() : [];
            const id = accounts[0] ? await verify(platform, accounts[0].id)
                : platform.discover ? null : await probe(platform, await tab(platform));
            if (id) await accept(id);
            else signedInHint(platform);
        });
    };
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    show(text('Checking connections…', '正在检查连接…'));
    run(async () => {
        const results = await Promise.all(platforms.map(async platform => {
            const source = await tab(platform);
            try { return await probe(platform, source); }
            catch { return null; }
        }));
        const id = results.find(result => result !== null);
        if (id) await accept(id);
        else show(text('Connect at least one AI platform to continue.', '请至少连接一个 AI 平台后继续。'));
    });
    return () => {
        active = false;
        awaitingReturn = undefined;
        window.removeEventListener('focus', returned);
        document.removeEventListener('visibilitychange', returned);
    };
}
