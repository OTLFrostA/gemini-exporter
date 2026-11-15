import type { Account } from '../../l2/accountRegistry.js';
import { getAccount, listAccounts } from '../../runtime/api/accountRegistry.js';
import { findAuthorizedAccount, hasPlatformAccess, observePlatformAccess, openPlatformSignIn } from '../../runtime/capabilities/platformAuthorization.js';
import { resolveScanTarget } from '../../runtime/capabilities/tabService.js';
import { SOURCE_PLATFORMS, platformDisplayName, type SourcePlatform } from '../../shared/platformHosts.js';
import { text } from '../shared/settings.js';

interface Attempt {
    readonly startedAt: number;
    checking: boolean;
    poll?: ReturnType<typeof setTimeout>;
    deadline?: ReturnType<typeof setTimeout>;
}
type ConnectionState = { kind: 'idle' }
    | { kind: 'loading'; attempt: Attempt }
    | { kind: 'success'; account: Account; completedAt: number }
    | { kind: 'error'; message: string };
interface PlatformRow {
    readonly platform: SourcePlatform;
    readonly button: HTMLButtonElement;
    readonly label: HTMLSpanElement;
    state: ConnectionState;
}

/** Each clicked platform owns its identity check, timeout and visible feedback. */
export function mountAccountDiscovery(host: HTMLElement, next: HTMLButtonElement, options: {
    readonly connected?: (accountId: string) => Promise<void>;
    readonly advance?: () => void;
    readonly authorize: () => void;
}): () => void {
    const choices = document.createElement('div');
    choices.className = 'tour-platform-choices';
    const status = document.createElement('p');
    status.className = 'tour-status-indicator';
    status.setAttribute('role', 'status');
    const retry = document.createElement('button');
    retry.id = 'btnDetectAccount';
    retry.className = 'tour-nav-btn';
    retry.textContent = text('Check again', '重新检测');
    host.append(choices, status, retry);
    const rows = new Map<SourcePlatform, PlatformRow>();
    let active = true;
    let initialAccount: Account | null = null;
    let initialCheck: Promise<void> | undefined;
    let advanceTimer: ReturnType<typeof setTimeout> | undefined;

    const attempted = () => [...rows.values()].filter(row => row.state.kind !== 'idle');
    const stopAttempt = (row: PlatformRow) => {
        if (row.state.kind !== 'loading') return;
        clearTimeout(row.state.attempt.poll);
        clearTimeout(row.state.attempt.deadline);
    };
    const update = () => {
        clearTimeout(advanceTimer);
        const requested = attempted();
        const loading = requested.some(row => row.state.kind === 'loading');
        const failed = requested.some(row => row.state.kind === 'error');
        const complete = requested.length > 0 && requested.every(row => row.state.kind === 'success');
        next.disabled = requested.length ? !complete : initialAccount === null;
        retry.disabled = loading || initialCheck !== undefined;
        status.textContent = loading ? text('Connecting the selected platforms…', '正在连接所选平台…')
            : failed ? text('Account not identified. The page may still be loading, signed out or unreachable. Sign in on that platform, then retry its button.',
                '未识别到账号：页面可能仍在加载、尚未登录或连接异常。请前往对应平台完成登录，然后点击该按钮重试。')
                : complete ? text('All requested platforms are connected.', '所选平台均已连接。')
                    : text('Choose a platform to connect. You can connect several platforms at once.', '点击平台按钮连接账号，可以同时连接多个平台。');
        if (complete && options.advance) {
            const latest = Math.max(...requested.map(row => row.state.kind === 'success' ? row.state.completedAt : 0));
            advanceTimer = setTimeout(() => { if (active) options.advance?.(); }, Math.max(0, latest + 500 - performance.now()));
        }
    };
    const render = (row: PlatformRow) => {
        const name = platformDisplayName(row.platform);
        const state = row.state;
        row.button.dataset.connectionState = state.kind;
        row.button.setAttribute('aria-busy', String(state.kind === 'loading'));
        row.button.disabled = state.kind === 'loading' || state.kind === 'success';
        row.label.textContent = state.kind === 'loading' ? text(`Connecting ${name}…`, `正在连接 ${name}…`)
            : state.kind === 'success' ? text(`${name} · Identified: ${state.account.displayName || state.account.email || state.account.providerAccountId}`,
                `${name} · 成功识别：${state.account.displayName || state.account.email || state.account.providerAccountId}`)
                : state.kind === 'error' ? text(`${name} · ${state.message} · Retry`, `${name} · ${state.message} · 重试`)
                    : text(`Connect ${name}`, `连接 ${name}`);
        update();
    };
    const current = (row: PlatformRow, attempt: Attempt) => active && row.state.kind === 'loading' && row.state.attempt === attempt;
    const fail = (row: PlatformRow, attempt: Attempt, message: string) => {
        if (!current(row, attempt)) return;
        stopAttempt(row);
        row.state = { kind: 'error', message };
        render(row);
    };
    const probe = async (row: PlatformRow, attempt: Attempt): Promise<void> => {
        if (!current(row, attempt) || attempt.checking) return;
        clearTimeout(attempt.poll);
        attempt.poll = undefined;
        attempt.checking = true;
        try {
            if (!await hasPlatformAccess(row.platform)) {
                fail(row, attempt, text('Site access required', '需要网站授权'));
                return;
            }
            // Discovery and any previously verified candidate stay bound to this platform.
            const accountId = await findAuthorizedAccount([row.platform])
                ?? (initialAccount?.providerId === row.platform ? initialAccount.id : null);
            if (!current(row, attempt)) return;
            const account = accountId ? await getAccount(accountId) : null;
            if (account && account.providerId === row.platform && account.providerAccountId !== 'default'
                && await resolveScanTarget(account.id) === account.id) {
                if (!current(row, attempt)) return;
                await options.connected?.(account.id);
                if (!current(row, attempt)) return;
                const success = () => {
                    if (!current(row, attempt)) return;
                    stopAttempt(row);
                    row.state = { kind: 'success', account, completedAt: performance.now() };
                    render(row);
                };
                // An already signed-in account can otherwise resolve before the first painted frame.
                attempt.poll = setTimeout(success, Math.max(0, attempt.startedAt + 400 - performance.now()));
                return;
            }
        } catch { /* A navigating page or session may become available on the next probe. */ }
        finally { if (attempt.poll === undefined) attempt.checking = false; }
        if (current(row, attempt)) attempt.poll = setTimeout(() => { void probe(row, attempt); }, 1500);
    };
    const start = (row: PlatformRow, openPage: boolean) => {
        if (!active || row.state.kind === 'loading') return;
        const attempt: Attempt = { startedAt: performance.now(), checking: false };
        row.state = { kind: 'loading', attempt };
        render(row);
        // This deadline also handles a session request that never settles.
        attempt.deadline = setTimeout(() => fail(row, attempt, text('Account not identified', '未识别到账号')), 15000);
        void (async () => {
            if (openPage) {
                if (!await hasPlatformAccess(row.platform)) {
                    fail(row, attempt, text('Site access required', '需要网站授权'));
                    return;
                }
                if (!current(row, attempt)) return;
                await openPlatformSignIn(row.platform, false);
            }
            if (current(row, attempt)) await probe(row, attempt);
        })().catch(() => fail(row, attempt, text('Could not open platform', '未能打开平台')));
    };
    const checkInitialAccount = async (): Promise<void> => {
        if (!active || attempted().length) return;
        const platforms = [...rows.keys()];
        const accounts = (await listAccounts()).filter(account => account.providerAccountId !== 'default'
            && platforms.some(platform => platform === account.providerId));
        const selector = document.getElementById('accountIdSelect');
        const known = accounts.find(account => selector instanceof HTMLSelectElement && account.id === selector.value) ?? accounts[0];
        const id = known?.id ?? await findAuthorizedAccount(platforms);
        let account = id ? await getAccount(id) : null;
        try { if (account && await resolveScanTarget(account.id) !== account.id) account = null; }
        catch { account = null; }
        if (!active || attempted().length) return;
        initialAccount = account;
        if (account) await options.connected?.(account.id);
    };
    const checkInitial = () => {
        if (!active || initialCheck || attempted().length) return;
        initialCheck = checkInitialAccount().catch(() => { initialAccount = null; }).finally(() => {
            initialCheck = undefined;
            if (active) update();
        });
        update();
    };
    const refreshAccess = async () => {
        const access = await Promise.all(SOURCE_PLATFORMS.map(hasPlatformAccess));
        if (!active) return;
        if (!access.some(Boolean)) { options.authorize(); return; }
        for (const [index, platform] of SOURCE_PLATFORMS.entries()) {
            const existing = rows.get(platform);
            if (!access[index]) {
                if (initialAccount?.providerId === platform) initialAccount = null;
                if (existing?.state.kind === 'idle') {
                    existing.button.remove();
                    rows.delete(platform);
                } else if (existing) {
                    stopAttempt(existing);
                    existing.state = { kind: 'error', message: text('Site access required', '需要网站授权') };
                    render(existing);
                }
                continue;
            }
            if (existing) continue;
            const button = document.createElement('button');
            button.id = `btnConnectPlatform-${platform}`;
            button.className = 'tour-action-btn secondary tour-account-button';
            const icon = document.createElement('span');
            icon.className = 'tour-account-icon';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'tour-account-label';
            button.append(icon, label);
            button.setAttribute('aria-live', 'polite');
            const row: PlatformRow = { platform, button, label, state: { kind: 'idle' } };
            button.addEventListener('click', () => start(row, row.state.kind === 'idle'));
            rows.set(platform, row);
            choices.append(button);
            render(row);
        }
        update();
        checkInitial();
    };
    const onReturn = () => {
        if (document.hidden) return;
        for (const row of rows.values()) {
            if (row.state.kind === 'loading') void probe(row, row.state.attempt);
            else if (row.state.kind === 'error') start(row, false);
        }
        checkInitial();
    };
    retry.addEventListener('click', () => {
        const requested = attempted();
        if (requested.length) {
            for (const row of requested) if (row.state.kind === 'error') start(row, false);
        } else if (initialAccount) {
            const row = [...rows.values()].find(row => row.platform === initialAccount?.providerId);
            if (row) start(row, false);
        } else checkInitial();
    });
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    const stopPermissions = observePlatformAccess(() => { void refreshAccess().catch(() => { if (active) update(); }); });
    retry.disabled = true;
    void refreshAccess().catch(() => { if (active) update(); });
    return () => {
        active = false;
        clearTimeout(advanceTimer);
        for (const row of rows.values()) stopAttempt(row);
        stopPermissions();
        window.removeEventListener('focus', onReturn);
        document.removeEventListener('visibilitychange', onReturn);
    };
}
