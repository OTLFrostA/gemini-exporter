import { UI_COPY } from './legacyLabels.js';
import {
    EXPORT_FORMATS,
    currentLanguage,
    englishCount,
    isDeveloperMode,
    labelThemeToggle,
    observeSettings,
    text,
    uiLocale,
    useSettings,
} from './i18n.js';
import { errorText } from './errorMessages.js';

export {
    EXPORT_FORMATS,
    englishCount,
    errorText,
    isDeveloperMode,
    labelThemeToggle,
    observeSettings,
    text,
    uiLocale,
    useSettings,
};

/** Translate static UI nodes only; dynamic titles, messages, paths and logs are rendered by their views. */
export function labelPage(): void {
    document.querySelectorAll<HTMLElement>('[data-en][data-zh], [data-ui-en][data-ui-zh]').forEach(el => {
        el.textContent = text(el.dataset.en ?? el.dataset.uiEn ?? '', el.dataset.zh ?? el.dataset.uiZh ?? '');
    });
    const copy = new Map(Object.entries(UI_COPY[currentLanguage()]));
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
        if (el.id === 'currentChatTitle' || el.id === 'chatTurnBadge' || el.id === 'dirLabel' || el.id === 'log') continue;
        const label = copy.get(el.dataset.i18n ?? '');
        if (label) el.textContent = label;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
        const label = copy.get(el.dataset.i18nTitle ?? '');
        if (label) el.title = label;
    }
    for (const el of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
        const label = copy.get(el.dataset.i18nPlaceholder ?? '');
        if (label) el.placeholder = label;
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-aria-label]')) {
        const label = copy.get(el.dataset.i18nAriaLabel ?? '');
        if (label) el.setAttribute('aria-label', label);
    }
}
