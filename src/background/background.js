try {
    importScripts('/src/core/utils/constants.js', '/src/core/utils/utils.js', '/src/core/storage/storageService.js', '/src/core/utils/tabService.js');
} catch (e) {}

const __bgAborts = new Map();

function isSlotAborted(slot = 'u0') {
    return !!__bgAborts.get(slot || 'u0');
}

function setSlotAborted(slot = 'u0', val = true) {
    const s = slot || 'u0';
    if (val) __bgAborts.set(s, true);
    else __bgAborts.delete(s);
}

const FEEDBACK_URL = (typeof GeminiConstants !== 'undefined' && GeminiConstants.FEEDBACK_URL)
    ? GeminiConstants.FEEDBACK_URL
    : 'https://tally.so/r/Y56ZBB';

function initUninstallUrl() {
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

const cleanTitle = (t) => (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle ? GeminiUtils.cleanTitle(t) : (t || '').trim());
const isRealTitle = (t, fallbackId) => (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle ? GeminiUtils.isRealTitle(t, fallbackId) : !!(t && t.trim().length > 1));
// Tab communication service helper (handles 'Receiving end does not exist' and hints '刷新 gemini.google.com')
const sendToGeminiTab = (msg, slot, timeoutMs) => (typeof TabService !== 'undefined' ? TabService.sendToGeminiTab(msg, slot, timeoutMs) : Promise.reject(new Error('与 Gemini 页面连接失败（扩展重载后需刷新 gemini.google.com 页面）')));
const getGeminiTab = (slot) => (typeof TabService !== 'undefined' && TabService.getGeminiTab ? TabService.getGeminiTab(slot) : (typeof chrome !== 'undefined' && chrome.tabs ? chrome.tabs.query({ url: 'https://gemini.google.com/*' }).then(t => t[0] || null) : Promise.resolve(null)));

chrome.runtime.onInstalled.addListener((details) => {
    initUninstallUrl();
    if (details.reason === 'install') {
        chrome.tabs.create({
            url: chrome.runtime.getURL('options.html?welcome=1')
        });
    }
});

initUninstallUrl();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
                if (tabs && tabs.length > 0) {
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
            .catch(e => sendResponse({ success: false, error: e.message }));
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
        sendResponse({
            ok: true,
            ver: chrome.runtime.getManifest()?.version || '1.1.0'
        });
        return;
    }

    if (msg.action === 'deepScan') {
        (async () => {
            try {
                const timeoutMs = (msg.mode === 'full' || msg.mode === 'auto') ? 300000 : 90000;
                const res = await sendToGeminiTab({
                    action: 'deepScan',
                    maxIter: msg.maxIter || 150,
                    mode: msg.mode || 'auto'
                }, msg.accountSlot, timeoutMs);
                sendResponse(res);
            } catch (e) {
                sendResponse({ success: false, error: e.message });
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

function toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
}
async function fetchBatch(list, format, skipExported, portSendResponse, globalOffset = 0, globalTotal = 0, accountSlot = 'u0') {
    const slot = accountSlot || 'u0';
    if (!list || !list.length) {
        portSendResponse({ success: true, results: [], skipped: 0 });
        return;
    }
    const tab = await getGeminiTab(slot);
    if (!tab) {
        portSendResponse({
            success: false,
            error: '请先打开 gemini.google.com，保持登录状态'
        });
        return;
    }

    const totalCount = globalTotal || list.length;
    const results = [];
    let done = 0;

    for (const item of list) {
        if (isSlotAborted(slot)) break;
        const cid = item.id || item;
        try {
            const res = await sendToGeminiTab({
                action: 'getConversationDetail',
                conversationId: cid
            }, slot);

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
        } catch (e) {
            results.push({
                id: cid,
                title: item.title,
                url: item.url || `https://gemini.google.com/app/${cid}`,
                error: e.message || '抓取异常',
                messages: [],
                _empty: true,
                _debug: e.stack || null,
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

    portSendResponse({
        success: true,
        results,
        skipped: 0
    });
}
