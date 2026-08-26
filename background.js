// background.js - Gemini Exporter background service worker
// Delegates conversation detail fetching to Gemini page content script
console.log('[Gemini Exporter] Background service worker ready');
let __bgAborted = false;

function getGeminiTab() {
    return chrome.tabs.query({
        url: 'https://gemini.google.com/*'
    }).then(tabs => {
        if (!tabs.length) return null;
        return tabs.find(t => t.active) || tabs[0];
    });
}

function sendToGeminiTab(msg) {
    return getGeminiTab().then(tab => {
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
        sendResponse({
            ok: true
        });
        return;
    }
    if (msg.action === 'fetchChat') {
        sendToGeminiTab({
                action: 'getConversationDetail',
                conversationId: msg.id || msg.conversationId
            })
            .then(r => sendResponse(r))
            .catch(e => sendResponse({
                success: false,
                error: e.message
            }));
        return true;
    }
    if (msg.action === 'fetchBatch') {
        __bgAborted = false;
        fetchBatch(msg.ids, msg.format, msg.skipExported, sendResponse, msg.globalOffset, msg.globalTotal);
        return true;
    }
    if (msg.action === 'cancelExport') {
        __bgAborted = true;
        console.log('[Robust BG] cancelExport received, will stop');
        try {
            sendResponse({
                ok: true,
                aborted: true
            });
        } catch {}
        return true;
    }
    if (msg.action === 'ping') {
        sendResponse({
            ok: true,
            ver: 'robust-1.3.6'
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
                });
                sendResponse(res);
            } catch (e) {
                sendResponse({
                    success: false,
                    error: e.message
                });
            }
        })();
        return true;
    }
    if (msg.action === 'scrollToBottom') {
        (async () => {
            try {
                const res = await sendToGeminiTab({
                    action: 'deepScan',
                    maxIter: msg.maxIter || 150,
                    mode: msg.mode || 'auto'
                });
                sendResponse(res || {
                    success: true
                });
            } catch (e) {
                sendResponse({
                    success: false,
                    error: e.message
                });
            }
        })();
        return true;
    }
    if (msg.action === 'syncUpdateFromNetwork') {
        console.log('[Robust BG] syncUpdateFromNetwork', msg.count);
        try {
            try {
                const _p = chrome.runtime.sendMessage({
                    action: 'syncUpdate',
                    count: msg.count,
                    newCount: msg.added,
                    from: 'network-bg'
                });
                if (_p && _p.catch) _p.catch(() => {});
            } catch (e) {};
        } catch (e) {}
        try {
            sendResponse({
                ok: true,
                merged: msg.count
            });
        } catch (e) {}
        return;
    }
    if (msg.action === 'syncUpdate') {
        console.log('[Robust BG] syncUpdate forwarding', msg.count, 'from', msg.from, 'to workbench');
        // Forward to options page / other contexts - catch port closed silently
        try {
            try {
                const _p = chrome.runtime.sendMessage({
                    action: 'syncUpdate',
                    count: msg.count,
                    newCount: msg.newCount || msg.count,
                    from: msg.from || 'dom'
                });
                if (_p && _p.catch) _p.catch(err => {
                    if (!String(err).includes('Receiving end')) console.warn('[Robust BG] syncUpdate forward err', err);
                });
            } catch (e) {};
        } catch (e) {
            console.warn('[Robust BG] syncUpdate forward ex', e);
        }
        // Do not sendResponse to avoid needing return true, but if sender expects, we can keep channel open? No need.
        return;
    }
});

function toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : 0;
}
async function fetchBatch(list, format, skipExported, portSendResponse, globalOffset = 0, globalTotal = 0) {
    const {
        exportedIds = {}, gemini_conversations = []
    } = await chrome.storage.local.get(['exportedIds', 'gemini_conversations']);
    let toFetch = list;
    if (skipExported) {
        const normId = id => String(id || '').replace(/^c_/, '');
        const convMap = new Map((gemini_conversations || []).map(c => [normId(c.id), c]));
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

    const tabs = await chrome.tabs.query({
        url: 'https://gemini.google.com/*'
    });
    if (!tabs.length) {
        portSendResponse({
            success: false,
            error: '请先打开 gemini.google.com，保持登录状态'
        });
        return;
    }

    let done = 0;
    const results = [];
    for (const item of toFetch) {
        if (__bgAborted) {
            console.log('[Robust BG] fetchBatch aborted mid loop');
            break;
        }
        try {
            // 优先走 batchexecute / DOM 解析，全部在 Gemini 页完成
            let data;
            try {
                data = await sendToGeminiTab({
                    action: 'getConversationDetail',
                    conversationId: item.id
                });
            } catch (tabErr) {
                data = {
                    success: false,
                    error: tabErr.message
                };
            }

            if (data && data.success) {
                // content.js 返回 {success:true, data:{id,title,messages...}}
                // 兼容两种返回格式
                let chat = data.data || data.chat || data;
                if (!chat.id) chat.id = item.id;
                chat.title = item.title || chat.title;
                if (!chat.url) chat.url = item.url || `https://gemini.google.com/app/${item.id}`;
                // 判断是否真的取到了内容
                const msgCount = chat.messageCount || chat.messages?.length || 0;
                const hasContent = msgCount > 0 || (chat.messages && chat.messages.some(m => (m.content && m.content.trim().length > 0) || (m.attachments && m.attachments.length > 0)));
                const isEmptyFail = !hasContent && !chat.error;
                // 如果空对话（messages 0）视为失败，不计入已导出，允许二次导出
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
                    try {
                        const _p = chrome.runtime.sendMessage({
                            action: 'exportProgress',
                            done: globalOffset + done,
                            total: globalTotal || toFetch.length,
                            title: (chat.title || item.title) + ' (获取失败)',
                            id: chat.id || item.id
                        });
                        if (_p && _p.catch) _p.catch(() => {});
                    } catch (e) {};
                } else {
                    results.push(chat);
                    ++done;
                    try {
                        const _p = chrome.runtime.sendMessage({
                            action: 'exportProgress',
                            done: globalOffset + done,
                            total: globalTotal || toFetch.length,
                            title: chat.title,
                            id: chat.id
                        });
                        if (_p && _p.catch) _p.catch(() => {});
                    } catch (e) {};
                }
            } else {
                results.push({
                    id: item.id,
                    title: item.title,
                    url: item.url || `https://gemini.google.com/app/${item.id}`,
                    error: data.error || data.message || '未知错误',
                    messages: [],
                    messageCount: 0
                });
                ++done;
                chrome.runtime.sendMessage({
                    action: 'exportProgress',
                    done: globalOffset + done,
                    total: globalTotal || toFetch.length,
                    title: item.title + ' (失败)',
                    id: item.id
                }).catch(() => {});
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
            chrome.runtime.sendMessage({
                action: 'exportProgress',
                done: globalOffset + done,
                total: globalTotal || toFetch.length,
                title: item.title + ' (异常)',
                id: item.id
            }).catch(() => {});
        }
    }
    portSendResponse({
        success: true,
        results,
        skipped: list.length - toFetch.length
    });
}

function cleanText(t) {
    return t ? t.replace(/\u00a0/g, ' ').replace(/\r/g, '').trim().slice(0, 20000) : '';
}