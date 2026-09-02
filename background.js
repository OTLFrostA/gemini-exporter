// background.js - Gemini Exporter background service worker
try {
    importScripts('utils.js', 'storage_service.js');
} catch (e) {}

console.log('[Gemini Exporter] Background service worker ready');
let __bgAborted = false;

const cleanTitle = (t) => {
    try {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle) return GeminiUtils.cleanTitle(t);
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.cleanTitle) return globalThis.GeminiUtils.cleanTitle(t);
    } catch {}
    if (!t || typeof t !== 'string') return '';
    let s = t.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
    if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(s)) return '';
    s = s.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
    s = s.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
    s = s.trim();
    if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(s)) return '';
    return s;
};

const isRealTitle = (t, fallbackId) => {
    try {
        if (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle) return GeminiUtils.isRealTitle(t, fallbackId);
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.isRealTitle) return globalThis.GeminiUtils.isRealTitle(t, fallbackId);
    } catch {}
    if (!t || typeof t !== 'string') return false;
    const s = t.trim();
    if (!s || s.length < 2 || s === 'Untitled' || s === '未命名' || s === 'New chat' || s === '新对话') return false;
    if (/^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(s)) return false;
    if (fallbackId && (s === fallbackId || s === 'c_' + fallbackId || fallbackId === 'c_' + s)) return false;
    if (/^[0-9a-f]{16}$/i.test(s) || /^c_[0-9a-f]{16}$/i.test(s) || /^[a-f0-9_-]{8,64}$/i.test(s)) return false;
    return true;
};

function getGeminiTab(slot) {
    return chrome.tabs.query({
        url: 'https://gemini.google.com/*'
    }).then(tabs => {
        if (!tabs.length) return null;
        if (slot && slot !== 'u0') {
            const slotNum = slot.replace('u', '');
            const match = tabs.find(t => t.url && t.url.includes(`/u/${slotNum}/`));
            if (match) return match;
        } else if (slot === 'u0') {
            const defMatch = tabs.find(t => t.url && (!t.url.match(/\/u\/\d+\//) || t.url.includes('/u/0/')));
            if (defMatch) return defMatch;
        }
        return tabs.find(t => t.active) || tabs[0];
    });
}

async function sendToGeminiTab(msg, slot, timeoutMs = 25000) {
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    if (!tabs || !tabs.length) throw new Error('未找到 Gemini 标签页，请先打开 gemini.google.com');

    let candidates = [];
    if (slot && slot !== 'u0') {
        const slotNum = slot.replace('u', '');
        candidates = tabs.filter(t => t.url && t.url.includes(`/u/${slotNum}/`));
    } else if (slot === 'u0') {
        candidates = tabs.filter(t => t.url && (!t.url.match(/\/u\/\d+\//) || t.url.includes('/u/0/')));
    }
    if (!candidates.length) candidates = tabs;
    candidates.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));

    let lastError = null;
    for (const tab of candidates) {
        try {
            const res = await new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => {
                    if (!settled) {
                        settled = true;
                        reject(new Error(`与 Gemini 页面通信超时 (${timeoutMs}ms)`));
                    }
                }, timeoutMs);
                chrome.tabs.sendMessage(tab.id, msg, (r) => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        if (chrome.runtime.lastError) {
                            reject(new Error(chrome.runtime.lastError.message || ''));
                        } else {
                            resolve(r);
                        }
                    }
                });
            });
            return res;
        } catch (e) {
            lastError = e;
            const errStr = String(e.message || '');
            if (errStr.includes('Receiving end does not exist') || errStr.includes('Could not establish connection')) {
                continue;
            }
            throw e;
        }
    }
    throw new Error('与 Gemini 页面连接失败（扩展重载后需刷新 gemini.google.com 页面）- ' + (lastError?.message || ''));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'openOptions') {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
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
        __bgAborted = false;
        fetchBatch(msg.ids, msg.format, msg.skipExported, sendResponse, msg.globalOffset, msg.globalTotal, msg.accountSlot);
        return true;
    }

    if (msg.action === 'cancelExport') {
        __bgAborted = true;
        sendResponse({ ok: true, aborted: true });
        return true;
    }

    if (msg.action === 'abortSync') {
        __bgAborted = true;
        sendToGeminiTab({ action: 'abortSync' }, msg.accountSlot).catch(() => {});
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
                const res = await sendToGeminiTab({
                    action: 'deepScan',
                    maxIter: msg.maxIter || 150,
                    mode: msg.mode || 'auto'
                }, msg.accountSlot);
                sendResponse(res);
            } catch (e) {
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (msg.action === 'stopDeepScan') {
        __bgAborted = true;
        sendToGeminiTab({ action: 'stopDeepScan' }, msg.accountSlot)
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
    let exportedIds = {};
    let conversations = [];
    if (typeof StorageService !== 'undefined') {
        exportedIds = await StorageService.getExportedIds(slot);
        conversations = await StorageService.getConversations(slot);
    } else {
        const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
        const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
        const store = await chrome.storage.local.get([expKey, convKey]);
        exportedIds = store[expKey] || {};
        conversations = store[convKey] || [];
    }
    let toFetch = list;
    if (skipExported) {
        const normId = id => String(id || '').replace(/^c_/, '');
        const convMap = new Map(conversations.map(c => [normId(c.id), c]));
        const recMap = new Map(Object.entries(exportedIds).map(([id, r]) => [normId(id), r]));
        toFetch = list.filter(x => {
            if (/^Google Account/i.test(x.title || '') || /accounts\.google\.com|SignOutOptions/i.test(x.url || '')) return false;
            const nid = normId(x.id);
            const rec = recMap.get(nid);
            if (!rec) return true; // 从未导出过 → 导
            const cur = convMap.get(nid);
            if (!cur) return true; // 本地无该会话记录 → 保守重导
            const curTs = toMs(cur.timestamp);
            const expMs = toMs(rec.exportedAt);
            if (curTs && expMs) return curTs > expMs + 60000; // 导出后有过新活动 → 重导
            return false; // 无可靠更新时间信号 → 视为未更新，跳过
        });
    }

    const tab = await getGeminiTab(slot);
    if (!tab) {
        portSendResponse({
            success: false,
            error: '请先打开 gemini.google.com，保持登录状态'
        });
        return;
    }

    const totalCount = globalTotal || toFetch.length;
    function notifyProgress(doneIndex, title, id) {
        chrome.runtime.sendMessage({
            action: 'exportProgress',
            done: globalOffset + doneIndex,
            total: totalCount,
            title,
            id
        }).catch(() => {});
    }

    let done = 0;
    const results = [];
    async function fetchWithRetry(conversationId) {
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            if (__bgAborted) throw new Error('aborted');
            try {
                const d = await sendToGeminiTab({
                    action: 'getConversationDetail',
                    conversationId
                }, slot);
                // 服务端限频返回中包含 BardErrorInfo 时也视为可重试
                if (!d.success && d.error && /429|rate.?limit|Too Many|BardErrorInfo/i.test(String(d.error))) {
                    if (attempt < maxRetries) {
                        const backoff = 600 * Math.pow(2, attempt) + Math.random() * 300;
                        console.warn(`[BG] retry ${attempt+1} for ${conversationId} due to rate limit, backoff ${Math.round(backoff)}ms`);
                        await new Promise(r => setTimeout(r, backoff));
                        continue;
                    }
                }
                return d;
            } catch (e) {
                const msg = String(e.message || '');
                if (attempt < maxRetries && /429|rate.?limit|Too Many|network|timeout/i.test(msg)) {
                    const backoff = 600 * Math.pow(2, attempt) + Math.random() * 300;
                    console.warn(`[BG] retry ${attempt+1} for ${conversationId} due to ${msg}, backoff ${Math.round(backoff)}ms`);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                throw e;
            }
        }
    }

    const CONCURRENCY = 3;
    let nextIdx = 0;
    async function worker() {
        while (nextIdx < toFetch.length && !__bgAborted) {
            const item = toFetch[nextIdx++];
            if (!item) break;

            try {
                let data;
                try {
                    data = await fetchWithRetry(item.id);
                } catch (tabErr) {
                    if (String(tabErr.message) === 'aborted') break;
                    data = { success: false, error: tabErr.message };
                }

                if (data && data.success) {
                    let chat = data.data || data.chat || data;
                    chat.id = item.id;
                    const cleanDetailTitle = cleanTitle(chat.title);
                    const cleanItemTitle = cleanTitle(item.title);

                    chat.titles = { ...(item.titles || {}), ...(chat.titles || {}) };
                    if (chat.titleSource && cleanDetailTitle && (isRealTitle(cleanDetailTitle, item.id) || chat.titleSource === 'takeout')) {
                        chat.titles[chat.titleSource] = cleanDetailTitle;
                    } else if (cleanDetailTitle && isRealTitle(cleanDetailTitle, item.id)) {
                        chat.titles.sniff = cleanDetailTitle;
                    }
                    if (item.titleSource && cleanItemTitle && (isRealTitle(cleanItemTitle, item.id) || item.titleSource === 'takeout')) {
                        if (!chat.titles[item.titleSource]) {
                            chat.titles[item.titleSource] = cleanItemTitle;
                        }
                    }
                    const resolved = (typeof GeminiUtils !== 'undefined' && GeminiUtils.resolveTitle)
                        ? GeminiUtils.resolveTitle(chat)
                        : { title: cleanDetailTitle || cleanItemTitle || item.id, source: chat.titleSource || item.titleSource || 'default' };
                    chat.title = resolved.title;
                    chat.titleSource = resolved.source;
                    if (!chat.url) chat.url = item.url || `https://gemini.google.com/app/${item.id}`;

                    const msgCount = chat.messageCount || chat.messages?.length || 0;
                    const hasContent = msgCount > 0 || (chat.messages && chat.messages.some(m => (m.content && m.content.trim().length > 0) || (m.attachments && m.attachments.length > 0)));
                    const isEmptyFail = !hasContent && !chat.error;

                    if (isEmptyFail || chat.error) {
                        const failReason = chat.error || '云端返回内容为空';
                        const debugSnippet = chat._raw ? JSON.stringify(chat._raw).slice(0, 800) : (chat._debug ? JSON.stringify(chat._debug).slice(0, 800) : null);
                        if (isEmptyFail) console.warn(`[Gemini Exporter BG] empty detail for ${item.id} (${item.title}) _raw_len=${debugSnippet?.length || 0} hasMessages=${!!chat.messages}`);
                        results.push({
                            id: chat.id || item.id,
                            title: chat.title || item.title,
                            url: chat.url || item.url,
                            error: failReason,
                            messages: chat.messages || [],
                            messageCount: msgCount,
                            _empty: true,
                            _debug: debugSnippet,
                            _raw: chat._raw || null
                        });
                    } else {
                        results.push(chat);
                    }
                } else {
                    const failReason = data?.error || data?.message || '未知错误';
                    console.warn(`[Gemini Exporter BG] detail fetch failed for ${item.id} (${item.title}):`, failReason);
                    results.push({
                        id: item.id,
                        title: item.title,
                        url: item.url || `https://gemini.google.com/app/${item.id}`,
                        error: failReason,
                        messages: [],
                        messageCount: 0
                    });
                }
                ++done;
                notifyProgress(done, item.title, item.id);
                await new Promise(r => setTimeout(r, 60 + Math.random() * 40));
            } catch (e) {
                results.push({
                    id: item.id,
                    title: item.title,
                    url: item.url || `https://gemini.google.com/app/${item.id}`,
                    error: e.message || '抓取异常',
                    messages: [],
                    messageCount: 0
                });
                ++done;
                notifyProgress(done, item.title, item.id);
            }
        }
    }

    const workerCount = Math.min(CONCURRENCY, toFetch.length);
    const workers = [];
    for (let w = 0; w < workerCount; w++) {
        workers.push(worker());
    }
    await Promise.all(workers);

    portSendResponse({
        success: true,
        results,
        skipped: list.length - toFetch.length
    });
}