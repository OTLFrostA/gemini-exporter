// pagination.js - Conversation list and detail multi-page pagination controller
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.GeminiClientPagination = factory();
    }
}(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function() {
    'use strict';

    function getUtils() {
        if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils) return globalThis.GeminiUtils;
        if (typeof require !== 'undefined') {
            try { return require('../../utils/utils.js'); } catch (_) {
                try { return require('../utils/utils.js'); } catch (_) {}
            }
        }
        return null;
    }

    /**
     * Traverses all conversation list pages with incremental detection and Google limit tracking
     */
    async function getAllConversations(client, maxPages = 2000, onProgress, targetSid, opts) {
        if (typeof maxPages === 'object' && maxPages !== null) {
            opts = maxPages;
            maxPages = opts.maxPages !== undefined ? opts.maxPages : 2000;
            onProgress = opts.onProgress || null;
            targetSid = opts.targetSid || null;
        }
        if (!maxPages || typeof maxPages !== "number") maxPages = 2000;
        opts = opts || {};
        const existingMap = opts.existingMap || null;
        const incremental = !!opts.incremental;
        const unchangedThreshold = opts.unchangedThreshold || 5;
        let all = [],
            seen = new Set(),
            token = null;
        let unchangedStreak = 0;
        const diagLog = {
            startTime: new Date().toISOString(),
            maxPages,
            incremental,
            totalPagesFetched: 0,
            totalConversations: 0,
            stopReason: '就绪（尚未触发同步）',
            hitGoogleLimit: false,
            pageHistory: []
        };
        client.aborted = false;
        // 兼容 content.js 的 window 全局中止标志（旧链路仅置 window 标志，未调 client.abort）
        const isAborted = () => (typeof client.isAborted === 'function' ? client.isAborted() : (client.aborted || (typeof window !== 'undefined' && window.__gemExporterAborted) || (typeof globalThis !== 'undefined' && globalThis.__gemExporterAborted)));
        let reachedMax = true;
        for (let i = 0; i < maxPages; i++) {
            if (isAborted()) {
                diagLog.stopReason = `用户手动终止同步 (已拉取 ${i} 页，共 ${all.length} 条)`;
                console.log(`[Gemini Exporter] getAllConversations aborted by user at page ${i + 1}`);
                reachedMax = false;
                break;
            }
            let res;
            try {
                res = await client.getConversationList(token, targetSid);
            } catch (err) {
                console.warn(`[Gemini Exporter] getAllConversations page ${i + 1} stopped:`, err.message || err);
                const errMsg = String(err?.message || err);
                const isLimit = errMsg.includes('BardErrorInfo')
                    || errMsg.includes('1096')
                    || errMsg.includes('429')
                    || /quota|rate\s*limit|resource_exhausted|too\s*many\s*requests/i.test(errMsg);
                if (isLimit) {
                    diagLog.hitGoogleLimit = true;
                }
                diagLog.stopReason = `网络或服务异常: ${err.message || err}`;
                reachedMax = false;
                if (all.length > 0) {
                    break;
                }
                throw err;
            }
            diagLog.totalPagesFetched = i + 1;
            diagLog.pageHistory.push({
                page: i + 1,
                requestedToken: token ? { len: token.length, preview: token.slice(0, 20) + '...' } : null,
                count: res?.conversations?.length || 0,
                hasNextPageToken: !!res?.nextPageToken,
                nextTokenPreview: res?.nextPageToken ? { len: res.nextPageToken.length, preview: res.nextPageToken.slice(0, 20) + '...' } : null,
                debugInfo: res?._debug || null
            });
            let added = 0;
            for (let c of res.conversations) {
                if (!seen.has(c.id)) {
                    seen.add(c.id);
                    all.push(c);
                    added++;
                    if (incremental && existingMap) {
                        const stored = existingMap.get(c.id);
                        if (stored && stored.timestamp && c.timestamp) {
                            const sameTime = Math.abs(stored.timestamp - c.timestamp) < 60000;
                            const sameTitle = !stored.title || !c.title || stored.title === c.title;
                            if (sameTime && sameTitle) {
                                unchangedStreak++;
                            } else {
                                unchangedStreak = 0;
                            }
                        } else if (!stored) {
                            unchangedStreak = 0;
                        } else {
                            unchangedStreak = 0;
                        }
                        if (unchangedStreak >= unchangedThreshold) {
                            diagLog.stopReason = `增量同步命中连续 ${unchangedStreak} 条已存在历史，早退终止`;
                            diagLog.totalConversations = all.length;
                            diagLog.endTime = new Date().toISOString();
                            if (onProgress) onProgress({
                                page: i + 1,
                                added,
                                total: all.length,
                                hasMore: false,
                                stoppedEarly: true,
                                reason: '增量同步完成'
                            });
                            return {
                                conversations: all,
                                total: all.length,
                                stoppedEarly: true,
                                unchangedStreak,
                                diagnostics: diagLog,
                                hitGoogleLimit: !!diagLog.hitGoogleLimit
                            };
                        }
                    }
                }
            }
            if (!res.conversations || res.conversations.length === 0) {
                const isGoogleLimit = res?._debug?.bardError || res?._debug?.error === 'BARD_ERROR_INFO';
                if (isGoogleLimit) {
                    diagLog.hitGoogleLimit = true;
                    diagLog.stopReason = `Google 服务端翻页到达极限 (BardErrorInfo: 游标链已达服务端上限)`;
                } else {
                    diagLog.stopReason = `第 ${i + 1} 页返回 0 条数据，Google 服务端已无更早历史`;
                }
                reachedMax = false;
                console.log(`[Gemini Exporter] getAllConversations reached end at page ${i + 1}, total: ${all.length}, reason: ${diagLog.stopReason}`);
                break;
            }
            if (onProgress) onProgress({
                page: i + 1,
                added,
                total: all.length,
                hasMore: !!res.nextPageToken,
                batch: res.conversations
            });
            if (!res.nextPageToken) {
                diagLog.stopReason = `第 ${i + 1} 页未返回下页游标 nextPageToken，Google 服务端游标已到底`;
                reachedMax = false;
                console.log(`[Gemini Exporter] getAllConversations finished at page ${i + 1}, total: ${all.length}, hitGoogleLimit: ${diagLog.hitGoogleLimit}`);
                break;
            }
            token = res.nextPageToken;
            const pageDelay = incremental ? 50 : 120;
            await new Promise(r => setTimeout(r, pageDelay));
        }
        if (reachedMax && maxPages > 0) {
            diagLog.stopReason = `已达到最大页数限制 (${maxPages} 页)`;
        }
        // Note: If all.length >= 500 but no server-side error occurred, geminiClient marks normal completion.
        // UI layer provides browsing window limit guidance to recommend Takeout when all.length >= 500.
        diagLog.totalConversations = all.length;
        diagLog.endTime = new Date().toISOString();
        return {
            conversations: all,
            total: all.length,
            diagnostics: diagLog,
            hitGoogleLimit: !!diagLog.hitGoogleLimit
        };
    }

    /**
     * Traverses and aggregates all turns of a conversation detail with metadata-only retry
     */
    async function getConversationDetail(client, conversationId, targetSid) {
        let msgs = [];
        let token = null;
        let first = null;
        let attempts = 0;
        do {
            let page = await client.fetchConversationPage(conversationId, token, targetSid);
            if (!first) first = page;
            msgs = [...page.messages, ...msgs];
            token = page.nextPageToken || null;
            attempts++;
        } while (token && attempts < 20);
        if (!first) throw new Error("no data");

        // If the primary request returned metadata-only (no messages, but raw data present),
        // do one retry with DETAIL-only RPC and alternative innerDetail params.
        if (!msgs.length && first._raw) {
            const inner = first._raw;
            const looksMetadataOnly = Array.isArray(inner) && inner[0] === null && inner[1] === null
                && Array.isArray(inner[2]) && inner[2].length > 0
                && typeof inner[2][0]?.[0] === 'string' && inner[2][0][0].startsWith('c_');
            if (looksMetadataOnly) {
                try {
                    const retry = await client.fetchConversationPage(conversationId, null, targetSid, { detailOnly: true, altParams: true });
                    if (retry && retry.messages && retry.messages.length > 0) {
                        const primaryTitle = first.title;
                        const primaryTitles = first.titles;
                        const primarySource = first.titleSource;
                        msgs = retry.messages;
                        first = retry;
                        if (primarySource === 'rpc' && primaryTitle && primaryTitle !== '未命名对话' && first.titleSource !== 'rpc') {
                            first.title = primaryTitle;
                            first.titles = { ...(first.titles || {}), ...(primaryTitles || {}) };
                            first.titleSource = 'rpc';
                        }
                    }
                } catch (retryErr) {
                    const isDevMode = !!(getUtils()?.isDevMode ? getUtils().isDevMode() : false);
                    if (isDevMode) {
                        console.warn('[Gemini Exporter Client] metadata-only retry also failed:', retryErr.message);
                    }
                }
            }
        }

        let allTimestamps = msgs.map(m => m.timestamp).filter(x => typeof x === 'number' && Number.isFinite(x) && x > 0);
        let minTs = allTimestamps.length ? Math.min(...allTimestamps) : (first.createdAt || null);
        let maxTs = allTimestamps.length ? Math.max(...allTimestamps) : (first.updatedAt || minTs || null);
        let attachmentCount = msgs.reduce((a, m) => a + (m.attachmentCount || 0), 0);
        let cleanId = String(conversationId).replace(/^c_/, '').trim();
        return {
            ...first,
            id: cleanId,
            messages: msgs,
            messageCount: msgs.length,
            timestamp: maxTs,
            createdAt: minTs,
            chatTime: maxTs,
            updatedAt: maxTs,
            attachmentCount
        };
    }

    return {
        getAllConversations,
        getConversationDetail
    };
}));
