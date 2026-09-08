// src/content/badgeView.ts - Draggable Badge UI & Position Management
let __lastKnownCount: number | null = null;

export function applyStoredBadgePosition(el: HTMLElement | null): void {
    if (!el) return;
    try {
        const raw = localStorage.getItem('gemini_export_badge_pos');
        if (raw) {
            const pos = JSON.parse(raw);
            if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                const maxLeft = Math.max(8, window.innerWidth - (el.offsetWidth || 110) - 8);
                const maxTop = Math.max(8, window.innerHeight - (el.offsetHeight || 34) - 8);
                const left = Math.min(Math.max(8, pos.left), maxLeft);
                const top = Math.min(Math.max(8, pos.top), maxTop);
                el.style.left = `${left}px`;
                el.style.top = `${top}px`;
                el.style.right = 'auto';
                el.style.bottom = 'auto';
            }
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:badgeView]', e);
    }
}

export function makeBadgeDraggable(div: HTMLElement, onClick?: (e: MouseEvent) => void): void {
    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let origLeft = 0, origTop = 0;
    let justDragged = false;

    div.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 0) return;
        isDragging = true;
        hasMoved = false;
        startX = e.clientX;
        startY = e.clientY;
        const rect = div.getBoundingClientRect();
        origLeft = rect.left;
        origTop = rect.top;
        try {
            div.setPointerCapture(e.pointerId);
        } catch {
            /* intentional: best-effort cleanup */
        }
    });

    div.addEventListener('pointermove', (e: PointerEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!hasMoved && Math.hypot(dx, dy) < 4) {
            return;
        }
        if (!hasMoved) {
            hasMoved = true;
            div.classList.add('dragging');
        }

        const maxLeft = Math.max(8, window.innerWidth - (div.offsetWidth || 110) - 8);
        const maxTop = Math.max(8, window.innerHeight - (div.offsetHeight || 34) - 8);
        const newLeft = Math.min(Math.max(8, origLeft + dx), maxLeft);
        const newTop = Math.min(Math.max(8, origTop + dy), maxTop);

        div.style.left = `${newLeft}px`;
        div.style.top = `${newTop}px`;
        div.style.right = 'auto';
        div.style.bottom = 'auto';
    });

    const stopDrag = (e: PointerEvent) => {
        if (!isDragging) return;
        isDragging = false;
        div.classList.remove('dragging');
        try {
            div.releasePointerCapture(e.pointerId);
        } catch {
            /* intentional: best-effort cleanup */
        }

        if (hasMoved) {
            justDragged = true;
            setTimeout(() => { justDragged = false; }, 150);
            const rect = div.getBoundingClientRect();
            const pos = { left: Math.round(rect.left), top: Math.round(rect.top) };
            try {
                localStorage.setItem('gemini_export_badge_pos', JSON.stringify(pos));
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({ gemini_export_badge_pos: pos }).catch?.(() => {});
                }
            } catch (e) {
                console.warn('[GemExporter:storage] Storage operation failed:', e);
            }
        }
    };

    div.addEventListener('pointerup', stopDrag);
    div.addEventListener('pointercancel', stopDrag);

    div.addEventListener('click', (e: MouseEvent) => {
        if (justDragged || hasMoved) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (typeof onClick === 'function') {
            onClick(e);
        } else {
            try {
                const p = chrome.runtime.sendMessage({ action: 'openOptions' });
                if (p && p.catch) p.catch(() => {});
            } catch (e) {
                if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:badgeView]', e);
            }
        }
    });
}

if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
        const existing = document.getElementById('geminiExportBadge');
        if (existing && existing.style.left) {
            applyStoredBadgePosition(existing);
        }
    });
}

export function ensureBadge(opts: { isZh?: () => boolean; onClick?: (e: MouseEvent) => void } = {}): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    let existing = document.getElementById('geminiExportBadge');
    if (existing) {
        if (!existing.isConnected) {
            (document.body || document.documentElement).appendChild(existing);
        } else if (document.body && existing.parentElement !== document.body) {
            document.body.appendChild(existing);
        }
        applyStoredBadgePosition(existing);
        return existing;
    }
    const zh = opts.isZh ? opts.isZh() : true;
    const div = document.createElement('div');
    div.id = 'geminiExportBadge';
    const initText = (__lastKnownCount !== null)
        ? (zh ? `已同步 ${__lastKnownCount} 条` : `${__lastKnownCount} synced`)
        : (zh ? '就绪' : 'Ready');
    div.innerHTML = `<span class="pulse"></span><span id="geminiExportBadgeText">${initText}</span>`;
    div.title = zh ? '点此打开批量导出页 (可拖拽移动)' : 'Click to open Export Workbench (Drag to move)';
    makeBadgeDraggable(div, opts.onClick);
    (document.body || document.documentElement).appendChild(div);
    applyStoredBadgePosition(div);
    return div;
}

export function ensureBadgeAndText(opts: { isZh?: () => boolean; onClick?: (e: MouseEvent) => void } = {}): { badge: HTMLElement | null; txt: HTMLElement | null } {
    const badge = ensureBadge(opts);
    const txt = typeof document !== 'undefined' ? document.getElementById('geminiExportBadgeText') : null;
    return { badge, txt };
}

export function updateBadge(
    mergedLen?: number,
    visible?: number,
    overrideText?: string,
    isSyncing = false,
    opts: { isZh?: () => boolean; getAccountSlot?: () => string; onClick?: (e: MouseEvent) => void } = {}
): void {
    try {
        const { txt, badge } = ensureBadgeAndText(opts);
        if (!txt) return;
        if (badge) {
            if (isSyncing) badge.classList.add('syncing');
            else badge.classList.remove('syncing');
        }
        if (typeof mergedLen === 'number' && mergedLen >= 0) {
            __lastKnownCount = mergedLen;
        }
        const zh = opts.isZh ? opts.isZh() : true;
        let targetText = '';
        if (overrideText) {
            targetText = overrideText;
        } else {
            targetText = zh ? `已同步 ${mergedLen} 条` : `${mergedLen} synced`;
        }
        if (txt.textContent !== targetText) {
            txt.textContent = targetText;
        }
        const slot = opts.getAccountSlot ? opts.getAccountSlot() : 'u0';
        if (badge) {
            const targetTitle = (slot !== 'u0')
                ? (zh ? `当前账号 (${slot.toUpperCase()}): 点击打开导出页` : `Account (${slot.toUpperCase()}): Click to open Export`)
                : (zh ? '点此打开批量导出页' : 'Click to open Export Workbench');
            if (badge.title !== targetTitle) {
                badge.title = targetTitle;
            }
        }
    } catch (e) {
        console.warn('[Gemini Exporter] updateBadge err', e);
    }
}

export function getLastKnownCount(): number | null {
    return __lastKnownCount;
}

export function setLastKnownCount(val: number | null): void {
    __lastKnownCount = val;
}

export const BadgeView = {
    applyStoredBadgePosition,
    makeBadgeDraggable,
    ensureBadge,
    ensureBadgeAndText,
    updateBadge,
    getLastKnownCount,
    setLastKnownCount
};


if (typeof module !== 'undefined' && (module as any).exports) (module as any).exports = BadgeView;
