import { STEPS } from './tourSteps.js';
import { text } from '../shared/settings.js';
import { mountTourConnection } from './tourConnection.js';
export { STEPS } from './tourSteps.js';
let root: HTMLElement | null = null;
let stepIndex = 0;
let mode: 'tour' | 'spotlight' | 'takeout' | null = null;
let cleanupStep: (() => void) | undefined;
let cleanupOverlay: (() => void) | undefined;
let onDismiss: (() => void) | undefined;
let relayout: (() => void) | undefined;
let connectionReady = false;
let onConnected: ((accountId: string) => Promise<void>) | undefined;

export function consumeTourIntent(): boolean {
    const url = new URL(location.href);
    const start = url.searchParams.get('startTour') === '1';
    if (url.searchParams.has('startTour')) { url.searchParams.delete('startTour'); history.replaceState(history.state, '', url); }
    return start;
}
export function destroy(): void {
    cleanupStep?.(); cleanupStep = undefined;
    cleanupOverlay?.(); cleanupOverlay = undefined;
    root?.remove(); root = null; mode = null; onDismiss = undefined; relayout = undefined;
    connectionReady = false; onConnected = undefined;
}
function close(): void { const callback = onDismiss; destroy(); callback?.(); }
export const finishTour = async (): Promise<void> => { destroy(); };
export const skipTour = finishTour;
export const dismissFeatureSpotlight = async (): Promise<void> => { close(); };
export const isActive = (): boolean => root !== null;
function modalOpen(): boolean { return isActive() || !!document.querySelector('dialog[open], [aria-modal="true"]'); }


type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Render the original main Tour card and highlight, retaining v2's physical click cutout. */
function overlay(
    target: HTMLElement | null | (() => HTMLElement | null), title: string, description: string | HTMLElement, interactive: boolean,
    related: HTMLElement[] = [], placement: Placement = 'bottom', badgeText?: string, hint?: string,
): HTMLElement {
    cleanupStep?.(); cleanupStep = undefined;
    cleanupOverlay?.(); cleanupOverlay = undefined;
    root?.remove();
    const previousFocus = document.activeElement as HTMLElement | null;
    const currentTarget = () => typeof target === 'function' ? target() : target;
    currentTarget()?.scrollIntoView({ block: 'center', inline: 'nearest' });
    root = document.createElement('div');
    root.className = 'tour-overlay-container';

    const spotlight = document.createElement('div');
    spotlight.className = 'tour-spotlight';
    const popover = document.createElement('div');
    popover.className = 'tour-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-modal', 'true');
    popover.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'tour-header';
    const badge = document.createElement('span');
    badge.className = mode === 'spotlight' ? 'tour-step-badge tour-feature-badge' : 'tour-step-badge';
    badge.textContent = badgeText ?? (String(stepIndex + 1) + ' / ' + String(STEPS.length));
    const closeButton = button(header, '×', close, 'tourCloseBtn', 'tour-close-btn');
    closeButton.title = text('Close (ESC)', '关闭（ESC）');
    header.prepend(badge);

    const heading = document.createElement('h2');
    heading.className = 'tour-title';
    heading.textContent = title;
    const body = document.createElement('div');
    body.className = 'tour-content';
    if (typeof description === 'string') body.textContent = description;
    else body.append(description);
    popover.append(header, heading, body);
    if (hint) {
        const hintBox = document.createElement('div');
        hintBox.className = 'tour-action-hint';
        hintBox.textContent = hint;
        popover.append(hintBox);
    }
    root.append(spotlight, popover);
    document.body.append(root);

    const backdrop: HTMLElement[] = [];
    const layout = () => {
        backdrop.forEach(el => el.remove());
        backdrop.length = 0;
        const candidate = currentTarget();
        const visible = candidate && candidate.isConnected && candidate.getClientRects().length ? candidate : null;
        const rect = visible?.getBoundingClientRect();
        const pad = 6;
        if (rect) {
            spotlight.classList.remove('tour-spotlight-hidden');
            Object.assign(spotlight.style, {
                left: Math.max(0, rect.left - pad) + 'px',
                top: Math.max(0, rect.top - pad) + 'px',
                width: (rect.width + 2 * pad) + 'px',
                height: (rect.height + 2 * pad) + 'px',
            });
        } else {
            spotlight.classList.add('tour-spotlight-hidden');
        }

        // Only the highlighted UI and explicit related controls are physically clickable.
        const regions = interactive ? [visible, ...related].filter((item): item is HTMLElement =>
            !!item && item.isConnected && !!item.getClientRects().length) : [];
        const bounds = regions.map(item => item.getBoundingClientRect());
        const hole = bounds.length ? {
            top: Math.min(...bounds.map(item => item.top)),
            left: Math.min(...bounds.map(item => item.left)),
            right: Math.max(...bounds.map(item => item.right)),
            bottom: Math.max(...bounds.map(item => item.bottom)),
        } : null;
        const holeHeight = hole ? hole.bottom - hole.top : 0;
        const w = window.innerWidth, h = window.innerHeight;
        const boxes = hole ? [
            [0, 0, w, Math.max(0, hole.top)],
            [0, hole.top, Math.max(0, hole.left), holeHeight],
            [hole.right, hole.top, Math.max(0, w - hole.right), holeHeight],
            [0, hole.bottom, w, Math.max(0, h - hole.bottom)],
        ] : [[0, 0, w, h]];
        for (const [left, top, width, height] of boxes) {
            const panel = document.createElement('div');
            panel.className = 'tour-backdrop';
            Object.assign(panel.style, {
                left: left + 'px', top: top + 'px', width: width + 'px', height: height + 'px',
            });
            panel.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); close(); });
            root!.prepend(panel);
            backdrop.push(panel);
        }

        // Respect the original per-step right/left/bottom placements; avoid collision.
        const width = popover.offsetWidth, height = popover.offsetHeight;
        let x = (w - width) / 2, y = (h - height) / 2;
        if (rect) {
            const gap = 16, margin = 16;
            const available: Placement[] = [placement, 'right', 'left', 'bottom', 'top'];
            for (const side of [...new Set(available)]) {
                if (side === 'right' && rect.right + width + gap + margin <= w) {
                    x = rect.right + gap; y = rect.top - 10; break;
                }
                if (side === 'left' && rect.left - width - gap >= margin) {
                    x = rect.left - width - gap; y = rect.top - 10; break;
                }
                if (side === 'bottom' && rect.bottom + height + gap + margin <= h) {
                    x = rect.left; y = rect.bottom + gap; break;
                }
                if (side === 'top' && rect.top - height - gap >= margin) {
                    x = rect.left; y = rect.top - height - gap; break;
                }
            }
        }
        // CSS viewport bounds apply immediately, even before the resize handler runs.
        popover.style.left = `clamp(12px, ${x}px, calc(100vw - ${width}px - 12px))`;
        popover.style.top = `clamp(12px, ${y}px, calc(100vh - ${height}px - 12px))`;
        popover.style.transform = 'none';
    };
    const guard = (event: MouseEvent) => {
        const node = event.target as Node;
        if (popover.contains(node) || interactive && [currentTarget(), ...related].some(item => item?.contains(node))) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        close();
    };
    const keydown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    };
    document.addEventListener('click', guard, true);
    document.addEventListener('keydown', keydown, true);
    window.addEventListener('resize', layout);
    window.addEventListener('scroll', layout, true);
    const frame = requestAnimationFrame(layout);
    // Options re-renders rows with replaceChildren() while a scan completes.
    // Follow the live row without binding to a detached DOM node.
    const list = mode === 'tour' && STEPS[stepIndex]?.id === 'select' ? document.getElementById('list') : null;
    const observer = list ? new MutationObserver(layout) : null;
    if (list) observer?.observe(list, { childList: true });
    const sizeObserver = new ResizeObserver(layout);
    sizeObserver.observe(popover);
    cleanupOverlay = () => {
        observer?.disconnect();
        sizeObserver.disconnect();
        cancelAnimationFrame(frame);
        document.removeEventListener('click', guard, true);
        document.removeEventListener('keydown', keydown, true);
        window.removeEventListener('resize', layout);
        window.removeEventListener('scroll', layout, true);
        previousFocus?.focus?.();
    };
    relayout = layout;
    layout();
    popover.focus();
    return popover;
}
function button(
    parent: HTMLElement, label: string, action: () => void, id?: string, className?: string,
): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    if (id) btn.id = id;
    if (className) btn.className = className;
    btn.addEventListener('click', action);
    parent.append(btn);
    return btn;
}
function footer(popover: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tour-footer';
    popover.append(el);
    return el;
}

export async function goToStep(index: number): Promise<void> {
    if (mode !== 'tour') return;
    if (index >= STEPS.length) { destroy(); return; }
    stepIndex = Math.max(0, index);
    const step = STEPS[stepIndex];
    const relatedId = step.id === 'live_save' ? 'btnSetDir' : step.id === 'select' ? 'btnSelectAll' : undefined;
    const related = relatedId
        ? [document.getElementById(relatedId)].filter((item): item is HTMLElement => item instanceof HTMLElement)
        : [];
    const popover = overlay(step.target, step.title(), step.description(), true,
        related, step.placement, undefined, step.hint?.());
    const navFooter = footer(popover);
    button(navFooter, text('Skip', '跳过'), () => { destroy(); }, 'tourSkipBtn', 'tour-skip-btn');
    const nav = document.createElement('div');
    nav.className = 'tour-nav-btns';
    navFooter.append(nav);
    if (stepIndex) button(nav, text('Back', '上一步'), () => { void prevStep(); },
        'tourPrevBtn', 'tour-nav-btn');
    const nextButton = button(nav, stepIndex === STEPS.length - 1 ? text('Start using', '开始使用') : text('Next', '下一步'),
        () => { void nextStep(); }, 'tourNextBtn', 'tour-nav-btn primary');
    relayout?.();

    let advanced = false;
    const advance = () => {
        if (advanced || mode !== 'tour' || STEPS[stepIndex] !== step) return;
        advanced = true;
        void nextStep();
    };
    cleanupStep = step.setupAction?.(advance);
    if (step.id === 'connect') {
        connectionReady = false;
        nextButton.disabled = true;
        const selectAccount = onConnected;
        cleanupStep = mountTourConnection(popover, navFooter, async (accountId, shouldAdvance) => {
            await selectAccount?.(accountId);
            if (mode !== 'tour' || STEPS[stepIndex] !== step || !popover.isConnected) return;
            connectionReady = true;
            nextButton.disabled = false;
            if (shouldAdvance) advance();
        });
    }
}
export async function nextStep(): Promise<void> {
    if (STEPS[stepIndex]?.id === 'connect' && !connectionReady) return;
    await goToStep(stepIndex + 1);
}
export async function prevStep(): Promise<void> { await goToStep(stepIndex - 1); }
export async function startTour(connected?: (accountId: string) => Promise<void>): Promise<void> {
    if (modalOpen()) return;
    destroy(); mode = 'tour'; onConnected = connected; await goToStep(0);
}

export function startFeatureSpotlight(version: string, stepId: string, dismissed: () => void): boolean {
    if (modalOpen()) return false;
    const step = STEPS.find(item => item.id === stepId);
    const target = step?.target();
    if (!step || !target || !target.getClientRects().length) return false;
    mode = 'spotlight';
    const popover = overlay(target, step.title(), step.description(), false, [],
        step.placement, '✨ ' + text('NEW FEATURE', '新功能') + ' v' + version);
    onDismiss = dismissed;
    const bar = footer(popover);
    const nav = document.createElement('div');
    nav.className = 'tour-nav-btns';
    bar.append(nav);
    button(nav, text('Got it', '知道了'), close, 'tourSpotlightDismissBtn', 'tour-nav-btn primary');
    relayout?.();
    return true;
}
/** One-time release notice for users crossing from v1 to 2.0. No feature target. */
export function showV2UpgradeSpotlight(openFeedback: () => void): boolean {
    if (modalOpen()) return false;
    mode = 'spotlight';
    const copy = document.createElement('div');
    copy.className = 'tour-upgrade-copy';
    const paragraph = (message: string): HTMLParagraphElement => {
        const p = document.createElement('p');
        p.textContent = message;
        copy.append(p);
        return p;
    };
    paragraph(text(
        "We've rebuilt Gemini Exporter from the ground up for better long-term stability and reliability.",
        '我们从底层重构了 Gemini Exporter，以提升长期稳定性和可靠性。'));
    const notice = paragraph(text(
        'Some scan records may be missing after this upgrade. Your original Gemini chats are safe.',
        '升级后，部分扫描记录可能不再显示。您在 Gemini 中的原始对话不受影响。'));
    const warning = document.createElement('strong');
    warning.textContent = text('Important: ', '重要提示：');
    notice.prepend(warning);
    paragraph(text(
        "To restore them, simply scan again. If that doesn't work, try Clear Scan Records and rescan.",
        '重新扫描即可恢复。如果仍有问题，请先清除扫描记录，然后再次扫描。'));
    paragraph(text(
        'Having trouble? Please let us know through Leave Feedback!',
        '遇到问题？欢迎通过「留言反馈」告诉我们！'));
    const popover = overlay(null,
        text('Gemini Exporter 2.0 is Here!', 'Gemini Exporter 2.0 正式发布！'),
        copy, false, [], 'bottom', '✨ ' + text('MAJOR UPDATE', '重大更新'));
    popover.classList.add('tour-upgrade-popover');
    const bar = footer(popover);
    bar.classList.add('tour-upgrade-footer');
    button(bar, text('Leave Feedback', '留言反馈'),
        () => { close(); openFeedback(); }, 'tourUpgradeFeedbackBtn', 'tour-nav-btn');
    button(bar, text('Got it!', '知道了！'), close, 'tourUpgradeDismissBtn', 'tour-nav-btn primary');
    relayout?.();
    return true;
}
export function showTakeoutPrompt(
    count: number, dismissed: () => void, importFile: () => void, openTakeout: () => void,
): boolean {
    if (modalOpen()) return false;
    mode = 'takeout';
    const title = text('💡 Supplement Your History with Google Takeout', '💡 使用 Google Takeout 补充历史记录');
    const description = text(
        'This scan fetched ' + count + ' conversations. The history accessible through the Gemini website may be limited. If you have more past conversations, export your data with Google Takeout and import it into this extension for a more complete history.',
        '本次扫描获取了 ' + count + ' 条对话。Google Gemini 网页端可访问的历史记录可能有限。如果你有更多历史对话，可以通过 Google Takeout 导出数据，再导入本插件，以获取更完整的历史记录。');
    const popover = overlay(null, title, description, false, [], 'bottom',
        '💡 ' + text('TAKEOUT', '历史记录'));
    onDismiss = dismissed;
    const bar = footer(popover);
    bar.classList.add('tour-takeout-footer');
    button(bar, text('Got it, don’t show again', '我知道了，不再提示'),
        close, 'tourTakeoutDismissBtn', 'tour-skip-btn');
    const nav = document.createElement('div');
    nav.className = 'tour-nav-btns';
    bar.append(nav);
    button(nav, text('Open Google Takeout', '前往 Google Takeout'), () => {
        close(); openTakeout();
    }, 'tourTakeoutGoWebBtn', 'tour-nav-btn');
    button(nav, text('Import Takeout ZIP', '导入 Takeout ZIP'), () => {
        close(); importFile();
    }, 'tourTakeoutImportBtn', 'tour-nav-btn primary');
    relayout?.();
    return true;
}
export const TourGuide = { startTour, goToStep, nextStep, prevStep, finishTour, skipTour,
    startFeatureSpotlight, showV2UpgradeSpotlight, dismissFeatureSpotlight, showTakeoutPrompt, isActive, destroy };
export default TourGuide;
