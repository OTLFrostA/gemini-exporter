import { updateSettings, type GlobalSettings } from '../../application/settings/index.js';
import { useSettings } from './settings.js';

export interface OptimisticThemeToggleController {
    readonly toggle: () => void;
    readonly isSaving: () => boolean;
}

/** Shared optimistic Light/Dark theme switch with in-flight lock and automatic rollback on failure. */
export function createOptimisticThemeToggle(options: {
    readonly getSettings: () => GlobalSettings | undefined;
    readonly setSettings: (next: GlobalSettings) => void;
    readonly syncCommitted: () => Promise<void>;
    readonly render: () => void;
    readonly onError: (error: unknown) => void;
}): OptimisticThemeToggleController {
    let saving = false;
    return {
        isSaving: () => saving,
        toggle: () => {
            const current = options.getSettings();
            if (!current || saving) return;
            const previousTheme = current.theme;
            const theme = previousTheme === 'light' ? 'dark' : 'light';
            saving = true;
            const optimistic: GlobalSettings = { ...current, theme };
            options.setSettings(optimistic);
            useSettings(optimistic);
            options.render();
            void updateSettings({ theme })
                .then(options.syncCommitted)
                .catch(error => {
                    const latest = options.getSettings();
                    const reverted: GlobalSettings = { ...(latest ?? current), theme: previousTheme };
                    options.setSettings(reverted);
                    useSettings(reverted);
                    options.onError(error);
                })
                .finally(() => {
                    saving = false;
                    options.render();
                });
        },
    };
}
