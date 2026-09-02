// src/core/tabService.js - Unified Gemini Tab Discovery & Communication Service
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TabService = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    async function getGeminiTab(slot) {
        if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) return null;
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        if (!tabs || !tabs.length) return null;
        if (slot && slot !== 'u0') {
            const slotNum = slot.replace('u', '');
            const match = tabs.find(t => t.url && t.url.includes(`/u/${slotNum}/`));
            if (match) return match;
        } else if (slot === 'u0') {
            const defMatch = tabs.find(t => t.url && (!t.url.match(/\/u\/\d+\//) || t.url.includes('/u/0/')));
            if (defMatch) return defMatch;
        }
        return tabs.find(t => t.active) || tabs[0];
    }

    async function sendToGeminiTab(msg, slot, timeoutMs = 25000) {
        if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
            throw new Error('chrome.tabs API 不可用');
        }
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
        throw (lastError || new Error('未能与任何 Gemini 标签页成功建立通信'));
    }

    return {
        getGeminiTab,
        sendToGeminiTab
    };
}));
