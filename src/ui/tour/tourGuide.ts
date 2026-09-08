// src/ui/tour/tourGuide.ts - Interactive Spotlight Onboarding Guide for Gemini Exporter
import type { TourGuideContract } from '../../types/ui.js';

let currentStep = 0;
let isActive = false;
let overlayEl: HTMLElement | null = null;
let spotlightEl: HTMLElement | null = null;
let popoverEl: HTMLElement | null = null;
let pollTimer: any = null;
let lastTabStatus: any = null;
let activeActionCleanup: (() => void) | null = null;

const t = (key: string, ...args: any[]): string => {
    if (typeof I18n !== 'undefined' && I18n.t) {
        return I18n.t(key, ...args);
    }
    return key;
};

const getStorage = () => {
    if (typeof StorageService !== 'undefined') return StorageService;
    if (typeof globalThis !== 'undefined' && (globalThis as any).StorageService) return (globalThis as any).StorageService;
    return null;
};

const getTabService = () => {
    if (typeof TabService !== 'undefined') return TabService;
    if (typeof globalThis !== 'undefined' && (globalThis as any).TabService) return (globalThis as any).TabService;
    return null;
};

export function clearActionListeners(): void {
    if (typeof activeActionCleanup === 'function') {
        try {
            activeActionCleanup();
        } catch (e) {
            console.warn('[TourGuide] cleanup error:', e);
        }
        activeActionCleanup = null;
    }
}

export function bindStepAction(step: any): void {
    clearActionListeners();
    if (!step || typeof step.setupAction !== 'function') return;

    let triggered = false;
    const advance = () => {
        if (!isActive || triggered) return;
        triggered = true;
        clearActionListeners();
        if (step.isFinal) {
            finishTour();
        } else {
            nextStep();
        }
    };

    try {
        activeActionCleanup = step.setupAction(advance);
    } catch (e) {
        console.warn('[TourGuide] setupAction error:', e);
    }
}

export const STEPS: any[] = [
    {
        id: 'connect',
        getTarget: () => document.getElementById('accountSlotSelect') || document.querySelector('header h1') || null,
        placement: 'bottom',
        titleKey: 'tourStep1Title',
        isDynamicConnect: true,
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const slotSelect = document.getElementById('accountSlotSelect');
            if (slotSelect) {
                const onSlotChange = () => setTimeout(advance, 300);
                slotSelect.addEventListener('change', onSlotChange);
                cleanups.push(() => slotSelect.removeEventListener('change', onSlotChange));
            }
            return () => cleanups.forEach(c => c());
        }
    },
    {
        id: 'sync',
        getTarget: () => document.getElementById('btnIncrementalScan') || null,
        placement: 'bottom',
        titleKey: 'tourStep2Title',
        descKey: 'tourStep2Desc',
        hintKey: 'tourHintClickButton',
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const btnScan = document.getElementById('btnIncrementalScan');
            if (btnScan) {
                const onScanClick = () => setTimeout(advance, 300);
                btnScan.addEventListener('click', onScanClick);
                cleanups.push(() => btnScan.removeEventListener('click', onScanClick));
            }
            const btnDeep = document.getElementById('btnDeepScan');
            if (btnDeep) {
                const onDeepClick = () => setTimeout(advance, 300);
                btnDeep.addEventListener('click', onDeepClick);
                cleanups.push(() => btnDeep.removeEventListener('click', onDeepClick));
            }
            return () => cleanups.forEach(c => c());
        }
    },
        {
        id: 'select',
        getTarget: () => {
            const firstCheckbox = document.querySelector('#list .item input[type=checkbox]');
            return firstCheckbox ? (firstCheckbox.closest('.item') as HTMLElement) : (document.getElementById('btnSelectAll') as HTMLElement);
        },
        placement: 'left',
        titleKey: 'tourStep3Title',
        descKey: 'tourStep3Desc',
        hintKey: 'tourHintSelectChat',
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const listEl = document.getElementById('list');
            if (listEl) {
                const onListChange = (e: any) => {
                    if (e.target && e.target.type === 'checkbox' && e.target.checked) {
                        setTimeout(advance, 250);
                    }
                };
                listEl.addEventListener('change', onListChange);
                cleanups.push(() => listEl.removeEventListener('change', onListChange));
            }
            const btnSelectAll = document.getElementById('btnSelectAll');
            if (btnSelectAll) {
                const onAllClick = () => setTimeout(advance, 250);
                btnSelectAll.addEventListener('click', onAllClick);
                cleanups.push(() => btnSelectAll.removeEventListener('click', onAllClick));
            }
            const btnSelectUnexported = document.getElementById('btnSelectUnexported') || document.getElementById('btnFilterNew');
            if (btnSelectUnexported) {
                const onUnexportedClick = () => setTimeout(advance, 250);
                btnSelectUnexported.addEventListener('click', onUnexportedClick);
                cleanups.push(() => btnSelectUnexported.removeEventListener('click', onUnexportedClick));
            }
            return () => cleanups.forEach(c => c());
        }
    },
    {
        id: 'export',
        getTarget: () => document.getElementById('btnExport') || null,
        placement: 'right',
        titleKey: 'tourStep4Title',
        descKey: 'tourStep4Desc',
        hintKey: 'tourHintClickExport',
        setupAction: (advance: () => void) => {
            const btnExport = document.getElementById('btnExport');
            if (btnExport) {
                const onExportClick = () => setTimeout(advance, 200);
                btnExport.addEventListener('click', onExportClick);
                return () => btnExport.removeEventListener('click', onExportClick);
            }
            return undefined;
        }
    },
    {
        id: 'feedback',
        getTarget: () => document.getElementById('feedbackBox') || document.getElementById('btnFeedback') || null,
        placement: 'right',
        titleKey: 'tourStep5Title',
        descKey: 'tourStep5Desc',
        hintKey: 'tourHintClickFeedback',
        isFinal: true,
        setupAction: (advance: () => void) => {
            const btnFeedback = document.getElementById('btnFeedback');
            if (btnFeedback) {
                const onFeedbackClick = () => setTimeout(advance, 200);
                btnFeedback.addEventListener('click', onFeedbackClick);
                return () => btnFeedback.removeEventListener('click', onFeedbackClick);
            }
            return undefined;
        }
    }
];

function createElements(): void {
    if (typeof document === 'undefined') return;
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.id = 'tourOverlay';
        overlayEl.className = 'tour-overlay';
        overlayEl.addEventListener('click', (e) => {
            if (e.target === overlayEl) {
                skipTour();
            }
        });
        document.body.appendChild(overlayEl);
    }
    if (!spotlightEl) {
        spotlightEl = document.createElement('div');
        spotlightEl.id = 'tourSpotlight';
        spotlightEl.className = 'tour-spotlight';
        document.body.appendChild(spotlightEl);
    }
    if (!popoverEl) {
        popoverEl = document.createElement('div');
        popoverEl.id = 'tourPopover';
        popoverEl.className = 'tour-popover';
        document.body.appendChild(popoverEl);
    }
}

function removeElements(): void {
    clearActionListeners();
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
    if (overlayEl) {
        try {
            if (typeof overlayEl.remove === 'function') overlayEl.remove();
            else if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl);
        } catch (e) {}
        overlayEl = null;
    }
    if (spotlightEl) {
        try {
            if (typeof spotlightEl.remove === 'function') spotlightEl.remove();
            else if (spotlightEl.parentNode) spotlightEl.parentNode.removeChild(spotlightEl);
        } catch (e) {}
        spotlightEl = null;
    }
    if (popoverEl) {
        try {
            if (typeof popoverEl.remove === 'function') popoverEl.remove();
            else if (popoverEl.parentNode) popoverEl.parentNode.removeChild(popoverEl);
        } catch (e) {}
        popoverEl = null;
    }
    isActive = false;
}

function positionSpotlight(targetEl: HTMLElement | null): void {
    if (!spotlightEl) return;
    if (!targetEl) {
        spotlightEl.style.display = 'none';
        return;
    }
    const rect = targetEl.getBoundingClientRect();
    const pad = 6;
    spotlightEl.style.display = 'block';
    spotlightEl.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlightEl.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlightEl.style.width = `${rect.width + pad * 2}px`;
    spotlightEl.style.height = `${rect.height + pad * 2}px`;
}

function positionPopover(targetEl: HTMLElement | null, placement: string = 'bottom'): void {
    if (!popoverEl) return;
    if (!targetEl) {
        popoverEl.style.top = '50%';
        popoverEl.style.left = '50%';
        popoverEl.style.transform = 'translate(-50%, -50%)';
        return;
    }

    const rect = targetEl.getBoundingClientRect();
    const pRect = popoverEl.getBoundingClientRect();
    const margin = 12;

    let top = 0;
    let left = 0;

    if (placement === 'top') {
        top = rect.top - pRect.height - margin;
        left = rect.left + (rect.width - pRect.width) / 2;
    } else if (placement === 'bottom') {
        top = rect.bottom + margin;
        left = rect.left + (rect.width - pRect.width) / 2;
    } else if (placement === 'left') {
        top = rect.top + (rect.height - pRect.height) / 2;
        left = rect.left - pRect.width - margin;
    } else {
        top = rect.top + (rect.height - pRect.height) / 2;
        left = rect.right + margin;
    }

    const maxLeft = window.innerWidth - pRect.width - 16;
    const maxTop = window.innerHeight - pRect.height - 16;
    left = Math.max(16, Math.min(left, maxLeft));
    top = Math.max(16, Math.min(top, maxTop));

    popoverEl.style.top = `${top}px`;
    popoverEl.style.left = `${left}px`;
    popoverEl.style.transform = 'none';
}

async function renderStepContent(step: any): Promise<void> {
    if (!popoverEl) return;
    const isFirst = currentStep === 0;
    const isLast = currentStep === STEPS.length - 1;

    let title = typeof t === 'function' ? t(step.titleKey) : step.titleKey;
    let desc = step.descKey && typeof t === 'function' ? t(step.descKey) : (step.desc || '');

    let dynamicContent = '';
    if (step.isDynamicConnect) {
        const tabService = getTabService();
        let isTabOpen = false;
        if (tabService && tabService.getGeminiTab) {
            try {
                const tab = await tabService.getGeminiTab();
                isTabOpen = !!tab;
            } catch { /* intentional */ }
        }
        lastTabStatus = isTabOpen;

        const statusClass = isTabOpen ? 'tour-status-indicator tour-status-ok' : 'tour-status-indicator tour-status-warn';
        const statusColor = isTabOpen ? '#34d399' : '#fbbf24';
        const statusText = isTabOpen
            ? (typeof t === 'function' ? t('tourGeminiDetected') : 'Gemini 标签页已打开')
            : (typeof t === 'function' ? t('tourGeminiNotDetected') : '未检测到 Gemini 标签页');

        dynamicContent = `
            <div class="tour-dynamic-status" style="margin: 8px 0 12px 0; font-size: 12px; display: flex; align-items: center; gap: 6px;">
                <span class="${statusClass}" style="width: 8px; height: 8px; border-radius: 50%; background: ${statusColor}; display: inline-block;"></span>
                <span>${statusText}</span>
            </div>
            ${!isTabOpen ? `<a href="https://gemini.google.com" target="_blank" style="color: var(--accent2, #06b6d4); font-size: 12px; text-decoration: underline; margin-bottom: 8px; display: inline-block;">${typeof t === 'function' ? t('tourOpenGemini') : '打开 gemini.google.com ↗'}</a>` : ''}
        `;
    }

    const hint = step.hintKey && typeof t === 'function' ? t(step.hintKey) : '';

    popoverEl.innerHTML = `
        <div class="tour-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h4 style="margin: 0; font-size: 14px; font-weight: 700; color: #fff;">${title}</h4>
            <span style="font-size: 11px; color: var(--muted, #8a92b2);">${currentStep + 1} / ${STEPS.length}</span>
        </div>
        ${desc ? `<p style="margin: 0 0 8px 0; font-size: 12px; line-height: 1.5; color: #d1d5db;">${desc}</p>` : ''}
        ${dynamicContent}
        ${hint ? `<div style="font-size: 11px; color: var(--accent2, #06b6d4); margin-bottom: 12px; font-style: italic;">💡 ${hint}</div>` : ''}
        <div class="tour-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px;">
            <button type="button" id="tourBtnSkip" class="ghost small" style="background: transparent; color: var(--muted, #8a92b2); border: none; font-size: 12px; cursor: pointer;">${typeof t === 'function' ? t('tourBtnSkip') : '跳过导览'}</button>
            <div style="display: flex; gap: 8px;">
                ${!isFirst ? `<button type="button" id="tourBtnPrev" class="ghost small" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; cursor: pointer;">${typeof t === 'function' ? t('tourBtnPrev') : '上一步'}</button>` : ''}
                <button type="button" id="tourBtnNext" class="primary small" style="padding: 4px 12px; font-size: 12px; border-radius: 6px; font-weight: 600; cursor: pointer;">${isLast ? (typeof t === 'function' ? t('tourBtnFinish') : '完成') : (typeof t === 'function' ? t('tourBtnNext') : '下一步')}</button>
            </div>
        </div>
    `;

    document.getElementById('tourBtnSkip')?.addEventListener('click', skipTour);
    document.getElementById('tourBtnPrev')?.addEventListener('click', prevStep);
    document.getElementById('tourBtnNext')?.addEventListener('click', () => {
        if (isLast) finishTour();
        else nextStep();
    });
}

export async function goToStep(stepIndex: number): Promise<void> {
    if (stepIndex < 0 || stepIndex >= STEPS.length) return;
    currentStep = stepIndex;
    isActive = true;
    createElements();

    const step = STEPS[currentStep];
    const targetEl = step.getTarget ? step.getTarget() : null;

    positionSpotlight(targetEl);
    await renderStepContent(step);
    positionPopover(targetEl, step.placement || 'bottom');

    bindStepAction(step);

    if (step.isDynamicConnect) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(async () => {
            const tabService = getTabService();
            if (tabService && tabService.getGeminiTab) {
                try {
                    const tab = await tabService.getGeminiTab();
                    const isOpen = !!tab;
                    if (isOpen !== lastTabStatus) {
                        await renderStepContent(step);
                        positionPopover(targetEl, step.placement || 'bottom');
                    }
                } catch { /* intentional */ }
            }
        }, 1500);
    } else {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }
}

export async function nextStep(): Promise<void> {
    if (currentStep < STEPS.length - 1) {
        await goToStep(currentStep + 1);
    } else {
        await finishTour();
    }
}

export async function prevStep(): Promise<void> {
    if (currentStep > 0) {
        await goToStep(currentStep - 1);
    }
}

export async function finishTour(): Promise<void> {
    const storage = getStorage();
    if (storage && storage.setTourCompleted) {
        await storage.setTourCompleted(true);
    }
    removeElements();
}

export async function skipTour(): Promise<void> {
    const storage = getStorage();
    if (storage && storage.setTourCompleted) {
        await storage.setTourCompleted(true);
    }
    removeElements();
}

export async function startTour(stepIndex: number = 0): Promise<void> {
    await goToStep(stepIndex);
}

export const TourGuide: TourGuideContract = {
    startTour,
    goToStep,
    nextStep,
    prevStep,
    finishTour,
    skipTour,
    isActive: () => isActive,
    getCurrentStep: () => currentStep,
    destroy: removeElements,
    clearActionListeners,
    bindStepAction,
    STEPS
};

if (typeof module === 'object' && module.exports) {
    module.exports = TourGuide;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).TourGuide = TourGuide;
}
