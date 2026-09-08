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

import StorageService from '../../core/storage/storageService.js';
import TabService from '../../core/utils/tabService.js';

const getStorage = () => {
    if (typeof (globalThis as any).StorageService !== 'undefined') return (globalThis as any).StorageService;
    return StorageService;
};

const getTabService = () => {
    if (typeof (globalThis as any).TabService !== 'undefined') return (globalThis as any).TabService;
    return TabService;
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
    if (overlayEl && overlayEl.parentNode) return;

    if (typeof document.querySelectorAll === 'function') {
        document.querySelectorAll('.tour-overlay-container').forEach(el => {
            try { el.parentNode && el.parentNode.removeChild(el); } catch {}
        });
    }

    overlayEl = document.createElement('div');
    overlayEl.className = 'tour-overlay-container';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');

    spotlightEl = document.createElement('div');
    spotlightEl.className = 'tour-spotlight';

    popoverEl = document.createElement('div');
    popoverEl.className = 'tour-popover';

    overlayEl.appendChild(spotlightEl);
    overlayEl.appendChild(popoverEl);
    document.body.appendChild(overlayEl);

    document.removeEventListener('keydown', handleKeydown as any);
    window.removeEventListener('resize', handleResize);
    document.addEventListener('keydown', handleKeydown as any);
    window.addEventListener('resize', handleResize);
}

function removeElements(): void {
    stopPolling();
    clearActionListeners();
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
        document.querySelectorAll('.tour-overlay-container').forEach(el => {
            try { el.parentNode && el.parentNode.removeChild(el); } catch {}
        });
    }
    overlayEl = null;
    spotlightEl = null;
    popoverEl = null;
    isActive = false;

    if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', handleKeydown as any);
    }
    if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
    }
}

function handleKeydown(e: KeyboardEvent): void {
    if (!isActive) return;
    if (e.key === 'Escape') {
        skipTour();
    } else if (e.key === 'ArrowRight' && currentStep < STEPS.length - 1) {
        nextStep();
    } else if (e.key === 'ArrowLeft' && currentStep > 0) {
        prevStep();
    }
}

function handleResize(): void {
    if (!isActive) return;
    positionElements(STEPS[currentStep]);
}

function positionElements(step: any): void {
    if (!spotlightEl || !popoverEl || typeof window === 'undefined') return;

    const target = step.getTarget ? step.getTarget() : null;
    if (target && target.isConnected && target.offsetParent !== null) {
        const rect = target.getBoundingClientRect();
        const pad = 6;

        spotlightEl.classList.remove('tour-spotlight-hidden');
        spotlightEl.style.top = Math.max(0, rect.top - pad) + 'px';
        spotlightEl.style.left = Math.max(0, rect.left - pad) + 'px';
        spotlightEl.style.width = (rect.width + pad * 2) + 'px';
        spotlightEl.style.height = (rect.height + pad * 2) + 'px';

        if (typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        const popoverWidth = (popoverEl as HTMLElement).offsetWidth || 360;
        const popoverHeight = (popoverEl as HTMLElement).offsetHeight || 240;
        const gap = 16;
        const placement = step.placement || 'bottom';

        let popTop = 0;
        let popLeft = 0;

        if (placement === 'right') {
            popLeft = rect.right + gap;
            popTop = Math.max(16, Math.min(rect.top - 10, window.innerHeight - popoverHeight - 16));
            if (popLeft + popoverWidth > window.innerWidth - 16) {
                popLeft = Math.max(16, Math.min(rect.left, window.innerWidth - popoverWidth - 16));
                if (rect.top > popoverHeight + gap + 16) {
                    popTop = rect.top - popoverHeight - gap;
                } else {
                    popTop = rect.bottom + gap;
                }
            }
        } else if (placement === 'left') {
            popLeft = rect.left - popoverWidth - gap;
            popTop = Math.max(16, Math.min(rect.top - 10, window.innerHeight - popoverHeight - 16));
            if (popLeft < 16) {
                popLeft = 16;
                popTop = Math.max(16, Math.min(rect.top, window.innerHeight - popoverHeight - 16));
            }
        } else if (placement === 'top') {
            popTop = rect.top - popoverHeight - gap;
            popLeft = Math.max(16, Math.min(rect.left, window.innerWidth - popoverWidth - 16));
            if (popTop < 16) {
                popTop = rect.bottom + gap;
            }
        } else {
            popTop = rect.bottom + gap;
            popLeft = Math.max(16, Math.min(rect.left, window.innerWidth - popoverWidth - 16));
            if (popTop + popoverHeight > window.innerHeight - 16) {
                popTop = Math.max(16, rect.top - popoverHeight - gap);
            }
        }

        const targetSafe = {
            left: rect.left - pad,
            top: rect.top - pad,
            right: rect.right + pad,
            bottom: rect.bottom + pad
        };

        const isOverlapping = !(
            (popLeft + popoverWidth) <= targetSafe.left ||
            popLeft >= targetSafe.right ||
            (popTop + popoverHeight) <= targetSafe.top ||
            popTop >= targetSafe.bottom
        );

        if (isOverlapping) {
            const spaceRight = window.innerWidth - targetSafe.right - 16;
            const spaceLeft = targetSafe.left - 16;
            const spaceTop = targetSafe.top - 16;
            const spaceBottom = window.innerHeight - targetSafe.bottom - 16;

            if (spaceRight >= popoverWidth) {
                popLeft = targetSafe.right + gap;
                popTop = Math.max(16, Math.min(targetSafe.top, window.innerHeight - popoverHeight - 16));
            } else if (spaceLeft >= popoverWidth) {
                popLeft = Math.max(16, targetSafe.left - popoverWidth - gap);
                popTop = Math.max(16, Math.min(targetSafe.top, window.innerHeight - popoverHeight - 16));
            } else if (spaceTop >= popoverHeight) {
                popTop = Math.max(16, targetSafe.top - popoverHeight - gap);
                popLeft = Math.max(16, Math.min(targetSafe.left, window.innerWidth - popoverWidth - 16));
            } else if (spaceBottom >= popoverHeight) {
                popTop = targetSafe.bottom + gap;
                popLeft = Math.max(16, Math.min(targetSafe.left, window.innerWidth - popoverWidth - 16));
            }
        }

        popoverEl.style.top = `${popTop}px`;
        popoverEl.style.left = `${popLeft}px`;
        popoverEl.style.transform = 'none';
    } else {
        spotlightEl.classList.add('tour-spotlight-hidden');
        popoverEl.style.top = '50%';
        popoverEl.style.left = '50%';
        popoverEl.style.transform = 'translate(-50%, -50%)';
    }
}

async function checkCurrentTabStatus(): Promise<{ status: string; error?: string }> {
    const tabService = getTabService();
    if (!tabService || !tabService.checkGeminiStatus) {
        return { status: 'CONNECTED' };
    }
    try {
        return await tabService.checkGeminiStatus();
    } catch (e: any) {
        return { status: 'ERROR', error: e.message };
    }
}

function startPollingTabStatus(): void {
    stopPolling();
    pollTimer = setInterval(async () => {
        if (!isActive || currentStep !== 0) {
            stopPolling();
            return;
        }
        const status = await checkCurrentTabStatus();
        if (!isActive || currentStep !== 0) {
            return;
        }
        const prevStatus = lastTabStatus;
        if (status.status !== lastTabStatus) {
            lastTabStatus = status.status;
            updateStepContent(STEPS[0]);

            if ((prevStatus === 'NO_TAB' || prevStatus === 'NEED_REFRESH') && status.status === 'CONNECTED') {
                setTimeout(() => {
                    if (isActive && currentStep === 0) {
                        nextStep();
                    }
                }, 800);
            }
        }
    }, 1500);
}

function stopPolling(): void {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

async function updateStepContent(step: any): Promise<void> {
    if (!popoverEl) return;

    const isFinal = !!step.isFinal;
    const stepNum = currentStep + 1;
    const totalSteps = STEPS.length;

    let titleHtml = t(step.titleKey);
    let bodyHtml = '';

    if (step.isDynamicConnect) {
        const status = await checkCurrentTabStatus();
        lastTabStatus = status.status;

        if (status.status === 'NO_TAB') {
            bodyHtml = `
                <div class="tour-content">${t('tourStep1NoTab')}</div>
                <div class="tour-action-box">
                    <div class="tour-status-indicator tour-status-warn warn">⚠️ ${t('tourStep1NoTabStatus') || t('notSynced')}</div>
                    <button id="tourBtnOpenGemini" class="tour-action-btn">
                        ${t('tourStep1BtnOpen')}
                    </button>
                </div>
            `;
        } else if (status.status === 'NEED_REFRESH') {
            bodyHtml = `
                <div class="tour-content">${t('tourStep1NeedRefresh')}</div>
                <div class="tour-action-box">
                    <div class="tour-status-indicator tour-status-warn warn">⚠️ ${t('tourStep1NeedRefresh')}</div>
                    <button id="tourBtnReloadGemini" class="tour-action-btn secondary">
                        ${t('tourStep1BtnRefresh')}
                    </button>
                </div>
            `;
        } else {
            bodyHtml = `
                <div class="tour-content">${t('tourStep1ConnectedDesc') || t('tourStep1Connected')}</div>
                <div class="tour-action-box">
                    <div class="tour-status-indicator tour-status-ok ok">✅ ${t('tourStep1Connected')}</div>
                </div>
            `;
        }
    } else {
        bodyHtml = `<div class="tour-content">${t(step.descKey)}</div>`;
    }

    let hintHtml = '';
    if (step.hintKey) {
        hintHtml = `<div class="tour-action-hint">${t(step.hintKey)}</div>`;
    }

    if (!popoverEl || !isActive) return;

    popoverEl.innerHTML = `
        <div class="tour-header">
            <span class="tour-step-badge">${stepNum} / ${totalSteps}</span>
            <button class="tour-close-btn" id="tourCloseBtn" title="Close (ESC)">✕</button>
        </div>
        <div class="tour-title">${titleHtml}</div>
        ${bodyHtml}
        ${hintHtml}
        <div class="tour-footer">
            <button class="tour-skip-btn" id="tourSkipBtn">${t('tourBtnSkip')}</button>
            <div class="tour-nav-btns">
                ${currentStep > 0 ? `<button class="tour-nav-btn" id="tourPrevBtn">${t('tourBtnPrev')}</button>` : ''}
                <button class="tour-nav-btn primary" id="tourNextBtn">
                    ${isFinal ? t('tourBtnDone') : t('tourBtnNext')}
                </button>
            </div>
        </div>
    `;

    document.getElementById('tourCloseBtn')?.addEventListener('click', skipTour);
    document.getElementById('tourSkipBtn')?.addEventListener('click', skipTour);
    document.getElementById('tourPrevBtn')?.addEventListener('click', prevStep);
    document.getElementById('tourNextBtn')?.addEventListener('click', () => {
        if (isFinal) {
            finishTour();
        } else {
            nextStep();
        }
    });

    document.getElementById('tourBtnOpenGemini')?.addEventListener('click', async () => {
        const tabService = getTabService();
        if (tabService && tabService.openGeminiPage) {
            await tabService.openGeminiPage();
        } else if (typeof window !== 'undefined') {
            window.open('https://gemini.google.com/app', '_blank');
        }
        startPollingTabStatus();
    });

    document.getElementById('tourBtnReloadGemini')?.addEventListener('click', async () => {
        const tabService = getTabService();
        if (tabService && tabService.reloadGeminiTab) {
            await tabService.reloadGeminiTab();
        }
        startPollingTabStatus();
    });

    positionElements(step);
}

export async function goToStep(stepIndex: number): Promise<void> {
    if (stepIndex < 0 || stepIndex >= STEPS.length) return;
    currentStep = stepIndex;

    createElements();
    isActive = true;

    const step = STEPS[currentStep];
    if (step.isDynamicConnect) {
        startPollingTabStatus();
    } else {
        stopPolling();
    }

    await updateStepContent(step);
    bindStepAction(step);
}

export async function nextStep(): Promise<void> {
    if (currentStep < STEPS.length - 1) {
        return await goToStep(currentStep + 1);
    } else {
        return await finishTour();
    }
}

export async function prevStep(): Promise<void> {
    if (currentStep > 0) {
        return await goToStep(currentStep - 1);
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
    return await goToStep(stepIndex);
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

(TourGuide as any).TourGuide = TourGuide;
(TourGuide as any).default = TourGuide;

if (typeof globalThis !== 'undefined') {
    (globalThis as any).TourGuide = TourGuide;
}
if (typeof window !== 'undefined') {
    (window as any).TourGuide = TourGuide;
}
if (typeof module === 'object' && module.exports) {
    module.exports = TourGuide;
}

export default TourGuide;
