import { updateSettings, type GlobalSettings } from '../../../application/settings/index.js';
import * as Directory from '../../../runtime/capabilities/dirHandleController.js';
import { OperationError } from '../../../shared/errors/operationError.js';
import { TourGuide } from '../../guidance/tourGuide.js';
import { elementById as el, requiredElement as control } from '../../shared/elements.js';
import { readSettings } from '../../shared/readSettings.js';
import { EXPORT_FORMATS, text, useSettings } from '../../shared/settings.js';
import { createOptimisticThemeToggle } from '../../shared/themeToggle.js';
import type { UiMessage } from '../state/foregroundTask.js';
import type { UIExportRequest } from './exportController.js';
import type { LogLevel } from './diagnosticLogController.js';

export function bindSettingsAndDeliveryControls(deps: {
    readonly isBusy: () => boolean;
    readonly getSettings: () => GlobalSettings;
    readonly setSettings: (next: GlobalSettings) => void;
    readonly isDirectoryAvailable: () => boolean;
    readonly setDirectoryAvailable: (available: boolean) => void;
    readonly setPresentationSaving: (saving: boolean) => void;
    readonly isPresentationSaving: () => boolean;
    readonly performCleanup: (task: (signal: AbortSignal) => Promise<void>) => Promise<void>;
    readonly render: () => void;
    readonly status: (message: UiMessage, level?: LogLevel, rawLogMessage?: string) => void;
    readonly statusError: (error: unknown, level?: LogLevel) => void;
}) {
    const moreActionsButton = control('button', 'btnMoreActions');
    const moreActionsMenu = el('moreActionsMenu');
    const closeMoreActions = () => {
        moreActionsMenu.hidden = true;
        moreActionsButton.setAttribute('aria-expanded', 'false');
    };
    moreActionsButton.addEventListener('click', () => {
        if (deps.isBusy() || !deps.getSettings()) return;
        moreActionsMenu.hidden = !moreActionsMenu.hidden;
        moreActionsButton.setAttribute('aria-expanded', String(!moreActionsMenu.hidden));
    });
    moreActionsMenu.addEventListener('click', event => {
        if (event.target instanceof Element && event.target.closest('button')) {
            closeMoreActions();
            moreActionsButton.focus();
        }
    });
    control('dialog', 'cleanupModal').addEventListener('close', () => {
        if (moreActionsMenu.hidden) moreActionsButton.focus();
    });
    const onDocumentPointerDown = (event: PointerEvent) => {
        if (event.target instanceof Node && !moreActionsButton.parentElement?.contains(event.target)) {
            closeMoreActions();
        }
    };
    const onDocumentKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape' && !moreActionsMenu.hidden) {
            closeMoreActions();
            moreActionsButton.focus();
        }
    };
    document.addEventListener('pointerdown', onDocumentPointerDown);
    document.addEventListener('keydown', onDocumentKeyDown);

    el('btnSetDir').addEventListener('click', () => {
        if (deps.isBusy() || deps.getSettings()?.exportDelivery !== 'folderWriter') return;
        const permission = Directory.getPendingPermissionHandle()
            ? Directory.reauthorizeDirHandle()
            : Directory.requestDirHandle();
        void deps.performCleanup(async () => {
            if (!await permission) throw new OperationError('DIRECTORY_PERMISSION_DENIED', 'Folder permission denied');
            deps.setDirectoryAvailable(await Directory.verifyDirPermission(Directory.getDirHandle()));
            deps.status(() => text('Folder authorized', '目录已授权'));
        });
    });

    let settingsSaving = false;
    const runSettingsWrite = async (work: () => Promise<void>): Promise<void> => {
        if (settingsSaving || deps.isBusy()) { deps.render(); return; }
        settingsSaving = true;
        deps.render();
        try {
            await work();
        } catch (error) {
            deps.statusError(error);
        } finally {
            settingsSaving = false;
            deps.render();
        }
    };

    el('delivery').addEventListener('change', event => {
        const input = event.target;
        if (!(input instanceof HTMLInputElement) || input.name !== 'delivery') return;
        const settings = deps.getSettings();
        if (deps.isBusy() || settingsSaving || !settings || input.disabled) { deps.render(); return; }
        if (!input.checked) return;
        const exportDelivery: UIExportRequest['delivery'] =
            input.value === 'googleDrive' ? 'googleDrive' : input.value === 'folderWriter' ? 'folderWriter' : 'browserDownload';
        if (settings.exportDelivery === exportDelivery) return;
        const permission = exportDelivery === 'folderWriter' && !deps.isDirectoryAvailable() && TourGuide.isLiveSaveStep()
            ? Directory.getPendingPermissionHandle() ? Directory.reauthorizeDirHandle() : Directory.requestDirHandle()
            : undefined;
        const priorDelivery = settings.exportDelivery;
        deps.setSettings({ ...settings, exportDelivery });
        void runSettingsWrite(async () => {
            try {
                if (permission) {
                    try {
                        if (!await permission) throw new OperationError('DIRECTORY_PERMISSION_DENIED', 'Folder permission denied');
                        const available = await Directory.verifyDirPermission(Directory.getDirHandle());
                        deps.setDirectoryAvailable(available);
                        if (!available) throw new OperationError('DIRECTORY_PERMISSION_DENIED', 'Folder permission denied');
                        deps.status(() => text('Folder authorized. Enable Live Save to continue.', '目录已授权，开启实时保存即可继续。'));
                    } catch (error) {
                        if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
                        deps.status(() => text('Folder selection cancelled. Choose a folder to continue.', '已取消选择目录，请点击「选择文件夹」重试。'));
                    }
                }
                await updateSettings({ exportDelivery });
                deps.setSettings(await readSettings());
            } catch (error) {
                deps.setSettings({ ...deps.getSettings(), exportDelivery: priorDelivery });
                throw error;
            }
        });
    });

    const changeControlSetting = (input: HTMLInputElement | HTMLSelectElement, patch: Partial<GlobalSettings>) => {
        const prior = deps.getSettings();
        if (deps.isBusy() || settingsSaving || !prior || input.disabled) { deps.render(); return; }
        const finishTutorialSetting = patch.defaultFormat ? TourGuide.beginFormatSelection()
            : patch.enabledDisk === true ? TourGuide.beginLiveSave() : undefined;
        const rollback: Partial<GlobalSettings> = {
            ...(patch.defaultFormat !== undefined ? { defaultFormat: prior.defaultFormat } : {}),
            ...(patch.skipExported !== undefined ? { skipExported: prior.skipExported } : {}),
            ...(patch.includeAssets !== undefined ? { includeAssets: prior.includeAssets } : {}),
            ...(patch.enabledDisk !== undefined ? { enabledDisk: prior.enabledDisk } : {}),
        };
        deps.setSettings({ ...prior, ...patch });
        let saved = false;
        void runSettingsWrite(async () => {
            try {
                await updateSettings(patch);
                const next = await readSettings();
                deps.setSettings(next);
                saved = patch.defaultFormat ? next.defaultFormat === patch.defaultFormat
                    : next.enabledDisk && next.exportDelivery === 'folderWriter'
                        && next.defaultFormat === 'markdown' && deps.isDirectoryAvailable();
            } catch (error) {
                deps.setSettings({ ...deps.getSettings(), ...rollback });
                throw error;
            }
        }).then(() => finishTutorialSetting?.(saved));
    };

    const formatControl = control('select', 'format');
    formatControl.addEventListener('change', () => {
        const format = EXPORT_FORMATS.find(value => value === formatControl.value);
        if (format) changeControlSetting(formatControl, { defaultFormat: format });
    });

    const checkboxSettings: readonly (readonly [HTMLInputElement, 'skipExported' | 'includeAssets' | 'enabledDisk'])[] = [
        [control('input', 'skipExported'), 'skipExported'],
        [control('input', 'includeAssets'), 'includeAssets'],
        [control('input', 'liveSaveDiskToggle'), 'enabledDisk'],
    ];
    for (const [input, field] of checkboxSettings) {
        input.addEventListener('change', () => { changeControlSetting(input, { [field]: input.checked }); });
    }

    const themeToggle = createOptimisticThemeToggle({
        getSettings: deps.getSettings,
        setSettings: deps.setSettings,
        syncCommitted: async () => { deps.setSettings(await readSettings()); },
        render: deps.render,
        onError: deps.statusError,
    });
    control('button', 'btnThemeToggle').addEventListener('click', themeToggle.toggle);

    const savePresentation = async (patch: Pick<GlobalSettings, 'developerMode'> | Pick<GlobalSettings, 'language'>) => {
        const settings = deps.getSettings();
        if (!settings || deps.isPresentationSaving()) { deps.render(); return; }
        const prior = settings;
        deps.setPresentationSaving(true);
        const optimistic = { ...settings, ...patch };
        deps.setSettings(optimistic);
        useSettings(optimistic);
        deps.render();
        try {
            await updateSettings(patch);
            deps.setSettings(await readSettings());
        } catch (error) {
            deps.setSettings(prior);
            useSettings(prior);
            deps.statusError(error);
        } finally {
            deps.setPresentationSaving(false);
            deps.render();
        }
    };
    control('input', 'devToggle').addEventListener('change', () => {
        void savePresentation({ developerMode: control('input', 'devToggle').checked });
    });
    control('input', 'langToggle').addEventListener('change', () => {
        void savePresentation({ language: control('input', 'langToggle').checked ? 'en' : 'zh' });
    });

    return {
        isSettingsSaving: () => settingsSaving,
        isThemeSaving: () => themeToggle.isSaving(),
        dispose: () => {
            document.removeEventListener('pointerdown', onDocumentPointerDown);
            document.removeEventListener('keydown', onDocumentKeyDown);
        },
    };
}
