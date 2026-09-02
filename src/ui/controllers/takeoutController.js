// src/ui/controllers/takeoutController.js - Takeout Import Controller
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TakeoutController = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    const normId = id => (typeof GeminiUtils !== 'undefined' && GeminiUtils.normId)
        ? GeminiUtils.normId(id)
        : String(id || '').replace(/^c_/, '');

    async function handleTakeoutImport(file, { onProgress, onLog, onFinished, onError } = {}) {
        if (!file) return;
        const Takeout = (typeof TakeoutEngine !== 'undefined') ? TakeoutEngine : null;
        if (!Takeout || !Takeout.parseTakeoutZip) {
            const err = new Error('TakeoutEngine module not loaded');
            if (onError) onError(err);
            else throw err;
            return;
        }

        try {
            const res = await Takeout.parseTakeoutZip(file, (pct, txt) => {
                if (onProgress) onProgress(pct, txt);
                if (onLog) onLog(txt, 'info');
            });

            const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
            const convs = Store ? Store.getConversations() : [];
            const existingMap = new Map();
            for (const c of convs) {
                existingMap.set(normId(c.id).toLowerCase(), c);
            }

            let addedCount = 0;
            for (const tc of res.conversations) {
                const nid = normId(tc.id).toLowerCase();
                if (!existingMap.has(nid)) {
                    convs.push(tc);
                    existingMap.set(nid, tc);
                    addedCount++;
                }
            }

            if (addedCount > 0 && Store) {
                const slot = Store.getCurrentSlot() || 'u0';
                await Store.saveConversations(slot, convs);
            }

            const successMsg = typeof I18n !== 'undefined'
                ? I18n.t('takeoutSuccessDetail', res.conversations.length, addedCount, res.totalMediaCount)
                : `Takeout 解析成功！发现 ${res.conversations.length} 条对话，已补全 ${addedCount} 条缺失历史，索引 ${res.totalMediaCount} 个离线资源`;

            if (onLog) onLog(successMsg, 'info');
            if (onFinished) onFinished({ res, addedCount, totalMediaCount: res.totalMediaCount, message: successMsg });
        } catch (err) {
            const errMsg = typeof I18n !== 'undefined' ? I18n.t('takeoutError', err.message) : `Takeout 导入失败: ${err.message}`;
            if (onLog) onLog(errMsg, 'error');
            if (onError) onError(err, errMsg);
        }
    }

    return {
        handleTakeoutImport
    };
}));
