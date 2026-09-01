// src/ui/state/conversationsStore.js - State layer, no DOM rendering, only data + storage
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ConversationsStore = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';
    let conversations = [];
    let exportedIds = {};
    let currentSlot = 'u0';
    let accountSlots = {};

    const getStorage = () => (typeof StorageService !== 'undefined' ? StorageService : (typeof window !== 'undefined' && window.StorageService) || null);

    const normId = id => String(id || '').replace(/^c_/, '');

    function getConversations() { return conversations; }
    function setConversations(list) { conversations = list || []; }
    function getExportedIds() { return exportedIds; }
    function setExportedIds(map) { exportedIds = map || {}; }
    function getCurrentSlot() { return currentSlot; }
    function setCurrentSlot(slot) { currentSlot = slot || 'u0'; }
    function getAccountSlots() { return accountSlots; }
    function setAccountSlots(map) { accountSlots = map || {}; }

    function getExportedRecord(id) {
        if (!id || !exportedIds) return null;
        const nid = normId(id);
        return exportedIds[id] || exportedIds['c_' + nid] || exportedIds[nid] || null;
    }

    function getSignature(list) {
        const l = list || conversations;
        if (!l || !l.length) return 'empty';
        try {
            const ids = l.map(c => c.id);
            if (ids.length <= 6) return ids.join('|') + '|' + ids.length;
            return ids.slice(0, 3).join(',') + '|' + ids.slice(-3).join(',') + '|len=' + ids.length + '|s=' + ids.reduce((a, b) => a + (String(b).charCodeAt(0) || 0), 0) % 10000;
        } catch {
            return 'err-' + (l.length || 0);
        }
    }

    async function loadStore(slotOverride) {
        const slot = slotOverride || currentSlot || 'u0';
        const storage = getStorage();
        const slots = storage ? await storage.getAccountSlots() : ((await chrome.storage.local.get(['gemini_account_slots'])).gemini_account_slots || {});
        setAccountSlots(slots);

        let incoming = storage ? await storage.getConversations(slot) : [];
        // fallback to u0 if requested slot empty
        if ((!incoming || !incoming.length) && slot !== 'u0') {
            const u0Convs = storage ? await storage.getConversations('u0') : [];
            if (u0Convs && u0Convs.length) {
                setCurrentSlot('u0');
                incoming = u0Convs;
            }
        }
        const expIds = storage ? await storage.getExportedIds(slot) : {};
        setExportedIds(expIds);
        setConversations(incoming);
        return { conversations: incoming, exportedIds: expIds, slot, accountSlots: slots };
    }

    async function getLastSync(slot) {
        const s = slot || currentSlot || 'u0';
        const storage = getStorage();
        if (storage && storage.getLastSync) return await storage.getLastSync(s);
        const syncKey = s === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${s}`;
        const countKey = s === 'u0' ? 'gemini_last_sync_count' : `gemini_last_sync_count_${s}`;
        const data = await chrome.storage.local.get([syncKey, countKey]);
        return { timestamp: data[syncKey] || null, count: data[countKey] || 0 };
    }

    async function saveConversations(slot, list) {
        const s = slot || currentSlot;
        const storage = getStorage();
        if (storage) await storage.setConversations(s, list);
        else {
            const convKey = s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`;
            await chrome.storage.local.set({ [convKey]: list || [] });
        }
        if (s === currentSlot) setConversations(list);
    }

    async function saveExportedIds(slot, map) {
        const s = slot || currentSlot;
        const storage = getStorage();
        if (storage) await storage.setExportedIds(s, map);
        else {
            const expKey = s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
            await chrome.storage.local.set({ [expKey]: map || {} });
        }
        if (s === currentSlot) setExportedIds(map);
    }

    async function clearExported(slot) {
        const s = slot || currentSlot;
        const storage = getStorage();
        if (storage && storage.setExportedIds) await storage.setExportedIds(s, {});
        else {
            const expKey = s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
            await chrome.storage.local.remove([expKey]);
        }
        if (s === currentSlot) setExportedIds({});
    }

    async function clearAll(slot) {
        const s = slot || currentSlot;
        const storage = getStorage();
        if (storage && storage.setConversations) await storage.setConversations(s, []);
        else {
            const convKey = s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`;
            await chrome.storage.local.remove([convKey]);
        }
        if (s === currentSlot) setConversations([]);
    }

    async function getDevMode() {
        const storage = getStorage();
        if (storage && storage.getDevMode) return await storage.getDevMode();
        const d = await chrome.storage.local.get(['gemini_dev_mode']);
        return !!d.gemini_dev_mode;
    }

    async function setDevMode(devOn) {
        const storage = getStorage();
        if (storage && storage.setDevMode) await storage.setDevMode(devOn);
        else await chrome.storage.local.set({ gemini_dev_mode: !!devOn });
    }

    return {
        getConversations, setConversations,
        getExportedIds, setExportedIds,
        getCurrentSlot, setCurrentSlot,
        getAccountSlots, setAccountSlots,
        getExportedRecord, getSignature,
        loadStore, getLastSync, saveConversations, saveExportedIds, clearExported, clearAll,
        getDevMode, setDevMode,
        normId
    };
}));
