import { text } from '../shared/settings.js';
export interface TourStep {
    id: string; target: () => HTMLElement | null; title: () => string; description: () => string;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    hint?: () => string;
    setupAction?: (advance: () => void) => () => void;
}
/** Delayed advancement belongs to the step and is cancelled with its listeners. */
export function bindDelayedActions(bindings: [EventTarget | null, string][], advance: () => void, delay = 250): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAction = (event: Event) => {
        const target = event.target;
        if (event.type === 'change' && target instanceof HTMLInputElement && target.type === 'checkbox' && !target.checked) return;
        if (timer !== undefined) return;
        timer = setTimeout(advance, delay);
    };
    for (const [target, event] of bindings) target?.addEventListener(event, onAction);
    return () => { clearTimeout(timer); for (const [target, event] of bindings) target?.removeEventListener(event, onAction); };
}
const target = (id: string) => () => document.getElementById(id);
/** Shared by the 2.1 release highlights and the beginning of the full tutorial. */
export const PLATFORM_STEPS: TourStep[] = [
    { id: 'platforms', target: () => null,
        title: () => text('Multi-platform support (Beta)', '多平台支持（测试版）'),
        description: () => text('Gemini Exporter 2.1 now supports Gemini, ChatGPT, Claude and Grok. Authorize the sites you use and manage conversations from different platforms and accounts in one place.', 'Gemini Exporter 2.1 新增多平台支持：Gemini、ChatGPT、Claude 和 Grok。授权你使用的网站，即可在同一个工作台管理不同平台、不同账号的对话。') },
    { id: 'site_access', target: target('btnPlatformPermissions'), placement: 'bottom',
        title: () => text('Authorize the sites you use', '授权指定网站'),
        description: () => text('Click the highlighted Site access button, select the platforms you need, and authorize their conversation and attachment sites. You can change site access here at any time.', '点击高亮的「网站授权」按钮，勾选需要的平台，授权对应的会话和附件网站。以后也可以随时从这里管理网站授权。'),
        hint: () => text('Try Site access, or choose Next.', '点击「网站授权」试试看，或使用「下一步」。') },
    { id: 'accounts', target: () => document.querySelector<HTMLElement>('.conversation-source'), placement: 'bottom',
        title: () => text('Switch platforms and accounts', '切换平台与账号'),
        description: () => text('Use the highlighted account selector to switch between platforms and accounts. Sign in on an authorized platform and scan to connect its account; then select it here to view and export its conversations.', '点击高亮的账号选择框，即可切换不同平台、不同账号。先在已授权的平台登录并扫描以连接账号，之后就可以在这里选择账号、查看和导出其对话。') },
];
export const AUTHORIZATION_STEP: TourStep = { id: 'connect', target: () => null, title: () => text('Authorize AI platforms', '授权 AI 平台'), description: () => text('Select the platforms you want to use, then authorize their conversation and attachment sites in Chrome.', '勾选需要使用的平台，然后通过 Chrome 授权访问其会话与附件网站。') };
export const STEPS: TourStep[] = [
    ...PLATFORM_STEPS,
    AUTHORIZATION_STEP,
    { id: 'sync', placement: 'bottom', target: target('btnSyncAll'), title: () => text('Scan conversations', '扫描对话'), description: () => text('Scan the connected platform. You can continue while scanning.', '扫描已连接的平台。扫描进行中也可继续教程。'), hint: () => text('Click the highlighted Scan button to continue, or use Next.', '点击高亮的扫描按钮继续，或使用「下一步」。'), setupAction: next => bindDelayedActions([[target('btnSyncAll')(), 'click']], next, 300) },
    { id: 'select', placement: 'left', target: () => document.querySelector('#list .item') || target('btnSelectAll')(), title: () => text('Select conversations', '选择对话'), description: () => text('Select a conversation or all visible results. If scanning is still running, select later or continue.', '勾选对话或全选可见项。扫描尚未结束时可稍后选择，或直接继续。'), hint: () => text('Select a chat or use the list header checkbox.', '勾选对话，或使用列表顶部的全选框。'), setupAction: next => bindDelayedActions([[target('list')(), 'change'], [target('btnSelectAll')(), 'click']], next) },
    { id: 'format', placement: 'right', target: target('format'), title: () => text('Choose a format', '选择格式'), description: () => text('Markdown, HTML, PDF and JSON share one export workflow.', 'Markdown、HTML、PDF 和 JSON 共用同一导出流程。'), hint: () => text('Choose an export format to continue.', '选择导出格式即可继续。'), setupAction: next => bindDelayedActions([[target('format')(), 'change']], next) },
    { id: 'export', placement: 'right', target: target('btnExport'), title: () => text('Export selected conversations', '导出选中对话'), description: () => text('Download in your browser or write into an authorized folder. Multiple download files are automatically zipped.', '在浏览器下载或写入已授权目录。多个下载文件自动打包 ZIP。'), hint: () => text('Click Export to start, or choose Next.', '点击导出开始，或使用「下一步」。'), setupAction: next => bindDelayedActions([[target('btnExport')(), 'click']], next, 200) },
    { id: 'live_save', placement: 'right',
        target: () => document.querySelector<HTMLElement>('.delivery-card:has(input[value="folderWriter"])'),
        title: () => text('Live Save', '实时保存'),
        description: () => text('Markdown has been selected for this step. Select Save to local folder and authorize it, then enable Live Save (only effective with MD format); browser download or other formats pause it without forgetting your preference.', '已为此步骤切换到 Markdown（MD）。先选择「保存到本地文件夹」并授权目录，再开启实时保存（只有在选择 MD 格式时生效）。切换到浏览器下载或其他格式时会暂停，不会清除原来的开启状态。'),
        hint: () => text('Select the local-folder option, then choose a folder. Next always works.', '先选本地文件夹，再点击选择文件夹；也可以使用「下一步」。'),
        setupAction: next => bindDelayedActions([[target('liveSaveDiskToggle')(), 'change'], [target('btnSetDir')(), 'click']], next, 300) },
    { id: 'feedback', placement: 'right', target: target('feedbackBox'), title: () => text('Optional feedback', '可选反馈'), description: () => text('This link opens the feedback form. Start using only closes this tutorial.', '点击链接打开反馈表单；“开始使用”只关闭教程。'), hint: () => text('Feedback is optional; Start using only closes this tour.', '反馈是可选的；「开始使用」只会结束教程。'), setupAction: next => bindDelayedActions([[target('feedbackBox')(), 'click']], next, 0) }
];
