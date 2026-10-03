export type TabStatus = 'NO_TABS_API' | 'NO_TAB' | 'NEED_REFRESH' | 'CONNECTED' | 'ERROR';

export interface TabStatusResult {
    status: TabStatus;
    tab: chrome.tabs.Tab | null;
    response?: unknown;
    error?: string;
    reason?: string;
}

export interface TabServiceModule {
    getGeminiTab(slot?: string): Promise<chrome.tabs.Tab | null>;
    sendToGeminiTab: (msg: unknown, slot?: string, timeoutMs?: number) => Promise<unknown>;
    checkGeminiStatus(slot?: string): Promise<TabStatusResult>;
    openGeminiPage(): Promise<unknown>;
    reloadGeminiTab(tabId?: number): Promise<unknown>;
    getAITab?(providerIdOrUrl?: string, slot?: string): Promise<chrome.tabs.Tab | null>;
    sendToAITab?: (providerIdOrUrl: string, msg: unknown, slot?: string, timeoutMs?: number) => Promise<unknown>;
}

export type SupportedLang = 'zh' | 'en';

export type LocaleDictionary = Record<string, string>;

export interface I18nModule {
    LOCALES: Record<string, LocaleDictionary | null>;
    initLanguage(): Promise<string>;
    getLang(): string;
    setLang(lang: string): Promise<void>;
    onLanguageChange(fn: (lang: string) => void): void;
    t: (key: string, ...args: unknown[]) => string;
    applyLangToggleUI?(opts?: {
        toggle?: HTMLInputElement | null;
        labelZh?: HTMLElement | null;
        labelEn?: HTMLElement | null;
    }): void;
    applyI18n?(container?: Element | Document): void;
}
