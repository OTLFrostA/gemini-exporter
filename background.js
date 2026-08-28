// background.js - Gemini Exporter background service worker
// Delegates conversation detail fetching to Gemini page content script
console.log('[Gemini Exporter] Background service worker ready');
let __bgAborted = false;

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

function sendToGeminiTab(msg, slot) {
    return getGeminiTab(slot).then(tab => {
        if (!tab) throw new Error('未找到 Gemini 标签页，请先打开 gemini.google.com');
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, msg, (res) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(res);
                }
            });
        });
    });
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

    if (msg.action === 'syncUpdate') {
        chrome.runtime.sendMessage({
            action: 'syncUpdate',
            slot: msg.slot,
            count: msg.count,
            newCount: msg.newCount || msg.count,
            from: msg.from || 'dom'
        }).catch(() => {});
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
    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
    const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
    const store = await chrome.storage.local.get([expKey, convKey]);
    const exportedIds = store[expKey] || {};
    const conversations = store[convKey] || [];
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
    for (const item of toFetch) {
        if (__bgAborted) break;

        try {
            let data;
            try {
                data = await sendToGeminiTab({
                    action: 'getConversationDetail',
                    conversationId: item.id
                }, slot);
            } catch (tabErr) {
                data = { success: false, error: tabErr.message };
            }

            if (data && data.success) {
                let chat = data.data || data.chat || data;
                chat.id = item.id;
                chat.title = item.title || chat.title;
                if (!chat.url) chat.url = item.url || `https://gemini.google.com/app/${item.id}`;

                const msgCount = chat.messageCount || chat.messages?.length || 0;
                const hasContent = msgCount > 0 || (chat.messages && chat.messages.some(m => (m.content && m.content.trim().length > 0) || (m.attachments && m.attachments.length > 0)));
                const isEmptyFail = !hasContent && !chat.error;

                if (isEmptyFail || chat.error) {
                    results.push({
                        id: chat.id || item.id,
                        title: chat.title || item.title,
                        url: chat.url || item.url,
                        error: chat.error || '空对话或取回失败',
                        messages: chat.messages || [],
                        messageCount: msgCount,
                        _empty: true
                    });
                    ++done;
                    notifyProgress(done, (chat.title || item.title) + ' (获取失败)', chat.id || item.id);
                } else {
                    results.push(chat);
                    ++done;
                    notifyProgress(done, chat.title, chat.id);
                }
            } else {
                results.push({
                    id: item.id,
                    title: item.title,
                    url: item.url || `https://gemini.google.com/app/${item.id}`,
                    error: data?.error || data?.message || '未知错误',
                    messages: [],
                    messageCount: 0
                });
                ++done;
                notifyProgress(done, item.title + ' (失败)', item.id);
            }
            await new Promise(r => setTimeout(r, 180 + Math.random() * 120));
        } catch (e) {
            results.push({
                id: item.id,
                title: item.title,
                error: e.message,
                messages: []
            });
            ++done;
            notifyProgress(done, item.title + ' (异常)', item.id);
        }
    }
    portSendResponse({
        success: true,
        results,
        skipped: list.length - toFetch.length
    });
}