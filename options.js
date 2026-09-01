// options.js - Gemini Exporter workbench UI controller
let conversations = [];
let exportedIds = {};
let currentSlot = 'u0';
let accountSlots = {};

const normId = id => String(id || '').replace(/^c_/, '');

function getExportedRecord(id) {
    if (!id || !exportedIds) return null;
    const nid = normId(id);
    return exportedIds[id] || exportedIds['c_' + nid] || exportedIds[nid] || null;
}

let __workbenchDebounceTimer = null;
let __lastRenderedSignature = '';
let __lastRenderTime = 0;
let __exportRunning = false;
let __activeExportEngine = null;
let __chatSearchFilter = '';

function $(id) {
    return document.getElementById(id);
}

const isRealTitle = (typeof globalThis.isRealTitle === 'function')
    ? globalThis.isRealTitle
    : function isRealTitle(title, id) {
        if (!title || typeof title !== 'string') return false;
        let t = title.trim();
        if (t.length < 2) return false;
        if (id) {
            let cleanId = String(id).replace(/^c_/, '').trim();
            let cleanT = t.replace(/^c_/, '').trim();
            if (cleanT === cleanId) return false;
            if (cleanT.startsWith('未命名对话(') || cleanT.startsWith('Untitled(')) return false;
        }
        if (/^(未命名对话|Untitled conversation|Untitled|Document|Gemini|New chat|新对话|Search|搜索)$/i.test(t)) return false;
        if (/^Google Account/i.test(t)) return false;
        if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
        return true;
    };

function setExportRunning(running) {
    __exportRunning = !!running;
    const btnExport = $('btnExport');
    const btnCancel = $('btnCancel');
    if (btnExport) btnExport.disabled = running;
    if (btnCancel) btnCancel.style.display = running ? '' : 'none';
    if (!running) {
        $('progWrap') && ($('progWrap').style.display = 'none');
    }
}

function debouncedLoadStore(quiet = true) {
    if (__workbenchDebounceTimer) clearTimeout(__workbenchDebounceTimer);
    __workbenchDebounceTimer = setTimeout(() => {
        __workbenchDebounceTimer = null;
        loadStore(quiet);
    }, 400);
}

function getSignature(list) {
    if (!list || !list.length) return 'empty';
    try {
        let ids = list.map(c => c.id);
        if (ids.length <= 6) return ids.join('|') + '|' + ids.length;
        return ids.slice(0, 3).join(',') + '|' + ids.slice(-3).join(',') + '|len=' + ids.length + '|s=' + ids.reduce((a, b) => a + b.charCodeAt(0), 0) % 10000;
    } catch {
        return 'err-' + (list.length || 0);
    }
}

function updateAccountSlotSelector() {
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

const Storage = (typeof StorageService !== 'undefined') ? StorageService : (window.StorageService || null);

async function loadStore(forceQuiet = false) {
    console.log('[workbench] loadStore called', 'forceQuiet', forceQuiet, 'prevLen', conversations.length, 'slot', currentSlot);
    try {
        let slot = currentSlot || 'u0';
        accountSlots = Storage ? await Storage.getAccountSlots() : ((await chrome.storage.local.get(['gemini_account_slots'])).gemini_account_slots || {});
        updateAccountSlotSelector();

        let incoming = Storage ? await Storage.getConversations(slot) : [];
        if ((!incoming || !incoming.length) && slot !== 'u0') {
            const u0Convs = Storage ? await Storage.getConversations('u0') : [];
            if (u0Convs && u0Convs.length) {
                console.log('[workbench] Slot', slot, 'is empty but u0 has', u0Convs.length, 'chats. Falling back to u0.');
                currentSlot = 'u0';
                slot = 'u0';
                incoming = u0Convs;
                if ($('accountSlotSelect')) $('accountSlotSelect').value = 'u0';
            }
        }

        let prevSelectedRaw = [];
        try {
            prevSelectedRaw = getSelected().map(x => x.id);
        } catch {
            prevSelectedRaw = [];
        }
        const hadLength = conversations.length;
        const prevSelected = hadLength === 0 ? null : new Set(prevSelectedRaw);
        exportedIds = Storage ? await Storage.getExportedIds(slot) : {};
        const syncInfo = Storage ? await Storage.getLastSync(slot) : { timestamp: null, count: 0 };
        const lastSyncVal = syncInfo.timestamp;

        const incomingSig = getSignature(incoming);
        const sameSig = (incomingSig === __lastRenderedSignature && incoming.length === conversations.length && conversations.length > 0);
        if (sameSig && Date.now() - __lastRenderTime < 500) {
            const lastSyncElFast = $('lastSync');
            if (lastSyncElFast && data[syncKey]) {
                const syncFmtFast = typeof I18n !== 'undefined'
                    ? I18n.t('lastSync', new Date(data[syncKey]).toLocaleString(), incoming.length)
                    : `Last sync: ${new Date(data[syncKey]).toLocaleString()} | Total: ${incoming.length}`;
                lastSyncElFast.textContent = syncFmtFast;
            }
            return;
        }

        conversations = incoming;
        const lastSyncEl = $('lastSync');
        if (lastSyncEl) {
            if (lastSyncVal) {
                lastSyncEl.textContent = typeof I18n !== 'undefined'
                    ? I18n.t('lastSync', new Date(lastSyncVal).toLocaleString(), conversations.length)
                    : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${conversations.length}`;
            } else {
                lastSyncEl.textContent = conversations.length ? (typeof I18n !== 'undefined' ? I18n.t('selectedStat', 0, conversations.length) : `${conversations.length} total`) : '';
            }
        }

        const dedupMap = new Map();
        (incoming || []).forEach(c => {
            if (!c || !c.id) return;
            const nid = normId(c.id);
            const t = (c.title || '').trim();
            const u = (c.url || c.href || '').toString();
            if (/^Google Account/i.test(t) || /accounts\.google\.com|SignOutOptions/i.test(u)) return;
            c.id = nid;
            if (!dedupMap.has(nid)) {
                dedupMap.set(nid, c);
            } else {
                const old = dedupMap.get(nid);
                let bestT = c.title;
                if (isRealTitle(old?.title, nid) && !isRealTitle(c.title, nid)) bestT = old.title;
                else if (!isRealTitle(old?.title, nid) && isRealTitle(c.title, nid)) bestT = c.title;
                dedupMap.set(nid, { ...old, ...c, id: nid, title: bestT });
            }
        });

        conversations = Array.from(dedupMap.values());
        conversations.sort((a, b) => {
            let tsA = a.timestamp;
            if (typeof tsA === 'string') tsA = new Date(tsA).getTime();
            let tsB = b.timestamp;
            if (typeof tsB === 'string') tsB = new Date(tsB).getTime();
            let valA = tsA || 0;
            let valB = tsB || 0;
            if (valA !== valB) return valB - valA;
            let lsA = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
            let lsB = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
            return lsB - lsA;
        });

        renderList(prevSelected);
        updateSelectedStat();
        __lastRenderedSignature = getSignature(conversations);
        __lastRenderTime = Date.now();
    } catch (e) {
        console.error('[workbench] loadStore error', e);
    }
}

function renderList(prevSelectedSet) {
    const list = $('list');
    if (!list) return;
    if (!conversations.length) {
        list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof I18n !== 'undefined' ? I18n.t('emptyList') : 'No conversations found.'}</div>`;
        return;
    }

    const q = (__chatSearchFilter || '').trim().toLowerCase();
    const filteredConvs = q ? conversations.filter(c => {
        const title = (c.title || '').toLowerCase();
        const id = String(c.id || '').toLowerCase();
        return title.includes(q) || id.includes(q);
    }) : conversations;

    if (!filteredConvs.length) {
        list.innerHTML = `<div style="color:var(--muted); padding:16px; text-align:center; font-size:12px;">${typeof I18n !== 'undefined' ? I18n.t('emptyList') : 'No matching conversations found.'}</div>`;
        return;
    }

    const bNeedsReexport = typeof I18n !== 'undefined' ? I18n.t('badgeNeedsReexport') : 'Needs re-export';
    const bExported = typeof I18n !== 'undefined' ? I18n.t('badgeExported') : 'Exported';
    const bNew = typeof I18n !== 'undefined' ? I18n.t('badgeNew') : 'New';

    list.innerHTML = filteredConvs.map(c => {
        const origIdx = conversations.indexOf(c);
        const nid = normId(c.id);
        const rec = getExportedRecord(c.id);
        const isExported = !!rec;
        let isUpdated = false;
        if (rec) {
            try {
                let cTs = c.timestamp;
                if (typeof cTs === 'string') cTs = new Date(cTs).getTime();
                let rTs = rec.exportedAt;
                if (typeof rTs === 'string') rTs = new Date(rTs).getTime();
                if (cTs && rTs && cTs > rTs + 60000) {
                    isUpdated = true;
                }
            } catch {}
        }
        const safeTitle = (c.title || '').replace(/</g, '&lt;');
        let checked = true;
        if (prevSelectedSet instanceof Set) {
            checked = prevSelectedSet.has(c.id) || prevSelectedSet.has(nid) || prevSelectedSet.has('c_' + nid);
        }
        let badge = '';
        if (isUpdated) badge = `<span class="badge" style="background:#3a2f1d;border-color:#5a4a2a;color:#f0c87a">${bNeedsReexport}</span>`;
        else if (isExported) badge = `<span class="badge" style="background:#1d3a2a;border-color:#2a5a3a;color:#8ae6b0">${bExported}</span>`;
        else badge = `<span class="badge" style="background:#181a29;border-color:#282c44;color:#a5b4fc">${bNew}</span>`;
        let rawTs = c.timestamp;
        if (typeof rawTs === 'string') rawTs = new Date(rawTs).getTime();
        const dateStr = rawTs ? new Date(rawTs).toLocaleDateString() : '-';
        return `<label class="item" data-chat-id="${nid}"><input type="checkbox" data-idx="${origIdx}" ${checked?'checked':''}><div class="title"><div>${safeTitle} ${badge}</div><div class="meta">${c.id} | <a href="${c.url||c.href||'https://gemini.google.com/app/'+c.id}" target="_blank" onclick="event.stopPropagation()">Open</a> | ${dateStr}</div></div></label>`;
    }).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateSelectedStat));
}

function updateSelectedStat() {
    const checks = [...document.querySelectorAll('#list input[type=checkbox]:checked')];
    const total = conversations.length;
    const selEl = $('selectedStat');
    if (selEl) {
        selEl.textContent = typeof I18n !== 'undefined' ? I18n.t('selectedStat', checks.length, total) : `Selected: ${checks.length} / ${total}`;
    }
}

function getSelected() {
    const checks = document.querySelectorAll('#list input[type=checkbox]:checked');
    return Array.from(checks).map(cb => conversations[parseInt(cb.dataset.idx)]).filter(Boolean);
}

// ==========================================
// 📝 日志与诊断系统
// ==========================================
const __logBuf = [];
const __levelTag = { info: 'I', warn: 'W', error: 'E' };

function log(msg, level = 'info') {
    const t = new Date().toTimeString().slice(0, 8);
    const tag = __levelTag[level] || 'I';
    __logBuf.push({ time: t, level, tag, msg });
    if (__logBuf.length > 500) __logBuf.shift();
    renderLog();
}

function clearLog() {
    __logBuf.length = 0;
    renderLog();
}

function renderLog() {
    const el = $('log');
    if (!el) return;
    const kw = ($('logFilter') ? $('logFilter').value : '').trim().toLowerCase();
    const lvl = $('logLevel') ? $('logLevel').value : 'all';

    let list = __logBuf;
    if (lvl === 'error') list = list.filter(x => x.level === 'error');
    else if (lvl === 'warn') list = list.filter(x => x.level === 'warn' || x.level === 'error');
    else if (lvl === 'info') list = list.filter(x => x.level === 'info' || x.level === 'warn');

    if (kw) {
        list = list.filter(x => {
            const full = `[${x.time}] [${x.tag}] ${x.msg}`.toLowerCase();
            return full.includes(kw);
        });
    }

    el.textContent = list.map(x => `[${x.time}] [${x.tag}] ${x.msg}`).join('\n');
    el.scrollTop = el.scrollHeight;
}

// ==========================================
// 📂 FileSystem Access API & 目录设置
// ==========================================
let __globalDirHandle = null;

async function requestDirHandle(silent = false) {
    if (!window.showDirectoryPicker) {
        throw new Error('当前浏览器不支持 FileSystem Access API 目录选择');
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    __globalDirHandle = handle;
    const dirLabel = $('dirLabel');
    if (dirLabel) dirLabel.textContent = `已选目录: ${handle.name}`;
    log(`已选择保存目录: ${handle.name}`);
    return handle;
}

// ==========================================
// 🚀 导出调度器 (调用 export_engine.js)
// ==========================================
async function exportSelected() {
    const selected = getSelected();
    if (!selected.length) {
        alert(typeof I18n !== 'undefined' ? I18n.t('noSelection') : 'Please select at least one conversation!');
        return;
    }
    const format = $('format').value;
    const skip = $('skipExported').checked;
    const includeIndex = $('includeIndex').checked;
    const includeAssets = $('includeAssets') ? $('includeAssets').checked : true;
    const includeZip = $('includeZip') ? $('includeZip').checked : true;

    setExportRunning(true);
    let dirHandle = null;

    if (!includeZip) {
        try {
            if (__globalDirHandle) {
                dirHandle = __globalDirHandle;
            } else {
                dirHandle = await requestDirHandle(true);
            }
        } catch (e) {
            log(`已切换为导出为 ZIP: ${e.message}`);
            if ($('includeZip')) $('includeZip').checked = true;
        }
    }

    const finalUseZip = $('includeZip') ? $('includeZip').checked : true;
    if (!finalUseZip && !dirHandle) {
        setExportRunning(false);
        return;
    }

    $('progWrap').style.display = 'block';
    $('bar').style.width = '0%';
    $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('progPreparing') : 'Preparing...';

    __activeExportEngine = new (ExportEngine.ExportEngine || ExportEngine)();

    try {
        const result = await __activeExportEngine.run({
            selected,
            format,
            skip,
            includeIndex,
            includeAssets,
            useZip: finalUseZip,
            dirHandle,
            currentSlot,
            conversations,
            exportedIds,
            takeoutEngine: typeof TakeoutEngine !== 'undefined' ? TakeoutEngine : null
        }, {
            onProgress: (p) => {
                if ($('bar')) $('bar').style.width = `${p.pct}%`;
                let text = `进度 ${p.current}/${p.total} (${p.pct}%)`;
                if (p.title) {
                    const shortTitle = p.title.length > 28 ? p.title.slice(0, 28) + '…' : p.title;
                    text += ` | 当前: ${shortTitle}`;
                }
                if (p.assetsTotal > 0) {
                    text += ` | 附件: ${p.assetsDownloaded}/${p.assetsTotal}`;
                }
                if ($('progText')) $('progText').textContent = text;
            },
            onLog: (m, lvl) => log(m, lvl),
            onTitleUpdated: (chatId, newTitle) => {
                const nid = normId(chatId);
                const itemEl = document.querySelector(`[data-chat-id="${nid}"]`);
                if (itemEl) {
                    const titleDiv = itemEl.querySelector('.title > div');
                    if (titleDiv) {
                        const badgeEl = titleDiv.querySelector('.badge');
                        titleDiv.innerHTML = `${newTitle.replace(/</g, '&lt;')} ${badgeEl ? badgeEl.outerHTML : ''}`;
                    }
                }
            },
            onItemExported: (chatId, record) => {
                const nid = normId(chatId);
                const itemEl = document.querySelector(`[data-chat-id="${nid}"]`);
                if (itemEl) {
                    const titleDiv = itemEl.querySelector('.title > div');
                    const bExported = typeof I18n !== 'undefined' ? I18n.t('badgeExported') : 'Exported';
                    if (titleDiv) {
                        let badgeEl = titleDiv.querySelector('.badge');
                        if (!badgeEl) {
                            badgeEl = document.createElement('span');
                            badgeEl.className = 'badge';
                            titleDiv.appendChild(badgeEl);
                        }
                        badgeEl.style.background = '#1d3a2a';
                        badgeEl.style.borderColor = '#2a5a3a';
                        badgeEl.style.color = '#8ae6b0';
                        badgeEl.textContent = bExported;
                    }
                }
            }
        });

        const finishMsg = typeof I18n !== 'undefined'
            ? I18n.t('exportFinished', result.landedChats, result.failedChats.length, selected.length)
            : `Export completed! Landed: ${result.landedChats}, Failed: ${result.failedChats.length}`;
        log(finishMsg, result.failedChats.length ? 'warn' : 'info');
        alert(finishMsg);
    } catch (err) {
        log(`导出过程异常中断: ${err.message}`, 'error');
        alert(`导出失败: ${err.message}`);
    } finally {
        setExportRunning(false);
        __activeExportEngine = null;
        loadStore(true);
    }
}

// ==========================================
// 📥 Takeout 导入调度 (调用 takeout_engine.js)
// ==========================================
async function parseTakeoutZip(file) {
    if (typeof TakeoutEngine === 'undefined') {
        alert('TakeoutEngine 模块未加载');
        return;
    }
    $('progWrap').style.display = 'block';
    $('bar').style.width = '15%';

    try {
        const res = await TakeoutEngine.parseTakeoutZip(file, (pct, txt) => {
            $('bar').style.width = `${pct}%`;
            $('progText').textContent = txt;
            log(txt, 'info');
        });

        let existingMap = new Map();
        for (const c of conversations) {
            existingMap.set(normId(c.id).toLowerCase(), c);
        }

        let addedCount = 0;
        for (const tc of res.conversations) {
            const nid = normId(tc.id).toLowerCase();
            if (!existingMap.has(nid)) {
                conversations.push(tc);
                existingMap.set(nid, tc);
                addedCount++;
            }
        }

        if (addedCount > 0) {
            const slot = currentSlot || 'u0';
            if (Storage) {
                await Storage.setConversations(slot, conversations);
            } else {
                const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
                await chrome.storage.local.set({ [convKey]: conversations });
            }
        }

        const successMsg = `Takeout 解析成功！发现 ${res.conversations.length} 条对话，已补全 ${addedCount} 条缺失历史，索引 ${res.totalMediaCount} 个离线资源`;
        log(successMsg, 'info');
        alert(successMsg);
        loadStore();
    } catch (err) {
        log(`Takeout 导入失败: ${err.message}`, 'error');
        alert(`Takeout 导入失败: ${err.message}`);
    } finally {
        $('progWrap').style.display = 'none';
    }
}

// ==========================================
// 💾 备份与恢复
// ==========================================
async function exportFullBackup() {
    try {
        const allData = await chrome.storage.local.get(null);
        const jsonStr = JSON.stringify({
            exportedAt: new Date().toISOString(),
            version: '1.3.0',
            data: allData
        }, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini_exporter_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
        alert(`备份失败: ${e.message}`);
    }
}

async function restoreFullBackup(file) {
    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const targetData = payload.data || payload;

        if (!targetData || (!targetData.gemini_conversations && !targetData.gemini_conversations_u0 && !targetData.exportedIds)) {
            alert('无效的备份文件格式！');
            return;
        }

        const confirmMsg = typeof I18n !== 'undefined'
            ? I18n.t('restoreConfirm')
            : 'Restoring backup will replace current conversations and export markers. Continue?';
        if (!confirm(confirmMsg)) return;

        const activeCreds = await chrome.storage.local.get(['gemini_credentials_map', 'gemini_credentials', 'gemini_exporter_lang']);
        await chrome.storage.local.clear();
        await chrome.storage.local.set({
            ...activeCreds,
            ...targetData
        });

        const restoredCount = (targetData.gemini_conversations || targetData.gemini_conversations_u0 || []).length;
        alert(`恢复成功！共导入 ${restoredCount} 条会话。`);
        location.reload();
    } catch (err) {
        alert(`恢复失败: ${err.message}`);
    }
}

function exportListJson() {
    const sel = getSelected();
    if (!sel.length) {
        alert(typeof I18n !== 'undefined' ? I18n.t('noSelection') : 'Please select at least one conversation!');
        return;
    }
    const content = JSON.stringify(sel, null, 2);
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gemini_list_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function exportDiagnostics() {
    try {
        const d = await chrome.storage.local.get(['gemini_last_sync_diagnostics']);
        const diag = d.gemini_last_sync_diagnostics;
        if (!diag) {
            alert(typeof I18n !== 'undefined' ? I18n.t('noDiagData') : 'No diagnostic data yet.');
            return;
        }
        const jsonStr = JSON.stringify(diag, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini_diagnostics_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 3000);
    } catch (e) {
        alert('导出诊断失败: ' + e.message);
    }
}

// ==========================================
// 🎯 DOM 初始化与事件绑定
// ==========================================
async function initWorkbench() {
    console.log('[workbench] Initializing...');

    // 1. App Version & Header
    const verEl = $('ver');
    if (verEl) {
        try {
            verEl.textContent = 'v' + (chrome.runtime.getManifest()?.version || '1.3.0');
        } catch {}
    }

    // 2. Language Init
    if (typeof I18n !== 'undefined') {
        try {
            await I18n.initLanguage();
            I18n.applyI18n();
        } catch (e) {
            console.warn('[workbench] i18n init error', e);
        }
    }

    // 3. Dev Mode Init
    try {
        let devOn = false;
        if (Storage) devOn = await Storage.getDevMode();
        else {
            const d = await chrome.storage.local.get(['gemini_dev_mode']);
            devOn = !!d.gemini_dev_mode;
        }
        if ($('devToggle')) $('devToggle').checked = devOn;
        document.body.classList.toggle('dev-mode', devOn);
        const labelDev = $('labelDevMode');
        if (labelDev) {
            labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
        }
    } catch (e) {}

    // 4. Export Settings Init
    const zipCheck = $('includeZip');
    const updateZipUi = () => {
        if (!zipCheck) return;
        const isZip = zipCheck.checked;
        const btnExport = $('btnExport');
        if (btnExport) {
            btnExport.textContent = isZip 
                ? (typeof I18n !== 'undefined' ? I18n.t('btnExportZip') : '导出选中 → ZIP')
                : (typeof I18n !== 'undefined' ? I18n.t('btnExportFolder') : '导出选中 → 文件夹');
        }
        const dirBox = $('dirBox');
        const btnSetDir = $('btnSetDir');
        if (dirBox) {
            dirBox.style.opacity = isZip ? '0.28' : '1';
            dirBox.style.pointerEvents = isZip ? 'none' : 'auto';
            dirBox.style.filter = isZip ? 'grayscale(0.8)' : 'none';
        }
        if (btnSetDir) {
            btnSetDir.disabled = isZip;
        }
    };

    chrome.storage.local.get(['gemini_export_format', 'gemini_export_zip'], data => {
        if (data.gemini_export_format && $('format')) {
            $('format').value = data.gemini_export_format;
        }
        if (typeof data.gemini_export_zip !== 'undefined' && zipCheck) {
            zipCheck.checked = data.gemini_export_zip;
            updateZipUi();
        }
    });

    $('format')?.addEventListener('change', e => {
        chrome.storage.local.set({ gemini_export_format: e.target.value });
    });

    if (zipCheck) {
        zipCheck.addEventListener('change', () => {
            updateZipUi();
            chrome.storage.local.set({ gemini_export_zip: zipCheck.checked });
        });
        updateZipUi();
    }

    // 5. Language Switch Handlers
    const handleLangChange = async (targetLang) => {
        if (typeof I18n !== 'undefined') {
            await I18n.setLang(targetLang);
            updateAccountSlotSelector();
            renderList();
            updateSelectedStat();
            updateZipUi();
        }
    };

    $('langToggle')?.addEventListener('change', (e) => {
        handleLangChange(e.target.checked ? 'en' : 'zh');
    });

    $('labelLangZh')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ($('langToggle')) $('langToggle').checked = false;
        handleLangChange('zh');
    });

    $('labelLangEn')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if ($('langToggle')) $('langToggle').checked = true;
        handleLangChange('en');
    });

    // 6. Dev Mode Switch Handlers
    const handleDevChange = async (devOn) => {
        document.body.classList.toggle('dev-mode', devOn);
        const labelDev = $('labelDevMode');
        if (labelDev) {
            labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
        }
        if (Storage) await Storage.setDevMode(devOn);
        else await chrome.storage.local.set({ gemini_dev_mode: devOn });
    };

    $('devToggle')?.addEventListener('change', (e) => {
        handleDevChange(e.target.checked);
    });

    $('labelDevMode')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = $('devToggle')?.checked || false;
        if ($('devToggle')) $('devToggle').checked = !cur;
        handleDevChange(!cur);
    });

    // 7. Account Slot Selector
    $('accountSlotSelect')?.addEventListener('change', async (e) => {
        currentSlot = e.target.value || 'u0';
        conversations = [];
        __lastRenderedSignature = '';
        renderList();
        await loadStore();
    });

    // 8. Search & Selection
    $('chatSearchInput')?.addEventListener('input', (e) => {
        __chatSearchFilter = e.target.value;
        const prevSel = new Set(getSelected().map(x => x.id));
        renderList(prevSel);
        updateSelectedStat();
    });

    $('btnSelectAll')?.addEventListener('click', () => {
        document.querySelectorAll('#list input[type=checkbox]').forEach(c => c.checked = true);
        updateSelectedStat();
    });

    $('btnSelectNone')?.addEventListener('click', () => {
        document.querySelectorAll('#list input[type=checkbox]').forEach(c => c.checked = false);
        updateSelectedStat();
    });

    $('btnSelectUnexported')?.addEventListener('click', () => {
        document.querySelectorAll('#list input[type=checkbox]').forEach(cb => {
            const c = conversations[parseInt(cb.dataset.idx)];
            if (!c) return;
            const rec = getExportedRecord(c.id);
            cb.checked = !rec;
        });
        updateSelectedStat();
    });

    $('btnSelectUpdated')?.addEventListener('click', () => {
        document.querySelectorAll('#list input[type=checkbox]').forEach(cb => {
            const c = conversations[parseInt(cb.dataset.idx)];
            if (!c) return;
            const rec = getExportedRecord(c.id);
            let isUpdated = false;
            if (rec) {
                let cTs = typeof c.timestamp === 'string' ? new Date(c.timestamp).getTime() : c.timestamp;
                let rTs = typeof rec.exportedAt === 'string' ? new Date(rec.exportedAt).getTime() : rec.exportedAt;
                if (cTs && rTs && cTs > rTs + 60000) isUpdated = true;
            }
            cb.checked = isUpdated;
        });
        updateSelectedStat();
    });

    // 9. Export & Folder Actions
    $('btnExport')?.addEventListener('click', exportSelected);
    $('btnExportJson')?.addEventListener('click', exportListJson);
    $('btnCancel')?.addEventListener('click', () => {
        if (__activeExportEngine) __activeExportEngine.abort();
    });

    $('btnSetDir')?.addEventListener('click', async () => {
        try {
            await requestDirHandle();
        } catch (e) {
            log(`设置目录失败: ${e.message}`, 'warn');
        }
    });

    // 10. Takeout
    $('btnImportTakeout')?.addEventListener('click', () => $('takeoutFileInput')?.click());
    $('takeoutFileInput')?.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) parseTakeoutZip(f);
    });

    // 11. Sync Actions
    $('btnIncrementalScan')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'deepScan', mode: 'incremental', accountSlot: currentSlot }, (res) => {
            if (res && res.success) {
                log(`增量同步完成，新增 ${res.added || 0} 条`);
                loadStore();
            } else {
                log(`同步失败: ${res ? res.error : '未知错误'}`, 'error');
            }
        });
    });

    $('btnDeepScan')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'deepScan', mode: 'full', accountSlot: currentSlot }, (res) => {
            if (res && res.success) {
                log(`全量拉取完成，共 ${res.total || 0} 条`);
                loadStore();
            } else {
                log(`全量拉取失败: ${res ? res.error : '未知错误'}`, 'error');
            }
        });
    });

    $('btnStopScan')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopDeepScan', accountSlot: currentSlot });
    });

    // 12. Backup & Restore
    $('btnBackupData')?.addEventListener('click', exportFullBackup);
    $('btnRestoreData')?.addEventListener('click', () => $('restoreFileInput')?.click());
    $('restoreFileInput')?.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) restoreFullBackup(f);
    });

    // 13. Clear Cache
    $('btnClearAll')?.addEventListener('click', async () => {
        const confirmMsg = typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : '确定清空本地所有会话数据？';
        if (!confirm(confirmMsg)) return;
        const slot = currentSlot || 'u0';
        if (Storage) {
            await Storage.setConversations(slot, []);
        } else {
            const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
            await chrome.storage.local.remove([convKey]);
        }
        conversations = [];
        renderList();
        updateSelectedStat();
        log('本地会话数据已清空');
    });

    // 14. Logs & Diagnostics
    $('logFilter')?.addEventListener('input', renderLog);
    $('logLevel')?.addEventListener('change', renderLog);
    $('btnClearLog')?.addEventListener('click', clearLog);
    $('btnCopyLog')?.addEventListener('click', async () => {
        const l = $('log');
        if (l) {
            await navigator.clipboard.writeText(l.textContent);
            $('btnCopyLog').textContent = typeof I18n !== 'undefined' ? I18n.t('copied') : '已复制!';
            setTimeout(() => $('btnCopyLog').textContent = typeof I18n !== 'undefined' ? I18n.t('btnCopyLog') : '复制', 1500);
        }
    });

    $('btnExportDiag')?.addEventListener('click', exportDiagnostics);

    // 15. Initial Data Load
    await loadStore();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkbench);
} else {
    initWorkbench();
}
