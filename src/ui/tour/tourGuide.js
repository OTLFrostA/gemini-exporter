// tourGuide.js - Interactive Spotlight Onboarding Guide for Gemini Exporter
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.TourGuide = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    let currentStep = 0;
    let isActive = false;
    let overlayEl = null;
    let spotlightEl = null;
    let popoverEl = null;
    let pollTimer = null;
    let lastTabStatus = null;
    let activeActionCleanup = null;

    const t = (key, ...args) => {
        if (typeof I18n !== 'undefined' && I18n.t) {
            return I18n.t(key, ...args);
        }
        return key;
    };

    const getStorage = () => (typeof StorageService !== 'undefined' ? StorageService : null);
    const getTabService = () => (typeof TabService !== 'undefined' ? TabService : null);

    function clearActionListeners() {
        if (typeof activeActionCleanup === 'function') {
            try {
                activeActionCleanup();
            } catch (e) {
                console.warn('[TourGuide] cleanup error:', e);
            }
            activeActionCleanup = null;
        }
    }

    function bindStepAction(step) {
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

    const STEPS = [
        {
            id: 'connect',
            getTarget: () => document.getElementById('accountSlotSelect') || document.querySelector('header h1') || null,
            titleKey: 'tourStep1Title',
            isDynamicConnect: true,
            setupAction: (advance) => {
                const cleanups = [];
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
            titleKey: 'tourStep2Title',
            descKey: 'tourStep2Desc',
            hintKey: 'tourHintClickButton',
            setupAction: (advance) => {
                const cleanups = [];
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
                return firstCheckbox ? firstCheckbox.closest('.item') : document.getElementById('btnSelectAll');
            },
            titleKey: 'tourStep3Title',
            descKey: 'tourStep3Desc',
            hintKey: 'tourHintSelectChat',
            setupAction: (advance) => {
                const cleanups = [];
                const listEl = document.getElementById('list');
                if (listEl) {
                    const onListChange = (e) => {
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
            titleKey: 'tourStep4Title',
            descKey: 'tourStep4Desc',
            hintKey: 'tourHintClickExport',
            isFinal: true,
            setupAction: (advance) => {
                const btnExport = document.getElementById('btnExport');
                if (btnExport) {
                    const onExportClick = () => setTimeout(advance, 200);
                    btnExport.addEventListener('click', onExportClick);
                    return () => btnExport.removeEventListener('click', onExportClick);
                }
            }
        }
    ];

    function createElements() {
        if (overlayEl && overlayEl.parentNode) return;

        // Clean up any stale or orphan containers in DOM
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

        document.removeEventListener('keydown', handleKeydown);
        window.removeEventListener('resize', handleResize);
        document.addEventListener('keydown', handleKeydown);
        window.addEventListener('resize', handleResize);
    }

    function removeElements() {
        stopPolling();
        clearActionListeners();
        if (typeof document.querySelectorAll === 'function') {
            document.querySelectorAll('.tour-overlay-container').forEach(el => {
                try { el.parentNode && el.parentNode.removeChild(el); } catch {}
            });
        }
        overlayEl = null;
        spotlightEl = null;
        popoverEl = null;
        isActive = false;

        document.removeEventListener('keydown', handleKeydown);
        window.removeEventListener('resize', handleResize);
    }

    function handleKeydown(e) {
        if (!isActive) return;
        if (e.key === 'Escape') {
            skipTour();
        } else if (e.key === 'ArrowRight' && currentStep < STEPS.length - 1) {
            nextStep();
        } else if (e.key === 'ArrowLeft' && currentStep > 0) {
            prevStep();
        }
    }

    function handleResize() {
        if (!isActive) return;
        positionElements(STEPS[currentStep]);
    }

    function positionElements(step) {
        if (!spotlightEl || !popoverEl) return;

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

            // Position popover
            const popoverWidth = 360;
            const popoverHeight = 220; // approximate
            let popTop = rect.bottom + 14;
            let popLeft = Math.max(16, Math.min(rect.left, window.innerWidth - popoverWidth - 16));

            // Flip above if overflowing bottom
            if (popTop + popoverHeight > window.innerHeight && rect.top > popoverHeight + 20) {
                popTop = Math.max(16, rect.top - popoverHeight - 14);
            }

            popoverEl.style.top = `${popTop}px`;
            popoverEl.style.left = `${popLeft}px`;
            popoverEl.style.transform = 'none';
        } else {
            // Center in screen if target not found
            spotlightEl.classList.add('tour-spotlight-hidden');
            popoverEl.style.top = '50%';
            popoverEl.style.left = '50%';
            popoverEl.style.transform = 'translate(-50%, -50%)';
        }
    }

    async function checkCurrentTabStatus() {
        const tabService = getTabService();
        if (!tabService || !tabService.checkGeminiStatus) {
            return { status: 'CONNECTED' };
        }
        try {
            return await tabService.checkGeminiStatus();
        } catch (e) {
            return { status: 'ERROR', error: e.message };
        }
    }

    function startPollingTabStatus() {
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

    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function updateStepContent(step) {
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
                        <div class="tour-status-indicator warn">⚠️ ${t('notSynced')}</div>
                        <button id="tourBtnOpenGemini" class="tour-action-btn">
                            ${t('tourStep1BtnOpen')}
                        </button>
                    </div>
                `;
            } else if (status.status === 'NEED_REFRESH') {
                bodyHtml = `
                    <div class="tour-content">${t('tourStep1NeedRefresh')}</div>
                    <div class="tour-action-box">
                        <div class="tour-status-indicator warn">⚠️ ${t('tourStep1NeedRefresh')}</div>
                        <button id="tourBtnReloadGemini" class="tour-action-btn secondary">
                            ${t('tourStep1BtnRefresh')}
                        </button>
                    </div>
                `;
            } else {
                bodyHtml = `
                    <div class="tour-content">${t('tourStep1Connected')}</div>
                    <div class="tour-action-box">
                        <div class="tour-status-indicator ok">✅ ${t('tourStep1Connected')}</div>
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

        // Bind events inside popover
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

        // Dynamic action buttons
        document.getElementById('tourBtnOpenGemini')?.addEventListener('click', async () => {
            const tabService = getTabService();
            if (tabService && tabService.openGeminiPage) {
                await tabService.openGeminiPage();
            } else {
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

    async function goToStep(stepIndex) {
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

    async function nextStep() {
        if (currentStep < STEPS.length - 1) {
            return await goToStep(currentStep + 1);
        } else {
            return await finishTour();
        }
    }

    async function prevStep() {
        if (currentStep > 0) {
            return await goToStep(currentStep - 1);
        }
    }

    async function finishTour() {
        const storage = getStorage();
        if (storage && storage.setTourCompleted) {
            await storage.setTourCompleted(true);
        }
        removeElements();
    }

    async function skipTour() {
        const storage = getStorage();
        if (storage && storage.setTourCompleted) {
            await storage.setTourCompleted(true);
        }
        removeElements();
    }

    async function startTour(stepIndex = 0) {
        return await goToStep(stepIndex);
    }

    return {
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
}));
