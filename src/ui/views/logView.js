// src/ui/views/logView.js - Log rendering, no business logic
(function(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.LogView = factory();
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';
    const buf = [];
    const levelTag = { info: 'I', warn: 'W', error: 'E' };
    let _renderEl = null;

    function init(elId) {
        _renderEl = document.getElementById(elId || 'log');
    }

    function log(msg, level = 'info') {
        const t = new Date().toTimeString().slice(0, 8);
        const tag = levelTag[level] || 'I';
        buf.push({ time: t, level, tag, msg });
        if (buf.length > 500) buf.shift();
        render();
    }

    function clear() { buf.length = 0; render(); }

    function render() {
        const el = _renderEl || document.getElementById('log');
        if (!el) return;
        const kw = (document.getElementById('logFilter') ? document.getElementById('logFilter').value : '').trim().toLowerCase();
        const lvl = document.getElementById('logLevel') ? document.getElementById('logLevel').value : 'all';
        let list = buf;
        if (lvl === 'error') list = list.filter(x => x.level === 'error');
        else if (lvl === 'warn') list = list.filter(x => x.level === 'warn' || x.level === 'error');
        else if (lvl === 'info') list = list.filter(x => x.level === 'info' || x.level === 'warn');
        if (kw) list = list.filter(x => (`[${x.time}] [${x.tag}] ${x.msg}`).toLowerCase().includes(kw));
        el.textContent = list.map(x => `[${x.time}] [${x.tag}] ${x.msg}`).join('\n');
        el.scrollTop = el.scrollHeight;
    }

    function getBuffer() { return buf.slice(); }

    return { init, log, clear, render, getBuffer };
}));
