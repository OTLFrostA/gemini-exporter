// storage_service.js - Unified multi-account Chrome storage access and key management
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.StorageService = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function normSlot(slot) {
        if (!slot || slot === 'default' || slot === 'u0') return 'u0';
        const m = String(slot).match(/u(\d+)/i);
        return m ? ('u' + m[1]) : 'u0';
    }

    function normId(id) {
        if (!id) return '';
        return String(id).replace(/^c_/, '').trim();
    }

    function getStorageKeys(slot) {
        const s = normSlot(slot);
        return {
            slot: s,
            convKey: s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`,
            expKey: s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`,
            syncKey: s === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${s}`,
            countKey: s === 'u0' ? 'gemini_last_count' : `gemini_last_count_${s}`
        };
    }

    async function getConversations(slot) {
        const { convKey, slot: s } = getStorageKeys(slot);
        const keys = [convKey];
        if (s === 'u0') {
            keys.push('gemini_conversations_u0');
        }
        const data = await chrome.storage.local.get(keys);
        return data[convKey] || (s === 'u0' ? data.gemini_conversations_u0 : null) || [];
    }

    async function setConversations(slot, list) {
        const { convKey } = getStorageKeys(slot);
        await chrome.storage.local.set({ [convKey]: list || [] });
    }

    async function getExportedIds(slot) {
        const { expKey, slot: s } = getStorageKeys(slot);
        const keys = [expKey, 'exportedIds', 'gemini_exported_u0'];
        if (s !== 'u0') {
            keys.push(`gemini_exported_${s}`);
        }
        const data = await chrome.storage.local.get(keys);
        const merged = {};
        if (data.exportedIds && typeof data.exportedIds === 'object') {
            Object.assign(merged, data.exportedIds);
        }
        if (data.gemini_exported_u0 && typeof data.gemini_exported_u0 === 'object') {
            Object.assign(merged, data.gemini_exported_u0);
        }
        if (data[expKey] && typeof data[expKey] === 'object') {
            Object.assign(merged, data[expKey]);
        }
        return merged;
    }

    async function setExportedIds(slot, map) {
        const { expKey, slot: s } = getStorageKeys(slot);
        const updates = { [expKey]: map || {} };
        if (s === 'u0') {
            updates['exportedIds'] = map || {};
        }
        await chrome.storage.local.set(updates);
    }

    async function saveExportRecord(slot, id, record) {
        const { expKey, slot: s } = getStorageKeys(slot);
        const cur = await getExportedIds(slot);
        const nid = normId(id);
        cur[id] = record;
        cur[nid] = record;
        cur['c_' + nid] = record;
        const updates = { [expKey]: cur };
        if (s !== 'u0') {
            const globalData = await chrome.storage.local.get(['exportedIds']);
            const globalExp = (globalData.exportedIds && typeof globalData.exportedIds === 'object') ? globalData.exportedIds : {};
            globalExp[id] = record;
            globalExp[nid] = record;
            globalExp['c_' + nid] = record;
            updates['exportedIds'] = globalExp;
        }
        await chrome.storage.local.set(updates);
        return cur;
    }

    async function getLastSync(slot) {
        const { syncKey, countKey } = getStorageKeys(slot);
        const data = await chrome.storage.local.get([syncKey, countKey]);
        return {
            timestamp: data[syncKey] || null,
            count: data[countKey] || 0
        };
    }

    async function setLastSync(slot, timestamp, count) {
        const { syncKey, countKey } = getStorageKeys(slot);
        await chrome.storage.local.set({
            [syncKey]: timestamp || Date.now(),
            [countKey]: typeof count === 'number' ? count : 0
        });
    }

    async function getAccountSlots() {
        const data = await chrome.storage.local.get(['gemini_account_slots']);
        return data.gemini_account_slots || {};
    }

    async function setAccountSlots(map) {
        await chrome.storage.local.set({ gemini_account_slots: map || {} });
    }

    async function updateAccountSlot(slot, info) {
        const s = normSlot(slot);
        const map = await getAccountSlots();
        map[s] = { ...(map[s] || {}), ...(info || {}) };
        await setAccountSlots(map);
        return map;
    }

    async function getCredentialsMap() {
        const data = await chrome.storage.local.get(['gemini_credentials_map']);
        return data.gemini_credentials_map || {};
    }

    async function setCredentialsMap(map) {
        await chrome.storage.local.set({ gemini_credentials_map: map || {} });
    }

    async function getDevMode() {
        const data = await chrome.storage.local.get(['gemini_dev_mode']);
        return !!data.gemini_dev_mode;
    }

    async function setDevMode(enabled) {
        await chrome.storage.local.set({ gemini_dev_mode: !!enabled });
    }

    return {
        normSlot,
        normId,
        getStorageKeys,
        getConversations,
        setConversations,
        getExportedIds,
        setExportedIds,
        saveExportRecord,
        getLastSync,
        setLastSync,
        getAccountSlots,
        setAccountSlots,
        updateAccountSlot,
        getCredentialsMap,
        setCredentialsMap,
        getDevMode,
        setDevMode
    };
}));
