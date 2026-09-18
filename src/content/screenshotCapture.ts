// src/content/screenshotCapture.ts - In-page viewport scrolling and element suppression for long screenshot
export interface ScrollContainerInfo {
    el: HTMLElement | Window;
    isWindow: boolean;
    getScrollTop: () => number;
    setScrollTop: (val: number) => void;
    getScrollHeight: () => number;
    getClientHeight: () => number;
    getClientWidth: () => number;
}

export interface ScreenshotPrepareResult {
    ok: boolean;
    totalHeight: number;
    viewportHeight: number;
    viewportWidth: number;
    devicePixelRatio: number;
    originalScrollTop: number;
    error?: string;
}

let _originalScrollTop = 0;
let _hiddenElements: { el: HTMLElement; origVisibility: string }[] = [];

/**
 * Resolves the primary scroll container of the Gemini chat page.
 */
export function findChatScrollContainer(): ScrollContainerInfo {
    if (typeof document === 'undefined') {
        throw new Error('document is not defined');
    }

    const candidates = [
        'infinite-scroller',
        'chat-window',
        'main',
        'div[class*="conversation-container"]',
        '.chat-history',
        'ms-chat-container'
    ];

    for (const sel of candidates) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.scrollHeight > el.clientHeight + 10) {
            return {
                el,
                isWindow: false,
                getScrollTop: () => el.scrollTop,
                setScrollTop: (v: number) => { el.scrollTop = v; },
                getScrollHeight: () => el.scrollHeight,
                getClientHeight: () => el.clientHeight,
                getClientWidth: () => el.clientWidth
            };
        }
    }

    // Fallback to window/document.scrollingElement
    const docEl = document.scrollingElement || document.documentElement || document.body;
    return {
        el: window,
        isWindow: true,
        getScrollTop: () => window.scrollY || docEl.scrollTop,
        setScrollTop: (v: number) => {
            window.scrollTo(0, v);
            docEl.scrollTop = v;
        },
        getScrollHeight: () => Math.max(docEl.scrollHeight, document.body.scrollHeight),
        getClientHeight: () => window.innerHeight || docEl.clientHeight,
        getClientWidth: () => window.innerWidth || docEl.clientWidth
    };
}

/**
 * Selectors for fixed or sticky UI overlays that should be hidden during scrolling.
 */
const OVERLAY_SELECTORS = [
    'header',
    'nav[role="navigation"]',
    '.top-app-bar',
    '[data-test-id="side-nav-toggle"]',
    '.bottom-container',
    '.input-area',
    'chat-input',
    'footer',
    '[class*="input-area"]',
    'button[aria-label*="Help"]',
    'button[aria-label*="帮助"]',
    '#geminiExportBadge'
];

/**
 * Prepares the page for screenshot capture by hiding floating headers/footers
 * and measuring dimensions.
 */
export function prepareForCapture(): ScreenshotPrepareResult {
    try {
        const container = findChatScrollContainer();
        _originalScrollTop = container.getScrollTop();
        _hiddenElements = [];

        for (const sel of OVERLAY_SELECTORS) {
            const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
            for (const el of els) {
                if (el && el.style.visibility !== 'hidden') {
                    _hiddenElements.push({
                        el,
                        origVisibility: el.style.visibility || ''
                    });
                    el.style.visibility = 'hidden';
                }
            }
        }

        return {
            ok: true,
            totalHeight: container.getScrollHeight(),
            viewportHeight: container.getClientHeight(),
            viewportWidth: container.getClientWidth(),
            devicePixelRatio: window.devicePixelRatio || 1,
            originalScrollTop: _originalScrollTop
        };
    } catch (e: any) {
        return {
            ok: false,
            totalHeight: 0,
            viewportHeight: 0,
            viewportWidth: 0,
            devicePixelRatio: 1,
            originalScrollTop: 0,
            error: e?.message || String(e)
        };
    }
}

/**
 * Scrolls the container to the designated Y position and yields to the layout engine.
 */
export async function scrollToStep(targetY: number): Promise<number> {
    const container = findChatScrollContainer();
    container.setScrollTop(targetY);

    // Yield two frames for paint and composition
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // Additional brief settle time for dynamic images/fonts
    await new Promise((r) => setTimeout(r, 120));

    return container.getScrollTop();
}

/**
 * Restores original scroll position and un-hides UI elements.
 */
export function restoreAfterCapture(originalScrollTop?: number): boolean {
    try {
        const container = findChatScrollContainer();
        const restoreY = typeof originalScrollTop === 'number' ? originalScrollTop : _originalScrollTop;
        container.setScrollTop(restoreY);

        for (const item of _hiddenElements) {
            try {
                if (item.el) {
                    item.el.style.visibility = item.origVisibility;
                }
            } catch { /* ignore detached nodes */ }
        }
        _hiddenElements = [];
        return true;
    } catch (e) {
        console.warn('[ScreenshotCapture] restoreAfterCapture error', e);
        return false;
    }
}

export const ScreenshotCapture = {
    findChatScrollContainer,
    prepareForCapture,
    scrollToStep,
    restoreAfterCapture
};

export default ScreenshotCapture;
