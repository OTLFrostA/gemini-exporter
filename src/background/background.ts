// src/background/background.ts - Manifest V3 Background Service Worker for Gemini Exporter

import type { BackgroundMessage, BackgroundResponse } from '../types/entrypoints.js';
import { GeminiConstants } from '../core/utils/constants.js';
import { TabService } from '../core/utils/tabService.js';
import { GeminiUtils } from '../core/utils/utils.js';
import { StorageService } from '../core/storage/storageService.js';
import { GeminiProtocol } from '../core/protocol/protocol.js';

// Allow content scripts to access chrome.storage.session for memory-scoped CSRF credentials
try {
    if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session && (chrome.storage as any).session.setAccessLevel) {
        (chrome.storage as any).session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => {});
    }
} catch (e) {
    if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:background.js]', e);
}

const __bgAborts: Map<string, boolean> = new Map();

// Restore persisted abort flags after MV3 worker restarts (setSlotAborted
// mirrors every transition into chrome.storage.session).
try {
    if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session && (chrome.storage as any).session.get) {
        (chrome.storage as any).session.get(null).then((data: any) => {
            for (const k of Object.keys(data || {})) {
                const m = k.match(/^gemini_abort_(.+)$/);
                if (m && data[k]) __bgAborts.set(m[1], true);
            }
        }).catch(() => { /* intentional: best-effort abort restore */ });
    }
} catch { /* intentional: best-effort abort restore */ }

function isSlotAborted(slot: string = 'u0'): boolean {
    return !!__bgAborts.get(slot || 'u0');
}

function setSlotAborted(slot: string = 'u0', val: boolean = true): void {
    const s = slot || 'u0';
    if (val) {
        __bgAborts.set(s, true);
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session) {
                (chrome.storage as any).session.set({ [`gemini_abort_${s}`]: true }).catch(() => {});
            }
        } catch { /* intentional: session storage fallback */ }
    } else {
        __bgAborts.delete(s);
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && (chrome.storage as any).session) {
                (chrome.storage as any).session.remove([`gemini_abort_${s}`]).catch(() => {});
            }
        } catch { /* intentional: session storage fallback */ }
    }
}

function startKeepAlive(): () => void {
    if (typeof chrome === 'undefined' || !chrome.runtime) return () => {};
    const interval = setInterval(() => {
        try {
            if (chrome.runtime.getPlatformInfo) {
                chrome.runtime.getPlatformInfo(() => {});
            }
        } catch (e) {
            if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:background.js]', e);
        }
    }, 20000);
    return () => clearInterval(interval);
}

const FEEDBACK_URL = (typeof GeminiConstants !== 'undefined' && GeminiConstants.FEEDBACK_URL)
    ? GeminiConstants.FEEDBACK_URL
    : ((typeof (globalThis as any).GeminiConstants !== 'undefined' && (globalThis as any).GeminiConstants.FEEDBACK_URL)
        ? (globalThis as any).GeminiConstants.FEEDBACK_URL
        : 'https://tally.so/r/Y56ZBB');

function initUninstallUrl(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.setUninstallURL) {
        try {
            chrome.runtime.setUninstallURL(FEEDBACK_URL, () => {
                if (chrome.runtime.lastError) {
                    console.warn('[Gemini Exporter] Failed to set uninstall URL:', chrome.runtime.lastError.message);
                }
            });
        } catch (err) {
            console.warn('[Gemini Exporter] Error calling setUninstallURL:', err);
        }
    }
}

// Tab communication service helper (handles 'Receiving end does not exist' and hints '刷新 gemini.google.com')
const sendToGeminiTab = (msg: any, slot?: string, timeoutMs?: number): Promise<any> => {
    if (typeof TabService !== 'undefined' && TabService.sendToGeminiTab) {
        return TabService.sendToGeminiTab(msg, slot, timeoutMs);
    }
    return Promise.reject(new Error('与 Gemini 页面连接失败（扩展重载后需刷新 gemini.google.com 页面）: Receiving end does not exist'));
};

const getGeminiTab = (slot?: string): Promise<any> => {
    if (typeof TabService !== 'undefined' && TabService.getGeminiTab) {
        return TabService.getGeminiTab(slot);
    }
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
        return chrome.tabs.query({ url: 'https://gemini.google.com/*' }).then((t: any[]) => t?.[0] || null);
    }
    return Promise.resolve(null);
};

chrome.runtime.onInstalled.addListener((details) => {
    initUninstallUrl();
    if (details.reason === 'install') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('src/ui/options/options.html?welcome=1')
        });
    }
});

initUninstallUrl();

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender: chrome.runtime.MessageSender, sendResponse: (response?: BackgroundResponse) => void) => {
    if (msg.action === 'openOptions') {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
    }

    if (msg.action === 'openGeminiPage') {
        chrome.tabs.create({ url: 'https://gemini.google.com/app' }, (tab) => {
            sendResponse({ ok: true, tabId: tab?.id });
        });
        return true;
    }

    if (msg.action === 'reloadGeminiTab') {
        if (msg.tabId) {
            chrome.tabs.reload(msg.tabId, () => sendResponse({ ok: true }));
        } else {
            chrome.tabs.query({ url: 'https://gemini.google.com/*' }, (tabs) => {
                if (tabs && tabs.length > 0 && tabs[0].id != null) {
                    chrome.tabs.reload(tabs[0].id, () => sendResponse({ ok: true }));
                } else {
                    sendResponse({ ok: false, error: 'no tab' });
                }
            });
        }
        return true;
    }

    if (msg.action === 'fetchChat') {
        sendToGeminiTab({
            action: 'getConversationDetail',
            conversationId: msg.id || msg.conversationId
        }, msg.accountSlot)
            .then(r => sendResponse(r))
            .catch(e => sendResponse({ success: false, error: e?.message }));
        return true;
    }

    if (msg.action === 'fetchBatch') {
        const slot = msg.accountSlot || 'u0';
        setSlotAborted(slot, false);
        fetchBatch(msg.ids, msg.format, msg.skipExported, sendResponse, msg.globalOffset, msg.globalTotal, slot);
        return true;
    }

    if (msg.action === 'cancelExport') {
        const slot = msg.accountSlot || 'u0';
        setSlotAborted(slot, true);
        sendResponse({ ok: true, aborted: true });
        return true;
    }

    if (msg.action === 'abortSync') {
        const slot = msg.accountSlot || 'u0';
        setSlotAborted(slot, true);
        sendToGeminiTab({ action: 'abortSync' }, slot).catch(() => {});
        sendResponse({ ok: true, aborted: true });
        return true;
    }

    if (msg.action === 'ping') {
        const ver = (typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.()?.version) || '1.4.3';
        sendResponse({
            ok: true,
            version: ver,
            ver: ver
        });
        return;
    }

    if (msg.action === 'deepScan') {
        (async () => {
            const stopKeepAlive = startKeepAlive();
            try {
                const timeoutMs = (msg.mode === 'full' || msg.mode === 'auto') ? 300000 : 90000;
                const res = await sendToGeminiTab({
                    action: 'deepScan',
                    maxIter: msg.maxIter || 150,
                    mode: msg.mode || 'auto'
                }, msg.accountSlot, timeoutMs);
                sendResponse(res);
            } catch (e: any) {
                sendResponse({ success: false, error: e?.message });
            } finally {
                stopKeepAlive();
            }
        })();
        return true;
    }

    if (msg.action === 'stopDeepScan') {
        const slot = msg.accountSlot || 'u0';
        setSlotAborted(slot, true);
        sendToGeminiTab({ action: 'stopDeepScan' }, slot)
            .then(r => sendResponse(r || { ok: true, aborted: true }))
            .catch(() => sendResponse({ ok: true, aborted: true }));
        return true;
    }

    if (msg.action === 'scanProgress' || msg.action === 'syncUpdate') {
        // In MV3, chrome.runtime.sendMessage from content script is already delivered directly to all extension pages.
        // Re-broadcasting here causes duplicate message delivery and duplicate log entries.
        return;
    }
});

function toMs(v: any): number {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
}

async function fetchBatch(
    list: any,
    format?: string,
    skipExported?: boolean,
    portSendResponse?: any,
    globalOffset: number = 0,
    globalTotal: number = 0,
    accountSlot: string = 'u0'
): Promise<void> {
    const stopKeepAlive = startKeepAlive();
    try {
        const slot = accountSlot || 'u0';
        if (!list || !list.length) {
            if (portSendResponse) portSendResponse({ success: true, results: [], skipped: 0 });
            return;
        }
        const tab = await getGeminiTab(slot);
        if (!tab) {
            if (portSendResponse) {
                portSendResponse({
                    success: false,
                    error: '请先打开 gemini.google.com，保持登录状态'
                });
            }
            return;
        }

        const totalCount = globalTotal || list.length;
        const results: any[] = [];
        let done = 0;

        for (const item of list) {
            if (isSlotAborted(slot)) break;
            const cid = item.id || item;
            try {
                let res: any = null;
                let retryCount = 0;
                const maxRetries = 3;

                while (retryCount <= maxRetries && !isSlotAborted(slot)) {
                    res = await sendToGeminiTab({
                        action: 'getConversationDetail',
                        conversationId: cid
                    }, slot);

                    const isRateLimit = res && !res.success && (
                        res.status === 429 ||
                        /429|rate\s*limit|quota|too\s*many\s*requests/i.test(res.error || '')
                    );

                    if (isRateLimit && retryCount < maxRetries) {
                        const delayMs = Math.min(30000, 2000 * Math.pow(2, retryCount) + Math.floor(Math.random() * 1000));
                        console.warn(`[Gemini Exporter Background] fetchBatch 429 rate limit for ${cid}, backoff ${delayMs}ms (attempt ${retryCount + 1}/${maxRetries})`);
                        await new Promise(r => setTimeout(r, delayMs));
                        retryCount++;
                        continue;
                    }
                    break;
                }

                if (res && res.success) {
                    const chat = res.data || res.chat || res;
                    chat.id = cid;
                    results.push(chat);
                } else {
                    results.push({
                        id: cid,
                        title: item.title,
                        url: item.url || `https://gemini.google.com/app/${cid}`,
                        error: res?.error || '抓取失败',
                        messages: [],
                        _empty: true,
                        _debug: res?._debug || null,
                        _raw: res?._raw || null
                    });
                }
            } catch (e: any) {
                results.push({
                    id: cid,
                    title: item.title,
                    url: item.url || `https://gemini.google.com/app/${cid}`,
                    error: e?.message || '抓取异常',
                    messages: [],
                    _empty: true,
                    _debug: e?.stack || null,
                    _raw: null
                });
            }
            done++;
            chrome.runtime.sendMessage({
                action: 'exportProgress',
                done: globalOffset + done,
                total: totalCount,
                title: item.title,
                id: cid
            }).catch(() => {});
        }

        if (portSendResponse) {
            portSendResponse({
                success: true,
                results,
                skipped: 0
            });
        }
    } finally {
        stopKeepAlive();
    }
}

// Tab action icon dynamic state management (color on Gemini, grayscale elsewhere)
function isGeminiTabUrl(urlStr?: string | null): boolean {
    if (!urlStr || typeof urlStr !== 'string') return false;
    try {
        const u = new URL(urlStr);
        return u.hostname === 'gemini.google.com';
    } catch {
        return false;
    }
}

const ACTION_COLOR_ICONS = {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png'
};

const ACTION_GRAY_ICONS = {
    16: 'icons/icon16_gray.png',
    48: 'icons/icon48_gray.png',
    128: 'icons/icon128_gray.png'
};

function updateTabActionState(tabId?: number | null, url?: string | null): void {
    if (typeof chrome === 'undefined' || !chrome.action || !tabId) return;
    const isGemini = isGeminiTabUrl(url);
    const icons = isGemini ? ACTION_COLOR_ICONS : ACTION_GRAY_ICONS;
    const title = isGemini ? 'Gemini Exporter (Active)' : 'Gemini Exporter (未激活 - 当前非 Gemini 页面)';
    try {
        chrome.action.setIcon({ tabId, path: icons }).catch(() => {});
        chrome.action.setTitle({ tabId, title }).catch(() => {});
    } catch { /* intentional fallback */ }
}

try {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
        if (chrome.tabs.onActivated) {
            chrome.tabs.onActivated.addListener((activeInfo) => {
                chrome.tabs.get(activeInfo.tabId, (tab) => {
                    if (chrome.runtime?.lastError || !tab) return;
                    updateTabActionState(activeInfo.tabId, tab.url);
                });
            });
        }
        if (chrome.tabs.onUpdated) {
            chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
                const url = changeInfo.url || tab?.url;
                if (url) {
                    updateTabActionState(tabId, url);
                }
            });
        }
        // Initial tab check on service worker startup
        if (chrome.tabs.query) {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs && tabs[0]?.id) {
                    updateTabActionState(tabs[0].id, tabs[0].url);
                }
            });
        }
    }
} catch (e) {
    if (typeof console !== 'undefined' && console.debug) console.debug('[background] init tab action state error', e);
}

export {};
