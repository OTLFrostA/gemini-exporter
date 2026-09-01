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

    const Storage = (typeof StorageService !== 'undefined') ? StorageService : (typeof window !== 'undefined' && window.StorageService) || null;

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

    async function loadStore(slotOverride) {
        const slot = slotOverride || currentSlot || 'u0';
        const storage = (typeof StorageService !== 'undefined') ? StorageService : (typeof window !== 'undefined' ? window.StorageService : null);
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

    async function saveConversations(slot, list) {
        const s = slot || currentSlot;
        const storage = (typeof StorageService !== 'undefined') ? StorageService : (typeof window !== 'undefined' ? window.StorageService : null);
        if (storage) await storage.setConversations(s, list);
        else {
            const convKey = s === 'u0' ? 'gemini_conversations' : `gemini_conversations_${s}`;
            await chrome.storage.local.set({ [convKey]: list || [] });
        }
        if (s === currentSlot) setConversations(list);
    }

    async function saveExportedIds(slot, map) {
        const s = slot || currentSlot;
        const storage = (typeof StorageService !== 'undefined') ? StorageService : (typeof window !== 'undefined' ? window.StorageService : null);
        if (storage) await storage.setExportedIds(s, map);
        else {
            const expKey = s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
            await chrome.storage.local.set({ [expKey]: map || {} });
        }
        if (s === currentSlot) setExportedIds(map);
    }

    async function clearExported(slot) {
        const s = slot || currentSlot;
        const storage = (typeof StorageService !== 'undefined') ? StorageService : (typeof window !== 'undefined' ? window.StorageService : null);
        if (storage && storage.setExportedIds) await storage.setExportedIds(s, {});
        else {
            const expKey = s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
            await chrome.storage.local.remove([expKey]);
        }
        setExportedIds({});
    }

    return {
        getConversations, setConversations,
        getExportedIds, setExportedIds,
        getCurrentSlot, setCurrentSlot,
        getAccountSlots, setAccountSlots,
        getExportedRecord,
        loadStore, saveConversations, saveExportedIds, clearExported,
        normId
    };
}));
