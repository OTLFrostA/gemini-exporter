// src/ui/views/accountView.js - Account Slot Selector View
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.AccountView = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function $(id) {
        return typeof document !== 'undefined' ? document.getElementById(id) : null;
    }

    function render(accountSlots, currentSlot) {
        const sel = $('accountSlotSelect');
        if (!sel) return;
        const slots = Object.keys(accountSlots || {});
        if (slots.length <= 1 && (!slots.includes('u1') && !slots.includes('u2'))) {
            sel.style.display = 'none';
            return;
        }
        sel.style.display = 'inline-block';
        let html = '';
        const sorted = Array.from(new Set(['u0', ...slots])).sort();
        const defLabel = typeof I18n !== 'undefined' ? I18n.t('defaultAccount') : 'Default Account (u0)';
        const accLabel = typeof I18n !== 'undefined' ? I18n.t('accountSlot') : 'Account';
        for (const s of sorted) {
            const info = accountSlots[s];
            const rawName = info?.name || '';
            const isDefaultAutoName = !rawName || /^账号\s*u\d+/i.test(rawName) || /^account\s*u\d+/i.test(rawName) || /^默认账号/i.test(rawName) || /^default account/i.test(rawName);
            const label = isDefaultAutoName ? (s === 'u0' ? defLabel : `${accLabel} ${s.toUpperCase()}`) : rawName;
            const count = typeof info?.count === 'number' ? ` (${info.count})` : '';
            const selected = (s === currentSlot) ? 'selected' : '';
            html += `<option value="${s}" ${selected}>${label}${count}</option>`;
        }
        sel.innerHTML = html;
    }

    function bindChange(callback) {
        const sel = $('accountSlotSelect');
        if (!sel) return;
        sel.addEventListener('change', (e) => {
            if (callback) callback(e.target.value);
        });
    }

    return {
        render,
        bindChange
    };
}));
