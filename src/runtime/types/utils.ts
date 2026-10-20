export type TabStatus = 'NO_TABS_API' | 'NO_TAB' | 'NEED_REFRESH' | 'CONNECTED' | 'ERROR';

export interface TabStatusResult {
    status: TabStatus;
    tab: chrome.tabs.Tab | null;
    response?: unknown;
    error?: string;
    reason?: string;
}
