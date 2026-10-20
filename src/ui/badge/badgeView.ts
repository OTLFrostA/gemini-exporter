import { getSettings, updateSettings } from '../../application/settings/index.js';
import type { ExportResult } from '../../application/export/types.js';
import { getAccountContext, resolveCurrentAccount } from '../../runtime/content/accountContext.js';
import { registerCleanup } from '../../runtime/content/cleanupRegistry.js';
import { text, useSettings, observeSettings } from '../shared/settings.js';

let badge: HTMLElement | null = null;
let accountId: string | null = null;
let count: number | null = null;
let feedback: 'ok' | 'partial' | 'failed' | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let dragging = false;
let alive = false;
let positionChanged = false;
const clearFeedback = () => { clearTimeout(timer); timer = undefined; feedback = null; };
function render(): void {
    const label = badge?.querySelector('#geminiExportBadgeText');
    if (!label) return;
    label.textContent = feedback === 'ok' ? text('✓ Saved', '✓ 已保存')
        : feedback === 'partial' ? text('Some content was not saved', '部分内容未保存')
        : feedback === 'failed' ? text('Save failed', '保存失败')
        : !accountId ? text('Current account unavailable', '无法识别当前账户')
        : count === null ? text('Count unavailable', '数量暂不可用')
        : text(`${count} conversations indexed`, `已收录 ${count} 条对话`);
}
function position(left: number, top: number): void {
    if (!badge) return;
    badge.style.left = `${Math.max(8, Math.min(left, innerWidth - badge.offsetWidth - 8))}px`;
    badge.style.top = `${Math.max(8, Math.min(top, innerHeight - badge.offsetHeight - 8))}px`;
    badge.style.right = 'auto'; badge.style.bottom = 'auto';
}
export async function refreshAccount(): Promise<void> {
    const cachedId = getAccountContext()?.accountId ?? null;
    if (cachedId !== accountId) { accountId = null; count = null; clearFeedback(); render(); }
    const context = await resolveCurrentAccount();
    if (!alive) return;
    const id = context?.accountId ?? null;
    if (id !== (getAccountContext()?.accountId ?? null) || accountId === id) return;
    accountId = id; count = null; clearFeedback(); render();
    if (id) await refreshIndexCount(id);
}
/** Runtime calls this only for already observed, successfully committed Index updates. */
async function refreshIndexCount(id: string): Promise<void> {
    if (id !== accountId || !alive) return;
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getLocalIndexCount', accountId: id });
        if (!alive || accountId !== id || getAccountContext()?.accountId !== id) return;
        if (!response?.ok || !Number.isInteger(response.count) || response.count < 0) throw new Error('Invalid index count');
        count = response.count;
    } catch { if (accountId === id) count = null; }
    render();
}
/** One final result per task. Null/skipped do not create a notification. */
function showLiveSaveResultImpl(result: ExportResult | null, id = getAccountContext()?.accountId): void {
    if (!result || !alive || !id || id !== accountId) return;
    const outcome = result.failed.length || result.aborted ? 'failed'
        : result.exported && result.partial ? 'partial' : result.exported ? 'ok' : null;
    if (!outcome) return;
    clearFeedback(); feedback = outcome; render();
    timer = setTimeout(() => { feedback = null; timer = undefined; render(); }, 3000);
}
function showLiveSaveErrorImpl(id = getAccountContext()?.accountId): void {
    if (!alive || id !== accountId) return;
    clearFeedback(); feedback = 'failed'; render();
    timer = setTimeout(() => { feedback = null; timer = undefined; render(); }, 3000);
}
function ensureBadgeImpl(options: { onClick?: (event: MouseEvent) => void } = {}): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    if (badge) { if (!badge.isConnected) (document.body || document.documentElement).append(badge); return badge; }
    badge = document.createElement('div'); badge.id = 'geminiExportBadge'; alive = true;
    badge.setAttribute('role', 'button'); badge.tabIndex = 0;
    // Restore main's styled badge and pulse; keep v2 identity/count/drag lifecycle.
    // The stylesheet is already injected by manifest.json. Inline styles here previously overrode it.
    const pulse = document.createElement('span'); pulse.className = 'pulse';
    const label = document.createElement('span'); label.id = 'geminiExportBadgeText';
    badge.append(pulse, label);
    let moved = false, startX = 0, startY = 0, left = 0, top = 0;
    badge.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        dragging = true; moved = false; startX = event.clientX; startY = event.clientY;
        const rect = badge!.getBoundingClientRect(); left = rect.left; top = rect.top;
        badge!.setPointerCapture(event.pointerId);
    });
    badge.addEventListener('pointermove', event => {
        if (!dragging || Math.hypot(event.clientX - startX, event.clientY - startY) < 4 && !moved) return;
        moved = true; positionChanged = true; position(left + event.clientX - startX, top + event.clientY - startY);
    });
    badge.addEventListener('pointerup', event => {
        if (!dragging) return; dragging = false;
        badge!.releasePointerCapture(event.pointerId);
        if (moved) {
            const rect = badge!.getBoundingClientRect();
            void updateSettings({ badgePosition: { left: Math.round(rect.left), top: Math.round(rect.top) } }).catch(console.warn);
        }
    });
    badge.addEventListener('pointercancel', () => { dragging = false; moved = true; });
    const open = () => { void chrome.runtime.sendMessage({ action: 'openOptions' }).catch(console.warn); };
    badge.addEventListener('click', event => { if (moved) { moved = false; event.preventDefault(); return; } if (options.onClick) options.onClick(event); else open(); });
    badge.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    (document.body || document.documentElement).append(badge); render();
    let previousPosition: string | undefined;
    const refreshSettings = async () => {
        const settings = await getSettings();
        if (!alive) return;
        useSettings(settings, false); render();
        const signature = JSON.stringify(settings.badgePosition);
        if (signature !== previousPosition && !dragging && !positionChanged && settings.badgePosition) position(settings.badgePosition.left, settings.badgePosition.top);
        previousPosition = signature;
    };
    const stop = observeSettings(() => { positionChanged = dragging; void refreshSettings().catch(console.warn); });
    const resize = () => { if (badge) { const rect = badge.getBoundingClientRect(); position(rect.left, rect.top); } };
    window.addEventListener('resize', resize);
    // Existing Runtime route notifications; no observer or polling for counts.
    const route = () => { void refreshAccount().catch(() => { accountId = null; count = null; clearFeedback(); render(); }); };
    window.addEventListener('gemini:locationchange', route); window.addEventListener('popstate', route);
    registerCleanup(() => {
        alive = false; clearFeedback(); stop(); window.removeEventListener('resize', resize);
        window.removeEventListener('gemini:locationchange', route); window.removeEventListener('popstate', route);
        badge?.remove(); badge = null; accountId = null; count = null; positionChanged = false; dragging = false;
    });
    void refreshSettings().catch(console.warn); route(); return badge;
}
// Public UI API only. Internal implementations are deliberately unchanged in this PR.
export const ensureBadge: () => HTMLElement | null = ensureBadgeImpl;
export const showLiveSaveResult: (result: ExportResult | null, accountId: string) => void = showLiveSaveResultImpl;
export const showLiveSaveError: (accountId: string) => void = showLiveSaveErrorImpl;
export const BadgeView = { ensureBadge, refreshAccount, showLiveSaveResult, showLiveSaveError };
export default BadgeView;
