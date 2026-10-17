import type { TourStep } from '../../types/ui.js';

export const STEPS: TourStep[] = [
    {
        id: 'connect',
        getTarget: () => document.getElementById('accountIdSelect') || document.querySelector('header h1') || null,
        placement: 'bottom',
        titleKey: 'tourStep1Title',
        isDynamicConnect: true,
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const slotSelect = document.getElementById('accountIdSelect');
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
        getTarget: () => document.getElementById('btnSyncAll') || null,
        placement: 'bottom',
        titleKey: 'tourStep2Title',
        descKey: 'tourStep2Desc',
        hintKey: 'tourHintClickButton',
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const btnScan = document.getElementById('btnSyncAll');
            if (btnScan) {
                const onScanClick = () => setTimeout(advance, 300);
                btnScan.addEventListener('click', onScanClick);
                cleanups.push(() => btnScan.removeEventListener('click', onScanClick));
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
        placement: 'left',
        titleKey: 'tourStep3Title',
        descKey: 'tourStep3Desc',
        hintKey: 'tourHintSelectChat',
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const listEl = document.getElementById('list');
            if (listEl) {
                const onListChange = (e: Event): void => {
                    const target = e.target;
                    if (target && 'type' in target && target.type === 'checkbox' && 'checked' in target && target.checked) {
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
            return () => cleanups.forEach(c => c());
        }
    },
    {
        id: 'format',
        getTarget: () => document.getElementById('format') || null,
        placement: 'right',
        titleKey: 'tourStepFormatTitle',
        descKey: 'tourStepFormatDesc',
        hintKey: 'tourHintChooseFormat',
        setupAction: (advance: () => void) => {
            const format = document.getElementById('format');
            if (!format) return undefined;
            const onChange = () => setTimeout(advance, 300);
            format.addEventListener('change', onChange);
            return () => format.removeEventListener('change', onChange);
        }
    },
    {
        id: 'export',
        spotlightTarget: () => document.getElementById('format') || null,
        spotlightTitleKey: 'tourExportFormatsTitle',
        spotlightDescKey: 'tourExportFormatsDesc',
        spotlightHintKey: 'tourExportFormatsHint',
        spotlightActionLabelKey: 'tourExportFormatsAction',
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
        id: 'live_save',
        getTarget: () => {
            const el = document.getElementById('liveSaveDiskToggle');
            if (!el) return null;
            return (typeof el.closest === 'function' ? el.closest('label') : null) || el;
        },
        placement: 'right',
        titleKey: 'tourStepLiveSaveTitle',
        descKey: 'tourStepLiveSaveDesc',
        hintKey: 'tourHintLiveSave',
        setupAction: (advance: () => void) => {
            const cleanups: (() => void)[] = [];
            const diskToggle = document.getElementById('liveSaveDiskToggle');
            if (diskToggle) {
                const onToggle = () => setTimeout(advance, 300);
                diskToggle.addEventListener('change', onToggle);
                cleanups.push(() => diskToggle.removeEventListener('change', onToggle));
            }
            const btnSetDir = document.getElementById('btnSetDir');
            if (btnSetDir) {
                const onBtn = () => setTimeout(advance, 300);
                btnSetDir.addEventListener('click', onBtn);
                cleanups.push(() => btnSetDir.removeEventListener('click', onBtn));
            }
            return () => cleanups.forEach(c => c());
        }
    },
    {
        id: 'feedback',
        getTarget: () => document.getElementById('feedbackBox') || document.getElementById('btnFeedback') || null,
        placement: 'right',
        titleKey: 'tourStep6Title',
        descKey: 'tourStep6Desc',
        hintKey: 'tourHintClickFeedback',
        isFinal: true,
        setupAction: (advance: () => void) => {
            const btnFeedback = document.getElementById('feedbackBox') || document.getElementById('btnFeedback');
            if (btnFeedback) {
                const onFeedbackClick = () => setTimeout(advance, 200);
                btnFeedback.addEventListener('click', onFeedbackClick);
                return () => btnFeedback.removeEventListener('click', onFeedbackClick);
            }
            return undefined;
        }
    }
];
