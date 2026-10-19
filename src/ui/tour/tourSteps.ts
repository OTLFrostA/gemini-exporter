import { text } from '../utils/settings.js';
export interface TourStep {
    id: string; target: () => HTMLElement | null; title: () => string; description: () => string;
    setupAction?: (advance: () => void) => () => void;
}
/** Delayed advancement belongs to the step and is cancelled with its listeners. */
export function bindDelayedActions(bindings: [EventTarget | null, string][], advance: () => void, delay = 250): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onAction = (event: Event) => {
        if (event.type === 'change' && (event.target as HTMLInputElement)?.type === 'checkbox' && !(event.target as HTMLInputElement).checked) return;
        if (timer !== undefined) return;
        timer = setTimeout(advance, delay);
    };
    for (const [target, event] of bindings) target?.addEventListener(event, onAction);
    return () => { clearTimeout(timer); for (const [target, event] of bindings) target?.removeEventListener(event, onAction); };
}
const target = (id: string) => () => document.getElementById(id);
export const STEPS: TourStep[] = [
    { id: 'connect', target: () => document.querySelector('header h1'), title: () => text('Connect Gemini', '连接 Gemini'), description: () => text('Open Gemini and sign in. Only you can open or refresh the page.', '请打开 Gemini 并登录。打开或刷新页面需要您主动点击。') },
    { id: 'sync', target: target('btnSyncAll'), title: () => text('Scan conversations', '扫描对话'), description: () => text('Scan the verified Gemini source. You can continue while scanning.', '扫描已确认的 Gemini 来源。扫描进行中也可继续教程。'), setupAction: next => bindDelayedActions([[target('btnSyncAll')(), 'click']], next, 300) },
    { id: 'select', target: () => document.querySelector('#list .item') || target('btnSelectAll')(), title: () => text('Select conversations', '选择对话'), description: () => text('Select a conversation or all visible results. If scanning is still running, select later or continue.', '勾选对话或全选可见项。扫描尚未结束时可稍后选择，或直接继续。'), setupAction: next => bindDelayedActions([[target('list')(), 'change'], [target('btnSelectAll')(), 'click']], next) },
    { id: 'format', target: target('format'), title: () => text('Choose a format', '选择格式'), description: () => text('Markdown, HTML, PDF and JSON share one export workflow.', 'Markdown、HTML、PDF 和 JSON 共用同一导出流程。'), setupAction: next => bindDelayedActions([[target('format')(), 'change']], next) },
    { id: 'export', target: target('btnExport'), title: () => text('Export selected conversations', '导出选中对话'), description: () => text('Download in your browser or write into an authorized folder. Multiple download files are automatically zipped.', '在浏览器下载或写入已授权目录。多个下载文件自动打包 ZIP。'), setupAction: next => bindDelayedActions([[target('btnExport')(), 'click']], next, 200) },
    { id: 'live_save', target: target('liveSaveControls'), title: () => text('Live Save', '自动保存'), description: () => text('Enable Live Save and authorize a folder. Real captured content changes save Markdown there. Other formats or missing permission pause saving and preserve your enabled preference. Return to Markdown with valid permission to resume.', '主动开启并授权目录后，捕获的正文真实更新才保存 Markdown。其他格式或目录失权时暂停，保留开启意图；切回 Markdown 且授权有效后恢复。'), setupAction: next => bindDelayedActions([[target('liveSaveDiskToggle')(), 'change'], [target('btnSetDir')(), 'click']], next, 300) },
    { id: 'feedback', target: target('feedbackBox'), title: () => text('Optional feedback', '可选反馈'), description: () => text('This link opens the feedback form. Start using only closes this tutorial.', '点击链接打开反馈表单；“开始使用”只关闭教程。'), setupAction: next => bindDelayedActions([[target('feedbackBox')(), 'click']], next, 0) }
];
