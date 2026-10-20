import { STEPS } from './tourSteps.js';
import { text } from '../shared/settings.js';
export { STEPS } from './tourSteps.js';
let root: HTMLElement | null = null;
let stepIndex = 0;
let mode: 'tour' | 'spotlight' | 'takeout' | null = null;
let cleanupStep: (() => void) | undefined;
let cleanupOverlay: (() => void) | undefined;
let onDismiss: (() => void) | undefined;

export function consumeTourIntent(): boolean {
    const url = new URL(location.href);
    const start = url.searchParams.get('startTour') === '1';
    if (url.searchParams.has('startTour')) { url.searchParams.delete('startTour'); history.replaceState(history.state, '', url); }
    return start;
}
export function destroy(): void {
    cleanupStep?.(); cleanupStep = undefined;
    cleanupOverlay?.(); cleanupOverlay = undefined;
    root?.remove(); root = null; mode = null; onDismiss = undefined;
}
function close(): void { const callback = onDismiss; destroy(); callback?.(); }
export const finishTour = async (): Promise<void> => { destroy(); };
export const skipTour = finishTour;
export const dismissFeatureSpotlight = async (): Promise<void> => { close(); };
export const isActive = (): boolean => root !== null;
function modalOpen(): boolean { return isActive() || !!document.querySelector('dialog[open], [aria-modal="true"]'); }

function overlay(target: HTMLElement | null, title: string, description: string, interactive: boolean, related: HTMLElement[] = []): HTMLElement {
    cleanupStep?.(); cleanupOverlay?.(); root?.remove();
    const previousFocus = document.activeElement as HTMLElement | null;
    target?.scrollIntoView({ block: 'center', inline: 'nearest' });
    root = document.createElement('div'); root.className = 'tour-overlay-container';
    const popover = document.createElement('div'); popover.className = 'tour-popover'; popover.setAttribute('role', 'dialog'); popover.setAttribute('aria-modal', 'true'); popover.tabIndex = -1;
    const heading = document.createElement('h2'); heading.textContent = title;
    const body = document.createElement('p'); body.textContent = description;
    popover.append(heading, body); root.append(popover); document.body.append(root);
    const backdrop: HTMLElement[] = [];
    const layout = () => {
        backdrop.forEach(el => el.remove()); backdrop.length = 0;
        const rect = target?.getBoundingClientRect();
        const regions = interactive ? [target, ...related].filter((item): item is HTMLElement => !!item && !!item.getClientRects().length) : [];
        const bounds = regions.map(item => item.getBoundingClientRect());
        const hole = bounds.length ? {
            top: Math.min(...bounds.map(item => item.top)),
            left: Math.min(...bounds.map(item => item.left)),
            right: Math.max(...bounds.map(item => item.right)),
            bottom: Math.max(...bounds.map(item => item.bottom)),
        } : null;
        const height = hole ? hole.bottom - hole.top : 0;
        const w = innerWidth, h = innerHeight;
        const boxes = hole ? [[0, 0, w, Math.max(0, hole.top)], [0, hole.top, Math.max(0, hole.left), height],
            [hole.right, hole.top, Math.max(0, w - hole.right), height], [0, hole.bottom, w, Math.max(0, h - hole.bottom)]] : [[0, 0, w, h]];
        for (const [left, top, width, height] of boxes) {
            const panel = document.createElement('div'); panel.className = 'tour-backdrop';
            Object.assign(panel.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
            panel.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); close(); });
            root!.prepend(panel); backdrop.push(panel);
        }
        const width = popover.offsetWidth, height = popover.offsetHeight;
        const beside = rect && rect.right + width + 28 <= w;
        const x = beside ? rect!.right + 16 : rect?.left ?? (w - width) / 2;
        const y = !rect ? (h - height) / 2 : beside ? rect.top
            : rect.bottom + height + 28 <= h ? rect.bottom + 16 : rect.top - height - 16;
        popover.style.left = `${Math.max(12, Math.min(w - width - 12, x))}px`;
        popover.style.top = `${Math.max(12, Math.min(h - height - 12, y))}px`;
    };
    // Consume non-target interactions even when scrolling changes the cutout between frames.
    const guard = (event: MouseEvent) => {
        const node = event.target as Node;
        if (popover.contains(node) || interactive && [target, ...related].some(item => item?.contains(node))) return;
        event.preventDefault(); event.stopImmediatePropagation(); close();
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('click', guard, true); document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', layout); window.addEventListener('scroll', layout, true);
    const frame = requestAnimationFrame(layout);
    cleanupOverlay = () => {
        cancelAnimationFrame(frame);
        document.removeEventListener('click', guard, true); document.removeEventListener('keydown', keydown, true);
        window.removeEventListener('resize', layout); window.removeEventListener('scroll', layout, true);
        previousFocus?.focus?.();
    };
    layout(); popover.focus(); return popover;
}
function button(parent: HTMLElement, label: string, action: () => void): void {
    const btn = document.createElement('button'); btn.textContent = label; btn.addEventListener('click', action); parent.append(btn);
}
export async function goToStep(index: number): Promise<void> {
    if (mode !== 'tour') return;
    if (index >= STEPS.length) { destroy(); return; }
    stepIndex = Math.max(0, index);
    const step = STEPS[stepIndex];
    const related = step.id === 'live_save' ? [document.getElementById('btnSetDir')].filter((item): item is HTMLElement => item instanceof HTMLElement) : [];
    const popover = overlay(step.target(), step.title(), step.description(), true, related);
    button(popover, '×', () => { destroy(); });
    if (stepIndex) button(popover, text('Back', '上一步'), () => { void prevStep(); });
    button(popover, text('Skip', '跳过'), () => { destroy(); });
    button(popover, stepIndex === STEPS.length - 1 ? text('Start using', '开始使用') : text('Next', '下一步'), () => { void nextStep(); });
    let advanced = false;
    const advance = () => { if (advanced || mode !== 'tour' || STEPS[stepIndex] !== step) return; advanced = true; void nextStep(); };
    cleanupStep = step.setupAction?.(advance);
    if (step.id === 'connect') {
        let active = true;
        const message = document.createElement('p'); popover.append(message);
        const action = document.createElement('button'); action.hidden = true; popover.append(action);
        let tabId: number | undefined;
        action.addEventListener('click', () => {
            const operation = tabId === undefined ? chrome.tabs.create({ url: 'https://gemini.google.com/app' }) : chrome.tabs.reload(tabId);
            void Promise.resolve(operation).catch(() => { message.textContent = text('Unable to open or refresh Gemini', '无法打开或刷新 Gemini'); });
        });
        const check = async () => {
            try {
                const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
                if (!active) return;
                const tab = tabs.find(tab => tab.active) ?? tabs[0]; tabId = tab?.id;
                if (tabId === undefined) { message.textContent = text('Open Gemini to connect', '打开 Gemini 以连接'); action.textContent = text('Open Gemini', '打开 Gemini'); action.hidden = false; return; }
                try {
                    const response = await chrome.tabs.sendMessage(tabId, { action: 'getAccountContext' });
                    if (!active) return;
                    if (response?.ok && response.accountContext) { advance(); return; }
                    message.textContent = text('Sign in to Gemini and retry', '请登录 Gemini 后重试'); action.hidden = true;
                } catch {
                    if (!active) return;
                    message.textContent = text('Refresh Gemini to connect', '刷新 Gemini 以连接'); action.textContent = text('Refresh Gemini', '刷新 Gemini'); action.hidden = false;
                }
            } catch { if (active) message.textContent = text('Connection unavailable', '无法检查连接'); }
        };
        void check(); const timer = setInterval(() => { void check(); }, 1500);
        cleanupStep = () => { active = false; clearInterval(timer); };
    }
}
export async function nextStep(): Promise<void> { await goToStep(stepIndex + 1); }
export async function prevStep(): Promise<void> { await goToStep(stepIndex - 1); }
export async function startTour(): Promise<void> {
    if (modalOpen()) return;
    destroy(); mode = 'tour'; await goToStep(0);
}
export function startFeatureSpotlight(_version: string, stepId: string, dismissed: () => void): boolean {
    if (modalOpen()) return false;
    const step = STEPS.find(step => step.id === stepId); const target = step?.target();
    if (!step || !target || !target.getClientRects().length) return false;
    mode = 'spotlight'; const popover = overlay(target, step.title(), step.description(), false);
    onDismiss = dismissed;
    button(popover, '×', close); button(popover, text('Got it', '知道了'), close); return true;
}
export function showTakeoutPrompt(count: number, dismissed: () => void, importFile: () => void, openTakeout: () => void): boolean {
    if (modalOpen()) return false;
    mode = 'takeout';
    const title = text('💡 Supplement Your History with Google Takeout', '💡 使用 Google Takeout 补充历史记录');
    const description = text(
        `This scan fetched ${count} conversations. The history accessible through the Gemini website may be limited. If you have more past conversations, export your data with Google Takeout and import it into this extension for a more complete history.`,
        `本次扫描获取了 ${count} 条对话。Google Gemini 网页端可访问的历史记录可能有限。如果你有更多历史对话，可以通过 Google Takeout 导出数据，再导入本插件，以获取更完整的历史记录。`);
    const popover = overlay(null, title, description, false);
    onDismiss = dismissed;
    button(popover, '×', close);
    button(popover, text('Import Takeout ZIP', '导入 Takeout ZIP'), () => { close(); importFile(); });
    button(popover, text('Open Google Takeout', '前往 Google Takeout'), () => { close(); openTakeout(); });
    button(popover, text('Got it, don’t show again', '我知道了，不再提示'), close);
    return true;
}
export const TourGuide = { startTour, goToStep, nextStep, prevStep, finishTour, skipTour,
    startFeatureSpotlight, dismissFeatureSpotlight, showTakeoutPrompt, isActive, destroy };
export default TourGuide;
