// src/ui/views/listView.js - List rendering, no storage
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ListView = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';
    function $(id){ return document.getElementById(id); }

    const isRealTitle = (typeof globalThis.GeminiUtils !== 'undefined' && typeof globalThis.GeminiUtils.isRealTitle === 'function')
        ? globalThis.GeminiUtils.isRealTitle
        : (typeof globalThis.isRealTitle === 'function' ? globalThis.isRealTitle : (title,id)=>{
            if (!title || typeof title !== 'string') return false;
            let t = title.trim(); if (t.length<2) return false;
            if (id) { let cid=String(id).replace(/^c_/,'').trim(); let ct=t.replace(/^c_/,'').trim(); if(ct===cid) return false; }
            if (/^(未命名对话|Untitled)/i.test(t)) return false;
            if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
            return true;
        });

    const cleanTitle = (t) => {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle) return GeminiUtils.cleanTitle(t);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.cleanTitle) return globalThis.GeminiUtils.cleanTitle(t);
        } catch {}
        if (!t || typeof t !== 'string') return '';
        let s = t.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
        s = s.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
        s = s.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
        return s.trim();
    };

    const resolveTitle = (typeof GeminiUtils !== 'undefined' && GeminiUtils.resolveTitle)
        ? GeminiUtils.resolveTitle
        : ((typeof globalThis.GeminiUtils !== 'undefined' && globalThis.GeminiUtils.resolveTitle)
            ? globalThis.GeminiUtils.resolveTitle
            : (chat) => ({ title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' }));

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    let onDeleteCallback = null;
    function setOnDelete(cb) {
        onDeleteCallback = cb;
    }

    let currentConversationsRef = [];
    let currentOnDeleteChatRef = null;

    function ensureListDelegation(list) {
        if (!list || list._delegated) return;
        list._delegated = true;

        list.addEventListener('click', (e) => {
            if (e.target.closest('a.open-link')) {
                e.stopPropagation();
                return;
            }
            const btn = e.target.closest('.btn-remove-chat');
            if (btn) {
                e.preventDefault();
                e.stopPropagation();
                const chatId = btn.dataset.removeId || btn.dataset.chatId || btn.closest('[data-chat-id]')?.dataset?.chatId;
                if (chatId) {
                    const cb = currentOnDeleteChatRef || onDeleteCallback;
                    if (typeof cb === 'function') cb(chatId);
                }
            }
        });

        list.addEventListener('change', (e) => {
            if (e.target.matches('input[type=checkbox]')) {
                updateStat(currentConversationsRef);
            }
        });
    }

    function render(conversations, exportedIds, prevSelectedSet, searchFilter, onDeleteChat) {
        const list = $('list');
        if (!list) return;
        currentConversationsRef = conversations || [];
        currentOnDeleteChatRef = onDeleteChat || onDeleteCallback;
        ensureListDelegation(list);

        if (!conversations || !conversations.length) {
            list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof I18n!=='undefined'?I18n.t('emptyList'):'No conversations found.'}</div>`;
            return;
        }
        const q = (searchFilter||'').trim().toLowerCase();
        const filtered = q ? conversations.filter(c=> (resolveTitle(c).title||'').toLowerCase().includes(q) || String(c.id||'').toLowerCase().includes(q)) : conversations;
        if (!filtered.length) {
            list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof I18n!=='undefined'?I18n.t('emptyList'):'No matching conversations found.'}</div>`;
            return;
        }
        const bNeedsReexport = typeof I18n!=='undefined'?I18n.t('badgeNeedsReexport'):'Needs re-export';
        const bExported = typeof I18n!=='undefined'?I18n.t('badgeExported'):'Exported';
        const bNew = typeof I18n!=='undefined'?I18n.t('badgeNew'):'New';

        function getRec(id){
            if (!exportedIds) return null;
            const nid = String(id||'').replace(/^c_/,'');
            return exportedIds[id] || exportedIds['c_'+nid] || exportedIds[nid] || null;
        }

        // Precompute index map in O(N) to eliminate O(N^2) conversations.indexOf(c) inside map
        const convIndexMap = new Map();
        for (let i = 0; i < conversations.length; i++) {
            convIndexMap.set(conversations[i], i);
        }

        list.innerHTML = filtered.map(c=>{
            const origIdx = convIndexMap.has(c) ? convIndexMap.get(c) : conversations.indexOf(c);
            const nid = String(c.id||'').replace(/^c_/,'');
            const rec = getRec(c.id);
            const isExported = !!rec;
            let isUpdated=false;
            if(rec){
                try{
                    let cTs=typeof c.timestamp==='string'?new Date(c.timestamp).getTime():c.timestamp;
                    let rTs=typeof rec.exportedAt==='string'?new Date(rec.exportedAt).getTime():rec.exportedAt;
                    if(cTs&&rTs&&cTs>rTs+60000) isUpdated=true;
                }catch{}
            }
            const safeTitle = escapeHtml(resolveTitle(c).title || c.id || '');
            let checked=true;
            if(prevSelectedSet instanceof Set) checked = prevSelectedSet.has(c.id)||prevSelectedSet.has(nid)||prevSelectedSet.has('c_'+nid);
            let badge='';
            if(isUpdated) badge=`<span class="badge" style="background:#3a2f1d;border-color:#5a4a2a;color:#f0c87a">${bNeedsReexport}</span>`;
            else if(isExported) badge=`<span class="badge" style="background:#1d3a2a;border-color:#2a5a3a;color:#8ae6b0">${bExported}</span>`;
            else badge=`<span class="badge" style="background:#181a29;border-color:#282c44;color:#a5b4fc">${bNew}</span>`;
            let rawTs=c.timestamp; if(typeof rawTs==='string') rawTs=new Date(rawTs).getTime();
            const dateStr=rawTs?new Date(rawTs).toLocaleDateString():'-';
            const openTxt = typeof I18n !== 'undefined' ? I18n.t('openLink') : 'Open';
            const removeTip = typeof I18n !== 'undefined' ? I18n.t('removeChatTip') : 'Remove this conversation from local list';
            return `<label class="item" data-chat-id="${nid}" style="display:flex; align-items:center; gap:8px;"><input type="checkbox" data-idx="${origIdx}" ${checked?'checked':''}><div class="title" style="flex:1; min-width:0;"><div>${safeTitle} ${badge}</div><div class="meta">${c.id} | <a href="${c.url||c.href||'https://gemini.google.com/app/'+c.id}" target="_blank" class="open-link">${openTxt}</a> | ${dateStr}</div></div><button type="button" class="btn-remove-chat" data-remove-id="${nid}" title="${removeTip}" style="background:transparent; border:none; color:var(--muted); cursor:pointer; padding:4px 6px; font-size:13px; border-radius:4px; opacity:0.4; transition:all 0.15s; flex:none;">🗑️</button></label>`;
        }).join('');
    }

    function updateItemExportStatus(chatId, record) {
        if (typeof document === 'undefined') return;
        const nid = String(chatId || '').replace(/^c_/, '');
        const item = document.querySelector(`#list .item[data-chat-id="${nid}"]`);
        if (!item) return;
        const bExported = typeof I18n !== 'undefined' ? I18n.t('badgeExported') : 'Exported';
        const badgeEl = item.querySelector('.badge');
        if (badgeEl) {
            badgeEl.textContent = bExported;
            badgeEl.style.background = '#1d3a2a';
            badgeEl.style.borderColor = '#2a5a3a';
            badgeEl.style.color = '#8ae6b0';
        }
    }

    function updateStat(conversations) {
        if (typeof document === 'undefined') return;
        const checks = [...document.querySelectorAll('#list input[type=checkbox]:checked')];
        const total = (conversations || []).length;
        const selEl = $('selectedStat');
        if (selEl) selEl.textContent = typeof I18n !== 'undefined' ? I18n.t('selectedStat', checks.length, total) : `Selected: ${checks.length} / ${total}`;
    }

    function getSelected(conversations) {
        if (typeof document === 'undefined') return [];
        const checks = document.querySelectorAll('#list input[type=checkbox]:checked');
        return Array.from(checks).map(cb => {
            const idx = parseInt(cb.dataset.idx);
            if (!isNaN(idx) && conversations && conversations[idx]) return conversations[idx];
            const item = cb.closest('.item');
            const chatId = item?.dataset?.chatId;
            if (chatId) return { id: chatId };
            return null;
        }).filter(Boolean);
    }

    function getSelectedIds() {
        if (typeof document === 'undefined') return new Set();
        const ids = new Set();
        document.querySelectorAll('#list input[type=checkbox]:checked').forEach(cb => {
            const item = cb.closest('.item');
            const chatId = item?.dataset?.chatId;
            if (chatId) ids.add(chatId);
        });
        return ids;
    }

    function selectAll(conversations) {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('#list input[type=checkbox]').forEach(cb => { cb.checked = true; });
        updateStat(conversations);
    }

    function deselectAll(conversations) {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('#list input[type=checkbox]').forEach(cb => { cb.checked = false; });
        updateStat(conversations);
    }

    function selectUnexported(conversations, exportedIds) {
        if (typeof document === 'undefined') return;
        const convList = conversations || [];
        const expMap = exportedIds || {};
        document.querySelectorAll('#list input[type=checkbox]').forEach(cb => {
            const idx = parseInt(cb.dataset.idx);
            const c = convList[idx];
            if (!c) { cb.checked = false; return; }
            const nid = String(c.id || '').replace(/^c_/, '');
            const rec = expMap[c.id] || expMap['c_' + nid] || expMap[nid] || null;
            cb.checked = !rec;
        });
        updateStat(conversations);
    }

    function selectNeedsUpdate(conversations, exportedIds) {
        if (typeof document === 'undefined') return;
        const convList = conversations || [];
        const expMap = exportedIds || {};
        document.querySelectorAll('#list input[type=checkbox]').forEach(cb => {
            const idx = parseInt(cb.dataset.idx);
            const c = convList[idx];
            if (!c) { cb.checked = false; return; }
            const nid = String(c.id || '').replace(/^c_/, '');
            const rec = expMap[c.id] || expMap['c_' + nid] || expMap[nid] || null;
            let needsUpdate = false;
            if (rec) {
                try {
                    let cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                    let rTs = typeof rec.exportedAt === 'string' ? new Date(rec.exportedAt).getTime() : rec.exportedAt;
                    if (cTs && rTs && cTs > rTs + 60000) needsUpdate = true;
                } catch {}
            }
            cb.checked = needsUpdate;
        });
        updateStat(conversations);
    }

    return { render, updateStat, getSelected, getSelectedIds, selectAll, deselectAll, selectUnexported, selectNeedsUpdate, isRealTitle, setOnDelete, updateItemExportStatus };
}));
