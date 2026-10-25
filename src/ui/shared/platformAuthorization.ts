import { PLATFORM_HOSTS, SOURCE_PLATFORMS as platforms, type SourcePlatform } from '../../shared/platformHosts.js';
import { activatePlatformAccess, findAuthorizedAccount, hasPlatformAccess,
    observePlatformAccess, requestPlatformAuthorization } from '../../runtime/capabilities/platformAuthorization.js';
import { text } from './settings.js';

const names: Record<SourcePlatform, string> = { gemini: 'Gemini', chatgpt: 'ChatGPT', claude: 'Claude', grok: 'Grok' };

/** Shared by onboarding and the standalone site-access dialog. Selection never revokes access. */
export function mountPlatformAuthorization(host: HTMLElement, options: {
    ready?: (authorized: boolean) => void;
    connected?: (accountId: string) => Promise<void>;
    selectedPlatforms?: readonly SourcePlatform[];
    granted?: (platforms: readonly SourcePlatform[]) => void;
} = {}): () => void {
    let active = true;
    let busy = false;
    let revision = 0;
    let authorized: SourcePlatform[] = [];
    const box = document.createElement('div');
    box.className = 'platform-authorization';
    const authorize = document.createElement('button');
    authorize.type = 'button';
    authorize.className = 'tour-action-btn';
    authorize.id = 'btnAuthorizePlatforms';
    authorize.textContent = text('Authorize', '授权');
    const list = document.createElement('fieldset');
    list.className = 'platform-permission-list';
    const legend = document.createElement('legend');
    legend.textContent = text('Supported platforms', '支持的平台');
    list.append(legend);
    const selection = () => rows.filter(row => row.input.checked).map(row => row.platform);
    const updateButton = () => { authorize.disabled = busy || !selection().length; };
    const rows = platforms.map(platform => {
        const row = document.createElement('div');
        row.className = 'platform-permission-row';
        row.dataset.platform = platform;
        const label = document.createElement('label');
        label.className = 'platform-permission-choice';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = platform;
        input.checked = options.selectedPlatforms ? options.selectedPlatforms.includes(platform) : true;
        input.addEventListener('change', updateButton);
        const name = document.createElement('span');
        name.textContent = names[platform];
        const state = document.createElement('span');
        state.className = 'platform-permission-state';
        label.append(input, name);
        const heading = document.createElement('div');
        heading.className = 'platform-permission-heading';
        heading.append(label, state);
        const details = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = text('Conversation and attachment sites', '会话与附件网站');
        const sites = document.createElement('ul');
        for (const origin of [...PLATFORM_HOSTS[platform].pages, ...PLATFORM_HOSTS[platform].attachments]) {
            const site = document.createElement('li');
            site.textContent = origin.replace('https://', '').replace('/*', '');
            sites.append(site);
        }
        details.append(summary, sites);
        row.append(heading, details);
        list.append(row);
        return { platform, input, state };
    });
    const hint = document.createElement('p');
    hint.className = 'platform-permission-hint';
    hint.textContent = text('Only selected platforms are requested. Unchecking does not revoke existing access.',
        '仅申请所选平台的权限。取消勾选不会撤销已有授权。');
    const status = document.createElement('div');
    status.className = 'tour-status-indicator';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    box.append(authorize, list, hint, status);
    host.append(box);
    const refresh = async () => {
        const current = ++revision;
        const granted = await Promise.all(platforms.map(hasPlatformAccess));
        if (!active || current !== revision) return;
        authorized = platforms.filter((_, index) => granted[index]);
        for (const { platform, state } of rows) {
            state.textContent = authorized.includes(platform) ? text('Authorized', '已授权') : text('Not authorized', '未授权');
            state.dataset.authorized = String(authorized.includes(platform));
        }
        options.ready?.(!busy && authorized.length > 0);
    };
    authorize.addEventListener('click', () => {
        const selected = selection();
        if (!active || busy || !selected.length) return;
        // One native prompt for the union, started synchronously in this click.
        const request = requestPlatformAuthorization(selected);
        busy = true;
        list.disabled = true;
        updateButton();
        options.ready?.(false);
        status.textContent = text('Waiting for Chrome permission…', '正在等待 Chrome 授权…');
        void (async () => {
            const granted = await request;
            if (!active) return;
            if (!granted) {
                status.textContent = text('Access was not granted. You can change the selection and try again.',
                    '未获得授权。可以调整所选平台后重试。');
                return;
            }
            const activated = await activatePlatformAccess(selected);
            if (!active) return;
            status.textContent = activated
                ? text('Selected platforms authorized. Sign in on their websites when needed.', '所选平台已授权。需要时请在对应网站登录。')
                : text('Access granted. Reload the platform page to activate it.', '权限已授予。请刷新平台页面以启用。');
            options.granted?.(selected);
            // Account endpoints may be slow or rate limited. Their result never holds the authorization UI open.
            if (options.connected) void findAuthorizedAccount(selected).then(async accountId => {
                if (active && accountId) await options.connected?.(accountId);
            }).catch(() => {});
        })().catch(() => {
            if (active) status.textContent = text('Could not finish setup. Check access below and try again.', '未能完成设置，请检查下方授权状态后重试。');
        }).finally(() => {
            busy = false;
            if (!active) return;
            list.disabled = false;
            updateButton();
            void refresh();
        });
    });
    const changed = () => { void refresh(); };
    const stopObserving = observePlatformAccess(changed);
    window.addEventListener('focus', changed);
    void refresh();
    return () => {
        active = false;
        stopObserving();
        window.removeEventListener('focus', changed);
        box.remove();
    };
}
