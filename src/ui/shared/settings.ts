import type { GlobalSettings } from '../../l2/settings.js';
import { OperationError, type OperationErrorCode } from '../../shared/errors/operationError.js';
import { ScanConnectionError, type SourcePlatform } from '../../shared/platformHosts.js';
import { TakeoutParseError } from '../../shared/types/errors.js';
import { UI_COPY } from './legacyLabels.js';
export const EXPORT_FORMATS = ['markdown', 'html', 'pdf', 'docx', 'json'] as const satisfies readonly GlobalSettings['defaultFormat'][];
let language = 'en';
let developerMode = false;
export function useSettings(settings: GlobalSettings, applyDocumentLanguage = true): void {
    developerMode = settings.developerMode;
    language = settings.language ?? (typeof navigator !== 'undefined' && navigator.language.startsWith('zh') ? 'zh' : 'en');
    // Never change Gemini's host document theme when invoked by the content Badge.
    if (applyDocumentLanguage && typeof document !== 'undefined') {
        document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
        document.documentElement.dataset.theme = settings.theme === 'light' ? 'light' : 'dark';
    }
}
export const text = (en: string, zh: string): string => language === 'zh' ? zh : en;
export const englishCount = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;
export const uiLocale = (): string => language === 'zh' ? 'zh-CN' : 'en-US';
export const isDeveloperMode = (): boolean => developerMode;
export function labelThemeToggle(button: HTMLButtonElement, settings?: GlobalSettings): void {
    const light = settings?.theme === 'light';
    const label = light ? text('Switch to dark mode', '切换到深色模式')
        : text('Switch to light mode', '切换到浅色模式');
    button.textContent = light ? '☾' : '☀';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(light));
}
export function observeSettings(refresh: () => void): () => void {
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
        if (area === 'local' && (changes.gemini_exporter_v2_settings || changes.gemini_suppress_direct_write_prompt)) refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
}
/** Runtime errors carry structured codes/classes; only UI translates their user-facing presentation. */
const SCAN_CONNECTION_MESSAGES: Readonly<Record<SourcePlatform, readonly [string, string]>> = {
    gemini: ['Open Gemini, log in and refresh the page before scanning.', '请先打开 Gemini 并登录，刷新 Gemini 页面后再同步会话。'],
    chatgpt: ['Open ChatGPT, log in and connect the selected account before scanning.', '请打开 ChatGPT 并登录所选账号，然后重试同步。'],
    claude: ['Open Claude, log in and connect the selected account before scanning.', '请打开 Claude 并登录所选账号，然后重试同步。'],
    grok: ['Open Grok, log in and connect the selected account before scanning.', '请打开 Grok 并登录所选账号，然后重试同步。'],
};
const OPERATION_ERROR_MESSAGES: Readonly<Partial<Record<OperationErrorCode, readonly [string, string]>>> = {
    NO_CONNECTED_ACCOUNT: [
        'Open Gemini, ChatGPT, Claude or Grok and connect an account before scanning.',
        '请打开 Gemini、ChatGPT、Claude 或 Grok 并登录，再通过“新手引导”连接后同步会话。',
    ],
    MULTIPLE_ACCOUNTS_CONNECTED: [
        'Multiple provider accounts are connected. Select the account to scan.',
        '当前连接了多个平台账号，请选择要同步的账号。',
    ],
    CURRENT_CONVERSATION_UNAVAILABLE: [
        'No trusted current conversation',
        '无法确认当前对话。',
    ],
    DIRECTORY_UNAVAILABLE: [
        'Directory picker unavailable',
        '当前浏览器无法打开文件夹选择器。',
    ],
    DIRECTORY_PERMISSION_REQUIRED: [
        'Authorize a folder first',
        '请先授权文件夹。',
    ],
    DIRECTORY_PERMISSION_DENIED: [
        'Folder permission denied',
        '文件夹访问权限被拒绝。',
    ],
    ARCHIVE_READER_UNAVAILABLE: [
        'ZIP reader unavailable; cannot parse the archive.',
        'ZIP 读取器不可用，无法解析压缩包。',
    ],
    ARCHIVE_USER_MISMATCH: [
        'OpenAI ZIP belongs to a different ChatGPT user',
        '此 OpenAI ZIP 属于另一个 ChatGPT 用户，请选择对应账户。',
    ],
    ARCHIVE_CONVERSATIONS_MISSING: [
        'OpenAI ZIP does not contain conversations.json',
        '此 ZIP 不含 conversations.json，请选择 OpenAI 官方数据导出包。',
    ],
    ARCHIVE_MANIFEST_UNSUPPORTED: [
        'Unsupported OpenAI export manifest',
        '不支持此 OpenAI 导出清单格式。',
    ],
    ARCHIVE_MANIFEST_MISSING_FILES: [
        'OpenAI export manifest references missing files',
        'OpenAI 导出清单引用了压缩包中不存在的文件。',
    ],
    GEMINI_ACCOUNT_REQUIRED: [
        'Select a Gemini account before importing Takeout',
        '导入 Takeout 前，请先选择 Gemini 账号。',
    ],
    CHATGPT_ACCOUNT_REQUIRED: [
        'Select a ChatGPT account before importing OpenAI ZIP',
        '导入 OpenAI ZIP 前，请先选择 ChatGPT 账户。',
    ],
    ACCOUNT_UNAVAILABLE: [
        'Selected account unavailable',
        '所选账号不可用。',
    ],
    CLOUD_AUTH_REQUIRED: [
        'Please connect to your Encrypted Vault first.',
        '请先在加密保险箱设置中完成连接。',
    ],
    CLOUD_ACCESS_CODE_INVALID: [
        'Invalid or missing server access code. Check the access code configured on your Cloud Vault.',
        '服务器访问口令错误或未填写，请核对服务端配置的访问口令。',
    ],
    CLOUD_KEY_NOT_INITIALIZED: [
        'Initialize your Master Key first (generate a new key once or paste an existing GEK1 key).',
        '请先初始化主密钥（随机生成新密钥或粘贴已有的 GEK1 主密钥）。',
    ],
    CLOUD_KEY_CHANGED: [
        'The active Master Key changed in another tab. Review the current key before trying again.',
        '主密钥已在另一标签页更改。请确认当前密钥后再试。',
    ],
    CLOUD_VAULT_NOT_FOUND: [
        'No existing vault matches this Master Key on the server. Verify your key, or click "Create New Cloud Vault with Current Key".',
        '云端未找到该主密钥对应的保险箱。请核对密钥，或点击“以此密钥新建云端保险箱”。',
    ],
    CLOUD_RATE_LIMITED: [
        'Too many requests from this IP. Please wait before trying again.',
        '当前 IP 请求过于频繁或触发安全冷却，请稍后再试。',
    ],
    CLOUD_KEY_INVALID: [
        'Invalid recovery key format or checksum. Please verify every character.',
        '恢复密钥格式或校验和错误，请仔细核对每个字符。',
    ],
    CLOUD_KEY_MISMATCH: [
        'This vault was encrypted with another Recovery Key. Paste the original Recovery Key below to unlock it.',
        '此保险箱由另一把密钥加密，请在下方粘贴导入原有的恢复密钥以解锁同步。',
    ],
    CLOUD_DECRYPT_AUTH_FAILED: [
        'Decryption failed: recovery key does not match the encrypted cloud vault.',
        '解密验签失败：当前恢复密钥与云端加密库不匹配。',
    ],
    CLOUD_QUOTA_EXCEEDED: [
        'Cloud Vault storage quota exceeded.',
        '云端加密存储空间配额已满。',
    ],
    CLOUD_RECORD_TOO_LARGE: [
        'Conversation exceeds the 2 MiB encrypted record limit.',
        '单条会话超出 2 MiB 加密体积上限。',
    ],
    CLOUD_SERVER_ERROR: [
        'Could not reach the Cloud Vault server. Check the HTTPS URL and network.',
        '无法连接云同步服务器，请检查 HTTPS 地址与网络连接。',
    ],
    CLOUD_ROTATION_VERIFY_FAILED: [
        'Could not verify the backup. Your current Master Key was not changed.',
        '无法验证备份，当前主密钥未更改。',
    ],
    CLOUD_ROTATION_SYNC_DISABLED: [
        'Enable Cloud Vault sync before rotating the Master Key.',
        '请先启用云端保险箱同步，再轮换主密钥。',
    ],
};
export function errorText(error: unknown): string {
    if (error instanceof DOMException && error.name === 'AbortError')
        return text('Operation cancelled. You can try again.', '操作已取消，可以重试。');
    if (error instanceof ScanConnectionError) {
        const pair = SCAN_CONNECTION_MESSAGES[error.platform];
        return text(pair[0], pair[1]);
    }
    if (error instanceof TakeoutParseError && error.formatDrift) {
        return text('Unsupported Takeout structure', '不支持此 Takeout 压缩包的结构。');
    }
    if (error instanceof OperationError) {
        const pair = OPERATION_ERROR_MESSAGES[error.code];
        if (pair) return text(pair[0], pair[1]);
    }
    // Unexpected diagnostics remain available in the logs, not leaked as untranslated UI.
    return text('Operation failed. Please retry; details are available in the logs or diagnostic report.', '操作失败，请重试；详情请查看日志或诊断报告。');
}
/** Translate static UI nodes only; dynamic titles, messages, paths and logs are rendered by their views. */
export function labelPage(): void {
    document.querySelectorAll<HTMLElement>('[data-en][data-zh], [data-ui-en][data-ui-zh]').forEach(el => {
        el.textContent = text(el.dataset.en ?? el.dataset.uiEn ?? '', el.dataset.zh ?? el.dataset.uiZh ?? '');
    });
    const copy = new Map(Object.entries(UI_COPY[language === 'zh' ? 'zh' : 'en']));
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
        if (el.id === 'currentChatTitle' || el.id === 'chatTurnBadge' || el.id === 'dirLabel' || el.id === 'log') continue;
        const label = copy.get(el.dataset.i18n ?? '');
        if (label) el.textContent = label;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
        const label = copy.get(el.dataset.i18nTitle ?? '');
        if (label) el.title = label;
    }
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
        const label = copy.get(el.dataset.i18nPlaceholder ?? '');
        if (label) el.placeholder = label;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
        const label = copy.get(el.dataset.i18nAriaLabel ?? '');
        if (label) el.setAttribute('aria-label', label);
    }
}
