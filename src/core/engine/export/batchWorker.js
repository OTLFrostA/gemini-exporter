// batchWorker.js - Single-chat remote fetching, exponential rate-limit backoff, and title/media resolution
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.BatchWorker = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    const getUtils = () => {
        if (typeof GeminiUtils !== 'undefined') return GeminiUtils;
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils) return globalThis.GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../../utils/utils.js'); } catch { /* intentional: require fallback in browser context */ }
        }
        return null;
    };

    const normId = (id) => (getUtils()?.normId ? getUtils().normId(id) : String(id || '').replace(/^c_/, '').trim());
    const cleanTitle = (t) => (getUtils()?.cleanTitle ? getUtils().cleanTitle(t) : (t || '').trim());
    const isRealTitle = (t, fallbackId) => (getUtils()?.isRealTitle ? getUtils().isRealTitle(t, fallbackId) : !!(t && typeof t === 'string' && t.trim().length > 1));
    const resolveTitle = (chat) => (getUtils()?.resolveTitle ? getUtils().resolveTitle(chat) : { title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' });

    async function fetchChatDetail(requestedItem, currentIndex, totalChats, currentSlot, skip, format, abortSignal, options = {}) {
        const nid = normId(requestedItem.id);
        const messageSender = options.messageSender || null;
        const tabService = options.tabService || (typeof TabService !== 'undefined' ? TabService : (typeof globalThis !== 'undefined' && globalThis.TabService ? globalThis.TabService : null));

        return new Promise(async (resolve) => {
            let settled = false;
            const onAbort = () => {
                if (!settled) {
                    settled = true;
                    resolve({ success: false, error: 'aborted' });
                }
            };
            if (abortSignal) {
                if (abortSignal.aborted) return onAbort();
                abortSignal.addEventListener('abort', onAbort, { once: true });
            }

            try {
                if (tabService && tabService.sendToGeminiTab) {
                    const directRes = await tabService.sendToGeminiTab({
                        action: 'getConversationDetail',
                        conversationId: nid,
                        accountSlot: currentSlot
                    }, currentSlot);
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled) {
                        settled = true;
                        if (directRes && directRes.success) {
                            const chat = directRes.data || directRes.chat || directRes;
                            resolve({ success: true, results: [chat], skipped: 0 });
                            return;
                        } else if (directRes && directRes.error) {
                            resolve(directRes);
                            return;
                        }
                    }
                }
            } catch (directErr) {
                if (String(directErr?.message || '').includes('aborted')) {
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled) { settled = true; resolve({ success: false, error: 'aborted' }); }
                    return;
                }
            }

            const sender = messageSender || (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime.sendMessage.bind(chrome.runtime) : null);

            if (sender) {
                sender({
                    action: 'fetchBatch',
                    ids: [requestedItem],
                    format,
                    skipExported: skip,
                    globalOffset: currentIndex,
                    globalTotal: totalChats,
                    accountSlot: currentSlot
                }, (response) => {
                    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                    if (!settled) {
                        settled = true;
                        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) {
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve(response);
                        }
                    }
                });
            } else {
                if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
                if (!settled) {
                    settled = true;
                    resolve({ success: false, error: 'chrome.runtime not available' });
                }
            }
        });
    }

    async function resolveChat(chat, requestedItem, listConversation, takeoutEngine, currentSlot, onTitleUpdated = (() => {}), onLog = (() => {}), options = {}) {
        const nid = normId(requestedItem.id);
        const slot = currentSlot || 'u0';
        let convsNeedSave = false;

        // 1. Takeout offline chat fallback
        if ((chat.error || chat._empty || !chat.messages || chat.messages.length === 0) && takeoutEngine) {
            const fbChat = takeoutEngine.getTakeoutOfflineChat(nid, slot);
            if (fbChat && fbChat.messages && fbChat.messages.length > 0) {
                chat = {
                    ...fbChat,
                    id: nid,
                    title: isRealTitle(chat.title, nid) ? chat.title : fbChat.title,
                    url: `https://gemini.google.com/app/${nid}`
                };
                delete chat.error;
                delete chat._empty;
                onLog(typeof I18n !== 'undefined' ? I18n.t('logTakeoutChatRecovered', chat.title || nid) : `[${chat.title || nid}] ⚡ 已自动从 Takeout 离线记录恢复问答并导出`, 'info');
            }
        }

        // 2. Supplement missing offline generated media from Takeout
        if (takeoutEngine && typeof takeoutEngine.getTakeoutMediaForChat === 'function' && Array.isArray(chat.messages) && chat.messages.length > 0) {
            const takeoutMedia = takeoutEngine.getTakeoutMediaForChat(nid, slot);
            if (takeoutMedia && takeoutMedia.length > 0) {
                for (const tm of takeoutMedia) {
                    const alreadyHas = chat.messages.some(m =>
                        (m.images && m.images.some(im => im.fileName === tm.filename || (im.localName && im.localName.includes(tm.filename)))) ||
                        (m.attachments && m.attachments.some(at => at.fileName === tm.filename || (at.localName && at.localName.includes(tm.filename)))) ||
                        (m.content && m.content.includes(tm.filename))
                    );
                    if (!alreadyHas) {
                        const imgObj = {
                            url: tm.filename,
                            name: tm.filename,
                            fileName: tm.filename,
                            localName: `assets/${tm.filename}`,
                            source: 'takeout',
                            isGenerated: true
                        };
                        let targetModelMsg = chat.messages.slice().reverse().find(m => m.role === 'model');
                        if (targetModelMsg) {
                            targetModelMsg.images = targetModelMsg.images || [];
                            targetModelMsg.attachments = targetModelMsg.attachments || [];
                            targetModelMsg.images.push(imgObj);
                            targetModelMsg.attachments.push(imgObj);
                            if (!targetModelMsg.content.includes(tm.filename)) {
                                targetModelMsg.content = (targetModelMsg.content ? targetModelMsg.content + '\n\n' : '') + `![Generated Image](assets/${tm.filename})`;
                            }
                        } else {
                            chat.messages.push({
                                role: 'model',
                                content: `![Generated Image](assets/${tm.filename})`,
                                timestamp: Date.now(),
                                images: [imgObj],
                                attachments: [imgObj]
                            });
                        }
                    }
                }
            }
        }

        // 3. Error or empty handling
        if (chat.error || chat._empty) {
            const isConfirmedDeleted = !!chat.isDeleted || !!chat._debug?.isNotFound || !!chat._debug?.domDebug?.isNotFound;
            const cleanForLog = t => String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
            const rawTitle = chat.title || nid;
            const displayTitle = cleanForLog(rawTitle) && !/^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForLog(rawTitle)) ? cleanForLog(rawTitle) : nid;
            const debugInfo = chat._debug ? ` _debug=${String(chat._debug).slice(0, 200)}` : (chat._raw ? ` _raw_len=${JSON.stringify(chat._raw).length}` : '');
            const errMsg = (isConfirmedDeleted ? '云端会话已被删除或不存在' : (chat.error || '云端返回内容为空（服务端未返回任何消息，可能为限频、对话已被清空/归档或新格式未兼容）')) + debugInfo;

            if (isConfirmedDeleted) {
                try {
                    const storage = typeof StorageService !== 'undefined' ? StorageService : (typeof window !== 'undefined' && window.StorageService);
                    if (storage && typeof storage.removeConversation === 'function') {
                        await storage.removeConversation(currentSlot || 'u0', nid);
                        const sender = options.messageSender || (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage ? chrome.runtime.sendMessage.bind(chrome.runtime) : null);
                        if (sender) {
                            const p = sender({ action: 'syncUpdate', slot: currentSlot || 'u0', count: -1, from: 'export-prune-deleted' });
                            if (p && p.catch) p.catch(() => {});
                        }
                    }
                } catch (e) {
                    if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:batchWorker.js]', e);
                }
                onLog(typeof I18n !== 'undefined' ? I18n.t('logChatDeletedAndPruned', displayTitle) : `[${displayTitle}] ⚡ 云端已确认该会话不存在或已被删除，已自动从本地列表中移除`, 'warn');
            } else {
                onLog(typeof I18n !== 'undefined' ? I18n.t('logExportSkipped', displayTitle, errMsg) : `[${displayTitle}] 导出跳过: ${errMsg}`, 'error');
            }

            return {
                chat,
                displayTitle,
                isConfirmedDeleted,
                isError: true,
                errMsg,
                convsNeedSave: false
            };
        }

        // 4. Sniff title from first user query if needed
        if (!isRealTitle(chat.title, chat.id) && Array.isArray(chat.messages)) {
            const firstUser = chat.messages.find(m => m.role === 'user' && m.content && m.content.trim());
            if (firstUser) {
                let candidate = firstUser.content.trim();
                candidate = candidate.replace(/^(请问一下|请问|我想问一下|我想问|你能帮我|帮我|你能|请教一下|请教|都说|那么|那个|如果说|如果|我发现|为什么)\s*[,，:：]?\s*/i, '');
                const breakMatch = candidate.match(/^([^，。？！\n\r\t,?!]{4,35})/);
                if (breakMatch && breakMatch[1]) {
                    candidate = breakMatch[1].trim();
                } else {
                    candidate = candidate.slice(0, 30).trim();
                }
                if (isRealTitle(candidate, chat.id)) {
                    chat.title = candidate;
                    chat.titleSource = 'sniff';
                    chat.titles = chat.titles || {};
                    chat.titles.sniff = candidate;
                }
            }
        }

        // 5. Brand scrub and multi-source title resolution
        let finalTitle = chat.title || listConversation?.title || chat.id;

        if (listConversation) {
            const cleanForBad = t => String(t || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
            const isBadBrand = t => !t || /^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(cleanForBad(t));
            listConversation.titles = listConversation.titles || {};
            for (const [k, v] of Object.entries(listConversation.titles)) {
                if (isBadBrand(v)) delete listConversation.titles[k];
            }
            if (chat.titles && typeof chat.titles === 'object') {
                for (const [k, v] of Object.entries(chat.titles)) {
                    if (isBadBrand(v)) delete chat.titles[k];
                }
                Object.assign(listConversation.titles, chat.titles);
            }
            if (chat.titleSource && isRealTitle(chat.title, chat.id) && chat.title !== chat.id) {
                listConversation.titles[chat.titleSource] = cleanTitle(chat.title);
            }
            const resolved = resolveTitle(listConversation);
            const cleanResolved = String(resolved.title || '').replace(/[\u200E\u200B\uFEFF\u00A0]/g, '').trim();
            if (resolved.title && /^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(cleanResolved)) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn('[Export] skip bad brand resolved title', nid, resolved.title);
                }
            } else if (listConversation.title !== resolved.title || listConversation.titleSource !== resolved.source) {
                listConversation.title = resolved.title;
                listConversation.titleSource = resolved.source;
                convsNeedSave = true;
                onTitleUpdated(nid, listConversation.title, listConversation.titleSource);
            }
            finalTitle = listConversation.title;
        } else if (isRealTitle(chat.title, chat.id)) {
            finalTitle = cleanTitle(chat.title);
        }
        chat.title = finalTitle;

        return {
            chat,
            listTitle: finalTitle,
            isConfirmedDeleted: false,
            isError: false,
            errMsg: null,
            convsNeedSave
        };
    }

    return {
        fetchChatDetail,
        resolveChat
    };
}));
