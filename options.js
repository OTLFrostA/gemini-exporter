// options.js - Gemini Exporter workbench controller
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
let __exportAborted = false;
let __exportRunning = false;
let __globalTotalAssets = 0;
let __globalDownloadedAssets = 0;

function $(id) {
    return document.getElementById(id);
}

const isRealTitle = (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle)
    ? GeminiUtils.isRealTitle
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

function mdContent(chat) {
    const format = $('format') ? $('format').value : 'markdown';
    if (typeof ChatFormatter !== 'undefined') {
        return ChatFormatter.formatContent(chat, format);
    }
    return {
        content: toMarkdown(chat),
        ext: format.startsWith('json') ? 'json' : 'md'
    };
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
        // use first 3 + last 3 + length for fast check
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

async function findTabForSlot(slot) {
    try {
        const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
        if (!tabs || !tabs.length) return null;
        if (slot && slot !== 'u0') {
            const slotNum = slot.replace('u', '');
            const match = tabs.find(t => t.url && t.url.includes(`/u/${slotNum}/`));
            if (match) return match;
        } else {
            const defMatch = tabs.find(t => t.url && (!t.url.match(/\/u\/\d+\//) || t.url.includes('/u/0/')));
            if (defMatch) return defMatch;
        }
        return tabs.find(t => t.active) || tabs[0];
    } catch {
        return null;
    }
}
const getGeminiTab = findTabForSlot;

async function loadStore(forceQuiet = false) {
    console.log('[workbench] loadStore called', 'forceQuiet', forceQuiet, 'prevLen', conversations.length, 'slot', currentSlot);
    try {
        let slot = currentSlot || 'u0';
        let convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
        let syncKey = slot === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${slot}`;
        let expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
        let countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;

        const data = await chrome.storage.local.get([
            convKey,
            syncKey,
            expKey,
            countKey,
            'gemini_account_slots',
            'gemini_credentials_map'
        ]);

        accountSlots = data.gemini_account_slots || {};
        updateAccountSlotSelector();

        let incoming = data[convKey] || [];
        if ((!incoming || !incoming.length) && slot !== 'u0') {
            const u0Data = await chrome.storage.local.get(['gemini_conversations', 'exportedIds', 'gemini_last_sync', 'gemini_last_count']);
            if (u0Data.gemini_conversations && u0Data.gemini_conversations.length) {
                console.log('[workbench] Slot', slot, 'is empty but u0 has', u0Data.gemini_conversations.length, 'chats. Falling back to u0.');
                currentSlot = 'u0';
                slot = 'u0';
                convKey = 'gemini_conversations';
                expKey = 'exportedIds';
                syncKey = 'gemini_last_sync';
                countKey = 'gemini_last_count';
                incoming = u0Data.gemini_conversations;
                data.exportedIds = u0Data.exportedIds;
                data.gemini_last_sync = u0Data.gemini_last_sync;
                data.gemini_last_count = u0Data.gemini_last_count;
                if ($('accountSlotSelect')) $('accountSlotSelect').value = 'u0';
            }
        }

        console.log('[workbench] loadStore raw', {
            slot,
            count: incoming?.length,
            last_count: data[countKey],
            has_sync: !!data[syncKey],
            exportedLen: Object.keys(data[expKey] || {}).length
        });
        let prevSelectedRaw = [];
        try {
            prevSelectedRaw = getSelected().map(x => x.id);
        } catch {
            prevSelectedRaw = [];
        }
        const hadLength = conversations.length;
        const prevSelected = hadLength === 0 ? null : new Set(prevSelectedRaw);
        exportedIds = data[expKey] || {};
        __lastSyncRaw = data[syncKey];
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
        const same = (hadLength === conversations.length);
        const lastSyncEl = $('lastSync');
        if (lastSyncEl) {
            if (data[syncKey]) {
                lastSyncEl.textContent = typeof I18n !== 'undefined'
                    ? I18n.t('lastSync', new Date(data[syncKey]).toLocaleString(), conversations.length)
                    : `Last sync: ${new Date(data[syncKey]).toLocaleString()} | Total: ${conversations.length}`;
            } else {
                lastSyncEl.textContent = conversations.length ? (typeof I18n !== 'undefined' ? I18n.t('selectedStat', 0, conversations.length) : `${conversations.length} total`) : '';
            }
        }
        const _badIds = [];
        const dedupMap = new Map();
        (incoming || []).forEach(c => {
            if (!c || !c.id) return;
            const normId = String(c.id).replace(/^c_/, '').trim();
            const t = (c.title || '').trim();
            const u = (c.url || c.href || '').toString();
            if (/^Google Account/i.test(t) || /accounts\.google\.com|SignOutOptions/i.test(u)) {
                _badIds.push(c.id);
                return;
            }
            c.id = normId;
            if (!dedupMap.has(normId)) {
                dedupMap.set(normId, c);
            } else {
                const old = dedupMap.get(normId);
                let bestT = c.title;
                if (isRealTitle(old?.title, normId) && !isRealTitle(c.title, normId)) {
                    bestT = old.title;
                } else if (!isRealTitle(old?.title, normId) && isRealTitle(c.title, normId)) {
                    bestT = c.title;
                }
                dedupMap.set(normId, { ...old, ...c, id: normId, title: bestT });
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
        if (_badIds.length || conversations.length !== incoming.length) {
            await chrome.storage.local.set({
                [convKey]: conversations,
                [countKey]: conversations.length,
                [syncKey]: new Date().toISOString()
            });
        }
        const syncCountEl = $('syncCount');
        if (syncCountEl) {
            syncCountEl.textContent = typeof I18n !== 'undefined' ? I18n.t('syncedBadge', conversations.length) : `${conversations.length} synced`;
        }
        renderList(prevSelected);
        __lastRenderedSignature = incomingSig;
        __lastRenderTime = Date.now();
        updateSelectedStat();
        if (!forceQuiet && !same) {
            const expCount = conversations.filter(c => !!getExportedRecord(c.id)).length;
            log(`已加载 ${conversations.length} 条对话 (已导出 ${expCount} 条)`);
        }
        if (conversations.length === 0) {
            try {
                const tab = await findTabForSlot(slot);
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, { action: 'resync' }, (res) => {
                        if (!chrome.runtime.lastError && res?.ok) {
                            setTimeout(() => loadStore(true), 500);
                        }
                    });
                }
            } catch {}
        }
    } catch (e) {
        log('数据加载异常: ' + e.message);
    }
}

let __chatSearchFilter = '';

function renderList(prevSelectedSet) {
    const list = $('list');
    if (!list) {
        console.warn('[workbench] no #list');
        return;
    }
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

const __logBuf = [];
const __levelTag = {
    info: 'I',
    warn: 'W',
    error: 'E'
};

function __detectLevel(msg) {
    if (/fail|error|失败|异常|错误|报错/i.test(msg || '')) return 'error';
    if (/⚠️|🛑|警告|warn/i.test(msg || '')) return 'warn';
    return 'info';
}

let __logPersistTimer = null;
function log(msg, level) {
    level = level || __detectLevel(msg);
    const time = new Date().toLocaleTimeString();
    __logBuf.unshift({
        level,
        time,
        text: String(msg)
    });
    if (__logBuf.length > 300) __logBuf.length = 300;
    renderLog();
    const l = $('log');
    if (!l) console.log(`[workbench log ${level}]`, msg);

    clearTimeout(__logPersistTimer);
    __logPersistTimer = setTimeout(() => {
        chrome.storage.local.set({
            gemini_recent_logs: __logBuf.slice(0, 150)
        }).catch(() => {});
    }, 800);
}

function renderLog() {
    const l = $('log');
    if (!l) return;
    const lv = $('logLevel')?.value || 'all';
    const q = ($('logFilter')?.value || '').trim().toLowerCase();
    let lines = __logBuf;
    if (lv === 'error') {
        lines = lines.filter(x => x.level === 'error');
    } else if (lv === 'warn') {
        lines = lines.filter(x => x.level === 'warn' || x.level === 'error');
    } else if (lv === 'info') {
        lines = lines.filter(x => x.level === 'info');
    }
    if (q) {
        const terms = q.split(/\s+/).filter(Boolean);
        lines = lines.filter(x => {
            const low = x.text.toLowerCase();
            for (const t of terms) {
                if (t.startsWith('-')) {
                    if (low.includes(t.slice(1))) return false;
                } else if (!low.includes(t)) return false;
            }
            return true;
        });
    }
    l.textContent = lines.length ? lines.map(x => `[${x.time}] [${__levelTag[x.level]}] ${x.text}`).join('\n') : (lv !== 'all' || q ? '（无匹配行）' : '（日志为空）');
}

function clearLog() {
    __logBuf.length = 0;
    renderLog();
    chrome.storage.local.remove(['gemini_recent_logs']).catch(() => {});
}

function getSelected() {
    try {
        const checks = [...document.querySelectorAll('#list input[type=checkbox]')];
        return checks.filter(c => c.checked).map(c => {
            try {
                return conversations[parseInt(c.dataset.idx)];
            } catch {
                return null;
            }
        }).filter(Boolean);
    } catch {
        return [];
    }
}


const idb = {
    db: null,
    async getDb() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('RobustStorage', 1);
            req.onupgradeneeded = e => e.target.result.createObjectStore('handles');
            req.onsuccess = e => {
                this.db = e.target.result;
                resolve(this.db);
            };
            req.onerror = () => reject(req.error);
        });
    },
    async get(key) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const req = db.transaction('handles', 'readonly').objectStore('handles').get(key);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            return null;
        }
    },
    async set(key, val) {
        try {
            const db = await this.getDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').put(val, key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {}
    }
};

let __globalDirHandle = null;

async function verifyPermission(fileHandle, readWrite) {
  const options = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }
  if ((await fileHandle.queryPermission(options)) === 'granted') {
    return true;
  }
  if ((await fileHandle.requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
}

async function requestDirHandle(saveToIdb = true) {
    if (!window.showDirectoryPicker) throw new Error(typeof I18n !== 'undefined' ? I18n.t('browserNoDirPicker') : 'Directory picker not supported');
    const handle = await window.showDirectoryPicker({
        id: 'gemini_export_dir',
        mode: 'readwrite'
    });
    __globalDirHandle = handle;
    if (saveToIdb && idb) {
        await idb.set('export_dir', handle);
    }
    updateDirLabel();
    return handle;
}

function updateDirLabel() {
    const label = $('dirLabel');
    if (label) {
        if (__globalDirHandle && __globalDirHandle.name) {
            label.textContent = typeof I18n !== 'undefined'
                ? I18n.t('dirCurrent', __globalDirHandle.name)
                : `Current folder: ${__globalDirHandle.name}`;
        } else {
            label.textContent = typeof I18n !== 'undefined' ? I18n.t('dirNotSet') : 'Directory not set';
        }
    }
}

function sanitizeFileName(name, fallback = 'untitled') {
    if (!name) return fallback;
    let s = String(name).replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '_');
    s = s.replace(/[<>:"/\\|?*]+/g, '_');
    s = s.replace(/^\.+|\.+$/g, '');
    s = s.trim();
    if (!s) return fallback;
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = s + '_chat';
    if (s.length > 80) s = s.slice(0, 80).trim();
    return s;
}

function toIso(v) {
    if (!v) return null;
    let ms = typeof v === 'number' ? v : new Date(v).getTime();
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

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

    __exportAborted = false;
    setExportRunning(true);

    let dirHandle = null;
    if (!includeZip) {
        try {
            if (__globalDirHandle) {
                const granted = await verifyPermission(__globalDirHandle, true);
                if (granted) {
                    dirHandle = __globalDirHandle;
                }
            }
            if (!dirHandle) {
                log('请选择要保存的文件夹…');
                dirHandle = await requestDirHandle(true);
            }
            log(`已选文件夹：${dirHandle.name}`);
            if (__exportAborted) {
                setExportRunning(false);
                $('btnExport').disabled = false;
                return;
            }
        } catch (e) {
            if (__exportAborted) {
                setExportRunning(false);
                $('btnExport').disabled = false;
                return;
            }
            log(`已切换为导出为 ZIP: ${e.message}`);
            if ($('includeZip')) $('includeZip').checked = true;
        }
    }

    const finalUseZip = $('includeZip') ? $('includeZip').checked : true;
    if (!finalUseZip && !dirHandle) {
        log('未选择保存文件夹');
        $('btnExport').disabled = false;
        setExportRunning(false);
        return;
    }

    log(`开始导出 ${selected.length} 条对话…`);
    $('progWrap').style.display = 'block';
    $('bar').style.width = '0%';
    $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('progPreparing') : 'Preparing...';

    let totalAssets = 0;
    let downloadedAssets = 0;
    let landedChats = 0;
    let failedChats = [];
    let failedAttachments = [];
    let skipped = 0;
    let metaResults = [];
    const payloadIds = selected.map(s => ({
        id: s.id,
        title: s.title,
        url: s.url || s.href || `https://gemini.google.com/app/${s.id}`,
        timestamp: s.timestamp,
        lastSeen: s.lastSeen
    }));
    const CHUNK_SIZE = 1;
    const slot = currentSlot || 'u0';
    const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
    const store = await chrome.storage.local.get([expKey]);
    let curIds = store[expKey] || {};

    let batchDirHandle;
    let zip;
    let folder;
    const exportFolderName = 'gemini_export';
    if (finalUseZip) {
        zip = new JSZip();
        folder = zip.folder(exportFolderName);
    } else {
        try {
            if (dirHandle.name === exportFolderName) {
                batchDirHandle = dirHandle;
            } else {
                batchDirHandle = await dirHandle.getDirectoryHandle(exportFolderName, {
                    create: true
                });
            }
        } catch (e) {
            log(`创建子文件夹失败: ${e.message}`);
            batchDirHandle = dirHandle;
        }
    }

    async function ensureSubDir(root, subPath) {
        let cur = root;
        const parts = subPath.split('/').filter(Boolean);
        for (let p of parts) {
            cur = await cur.getDirectoryHandle(p, {
                create: true
            });
        }
        return cur;
    }
    async function writeFileDirect(localName, data) {
        try {
            const parts = localName.split('/');
            let fileName = parts.pop();
            fileName = sanitizeFileName(fileName, 'file');
            const dirPath = parts.join('/');
            let targetDir = batchDirHandle;
            if (dirPath) {
                const cleanParts = dirPath.split('/').map(p => sanitizeFileName(p, 'dir')).filter(Boolean);
                targetDir = await ensureSubDir(batchDirHandle, cleanParts.join('/'));
            }
            const fh = await targetDir.getFileHandle(fileName, {
                create: true
            });
            const wr = await fh.createWritable();
            await wr.write(data);
            await wr.close();
            return true;
        } catch (e) {
            log(`保存文件失败 (${localName}): ${e.message}`);
            return false;
        }
    }

    let currentExportTitle = '';
    let currentExportIdx = 0;

    function updateSharedProgress(chatIdx, chatTitle) {
        if (typeof chatIdx === 'number') currentExportIdx = chatIdx;
        if (typeof chatTitle === 'string' && chatTitle) currentExportTitle = chatTitle;

        const totalChats = payloadIds.length;
        const current = Math.min(currentExportIdx, totalChats);
        const pct = totalChats ? Math.floor((current / totalChats) * 100) : 0;
        const bar = $('bar');
        if (bar) bar.style.width = Math.min(Math.max(pct, 0), 100) + '%';

        let text = `进度 ${current}/${totalChats} (${pct}%)`;
        if (currentExportTitle) {
            const shortTitle = currentExportTitle.length > 28 ? currentExportTitle.slice(0, 28) + '…' : currentExportTitle;
            text += ` | 当前: ${shortTitle}`;
        }
        const attTotal = __globalTotalAssets || totalAssets;
        if (attTotal > 0) {
            text += ` | 附件: ${downloadedAssets}/${attTotal}`;
        }
        const pt = $('progText');
        if (pt) pt.textContent = text;
    }

    updateSharedProgress(0, typeof I18n !== 'undefined' ? I18n.t('progPreparing') : 'Preparing...');

    let attachmentQueue = [];
    let isFetchingDone = false;
    let activeDownloads = 0;
    const MAX_CONCURRENT = 4;

    async function processAttachmentQueue() {
        while (!__exportAborted && (!isFetchingDone || attachmentQueue.length > 0)) {
            if (attachmentQueue.length === 0 || activeDownloads >= MAX_CONCURRENT) {
                await new Promise(r => setTimeout(r, 100));
                continue;
            }
            const task = attachmentQueue.shift();
            activeDownloads++;
            try {
                await task();
            } catch (e) {}
            activeDownloads--;
        }
    }

    const consumerPool = [];
    for (let i = 0; i < MAX_CONCURRENT; i++) {
        consumerPool.push(processAttachmentQueue());
    }

    for (let i = 0; i < payloadIds.length; i += CHUNK_SIZE) {
        if (__exportAborted) {
            log('已终止导出');
            break;
        }
        let chunk = payloadIds.slice(i, i + CHUNK_SIZE);
        const curCandidate = chunk[0];
        if (curCandidate) {
            updateSharedProgress(i + 1, curCandidate.title || curCandidate.id);
        }

        let res = await new Promise(resolve => {
            chrome.runtime.sendMessage({
                action: 'fetchBatch',
                ids: chunk,
                format,
                skipExported: skip,
                globalOffset: i,
                globalTotal: payloadIds.length,
                accountSlot: currentSlot
            }, (response) => {
                if (chrome.runtime.lastError) {
                    resolve({
                        success: false,
                        error: chrome.runtime.lastError.message
                    });
                } else {
                    resolve(response);
                }
            });
        });
        if (!res || !res.success) {
            log(`抓取对话失败: ${res ? res.error : '未知错误'}`);
            failedChats.push(...chunk.map(c => c.id));
            continue;
        }

        skipped += (res.skipped || 0);
        const chunkResults = res.results || [];
        let convsNeedSave = false;
        for (let cIdx = 0; cIdx < chunkResults.length; cIdx++) {
            let chat = chunkResults[cIdx];
            if (__exportAborted) break;
            const requestedItem = chunk[cIdx] || chunk[0] || {};
            const nid = normId(requestedItem.id || chat?.id);
            if (!chat) chat = { id: nid, title: requestedItem.title };
            chat.id = nid;

            // ⚡ 如果云端 API 获取失败或无消息，尝试从 Takeout 离线问答记录无损兜底恢复
            if ((chat.error || chat._empty || !chat.messages || chat.messages.length === 0) && typeof getTakeoutOfflineChat === 'function') {
                const fbChat = getTakeoutOfflineChat(nid);
                if (fbChat && fbChat.messages && fbChat.messages.length > 0) {
                    chat = {
                        ...fbChat,
                        id: nid,
                        title: isRealTitle(chat.title, nid) ? chat.title : fbChat.title,
                        url: `https://gemini.google.com/app/${nid}`
                    };
                    delete chat.error;
                    delete chat._empty;
                    log(`[${chat.title || nid}] ⚡ 已自动从 Takeout 离线记录恢复问答并导出`, 'info');
                }
            }

            if (chat.error || chat._empty) {
                failedChats.push(chat.id);
                log(`[${chat.title || nid}] 导出跳过: ${chat.error || '云端返回内容为空且无本地离线记录'}`, 'warn');
                continue;
            }

            totalAssets += chat.attachmentCount || 0;
            const listC = conversations.find(c => normId(c.id) === nid) || null;
            let finalTitle = chat.title || listC?.title || chat.id;

            // 🎯 优先采用云端取回的高质量真实标题，并更新本地列表与持久化缓存
            if (isRealTitle(chat.title, chat.id) && chat.title !== chat.id) {
                finalTitle = chat.title;
                if (listC && listC.title !== finalTitle) {
                    listC.title = finalTitle;
                    convsNeedSave = true;
                }
            } else if (isRealTitle(listC?.title, chat.id)) {
                finalTitle = listC.title;
            }
            chat.title = finalTitle;
            const listTitle = finalTitle;
            let {
                content,
                ext
            } = mdContent(chat);
            const prevExportedAt = curIds[nid]?.exportedAt || curIds[chat.id]?.exportedAt || null;
            const safeBase = sanitizeFileName(listTitle, chat.id);
            const fileName = `${safeBase}_${chat.id.slice(-6)}.${ext}`;

            let writeOk = true;
            if (finalUseZip) {
                folder.file(fileName, content);
            } else {
                writeOk = await writeFileDirect(fileName, content);
            }

            if (writeOk) {
                landedChats++;
                if (!chat.error && !chat._empty) {
                    let exportTs = listC?.timestamp || chat.timestamp || Date.now();
                    if (typeof exportTs === 'string') exportTs = new Date(exportTs).getTime();
                    const record = {
                        title: listTitle,
                        exportedAt: new Date().toISOString(),
                        messageCount: chat.messageCount || chat.messages?.length || 0,
                        chatTime: exportTs,
                        status: 'ok'
                    };
                    curIds[chat.id] = record;
                    curIds[nid] = record;
                    curIds['c_' + nid] = record;
                    exportedIds[chat.id] = record;
                    exportedIds[nid] = record;
                    exportedIds['c_' + nid] = record;
                    chrome.storage.local.set({
                        [expKey]: curIds
                    }).catch(() => {});

                    try {
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
                                if (finalTitle) {
                                    titleDiv.innerHTML = `${finalTitle.replace(/</g, '&lt;')} ${badgeEl.outerHTML}`;
                                }
                            }
                        }
                    } catch {}
                }
            } else {
                failedChats.push(chat.id);
            }
            updateSharedProgress(i + cIdx + 1, listTitle);

            if (includeAssets && chat.messages && writeOk) {
                for (const m of chat.messages) {
                    if (!m.attachments) continue;

                    for (const att of m.attachments) {
                        if (att.type !== 'file') continue;
                        if ((att.url && att.url.includes('immersive_entry_chip')) && !att.contentMarkdown) continue;
                        if (att.contentMarkdown) {
                            if (att.contentMarkdown.includes('immersive_entry_chip') || att.contentMarkdown.includes('googleusercontent.com/immersive')) {
                                continue;
                            }
                            if (finalUseZip) {
                                try {
                                    folder.file(att.localName, att.contentMarkdown);
                                    downloadedAssets++;
                                    __globalDownloadedAssets = downloadedAssets;
                                    updateSharedProgress();
                                } catch {}
                            } else {
                                attachmentQueue.push(async () => {
                                    const ok = await writeFileDirect(att.localName || `${safeBase}_${chat.id.slice(-6)}.md`, att.contentMarkdown);
                                    if (ok) {
                                        downloadedAssets++;
                                        __globalDownloadedAssets = downloadedAssets;
                                        updateSharedProgress();
                                    }
                                });
                            }
                            continue;
                        }

                        attachmentQueue.push(async () => {
                            let saved = false;
                            let failReason = '';
                            try {
                                let tab = await getGeminiTab(currentSlot);
                                if (tab) {
                                    let candidates = [att.url, att.sourceUrl, att.src].filter(Boolean);
                                    candidates = [...new Set(candidates)];

                                    // HTML fallback for files missing URLs in batchexecute
                                    if (!candidates.length && chat.id) {
                                        try {
                                            let html = await (await fetch(`https://gemini.google.com/app/${chat.id.replace(/^c_/,'')}`)).text();
                                            let m2 = html.match(/https:\/\/[^\s"'<>]*googleusercontent[^\s"'<>]*download[^\s"'<>]*/gi);
                                            if (m2) {
                                                for (let u of m2) {
                                                    candidates.push(u.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\"/g, '').replace(/;/g, ''));
                                                }
                                            }
                                            let m3 = html.match(/https:\/\/drive\.google\.com[^\s"'<>\\]+/gi);
                                            if (m3) {
                                                for (let u of m3) {
                                                    candidates.push(u.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&'));
                                                }
                                            }
                                        } catch (e) {}
                                        candidates = [...new Set(candidates)];
                                    }

                                    let r2 = await new Promise(rv => {
                                        chrome.tabs.sendMessage(tab.id, {
                                            action: 'getFileBlob',
                                            fileName: att.name || att.title,
                                            url: att.url || att.sourceUrl,
                                            candidates,
                                            conversationId: chat.id
                                        }, resp => {
                                            if (chrome.runtime.lastError) {
                                                rv({
                                                    success: false,
                                                    error: chrome.runtime.lastError.message
                                                });
                                                return;
                                            }
                                            rv(resp);
                                        });
                                        setTimeout(() => rv({
                                            success: false,
                                            error: 'timeout 30s'
                                        }), 30000);
                                    });
                                    if (r2 && r2.blobBase64) {
                                        let ct = (r2.contentType || r2.mime || '').toLowerCase();
                                        if (ct && ct.includes('text/html') && r2.size < 20000) {
                                            failReason = 'response is HTML login page';
                                        } else {
                                            let bin = Uint8Array.from(atob(r2.blobBase64), c => c.charCodeAt(0));
                                            if (bin.length > 0) {
                                                if (finalUseZip) folder.file(att.localName, bin);
                                                else await writeFileDirect(att.localName || att.name || `files/${att.name}`, bin);
                                                saved = true;
                                            } else {
                                                failReason = 'decoded blob is empty';
                                            }
                                        }
                                    } else {
                                        failReason = r2?.error || 'content script returned empty';
                                    }
                                } else {
                                    failReason = 'no Gemini tab open';
                                }
                            } catch (e) {
                                failReason = e.message || 'exception';
                            }
                            if (saved) {
                                downloadedAssets++;
                                __globalDownloadedAssets = downloadedAssets;
                                updateSharedProgress();
                                return;
                            }
                            if (att.url && att.url.startsWith('http')) {
                                try {
                                    let r = await fetch(att.url, {
                                        credentials: 'include'
                                    });
                                    if (r.ok && !(r.headers.get('content-type') || '').startsWith('text/html')) {
                                        let b = await r.blob();
                                        let ab = await b.arrayBuffer();
                                        if (ab.byteLength > 0) {
                                            if (finalUseZip) folder.file(att.localName, ab);
                                            else await writeFileDirect(att.localName || att.name, ab);
                                            downloadedAssets++;
                                            __globalDownloadedAssets = downloadedAssets;
                                            updateSharedProgress();
                                            saved = true;
                                        } else {
                                            failReason = 'direct fetch blob empty';
                                        }
                                    } else if (!r.ok) {
                                        failReason = `HTTP ${r.status}`;
                                    } else {
                                        failReason = 'response is HTML (login redirect)';
                                    }
                                } catch (ex) {
                                    failReason = ex.message || 'fetch exception';
                                }
                            }
                            if (!saved && typeof getTakeoutFallbackMedia === 'function') {
                                try {
                                    let fallbackBin = await getTakeoutFallbackMedia(chat.id, att.localName || att.name || att.title || att.url);
                                    if (fallbackBin && fallbackBin.length > 0) {
                                        if (finalUseZip) folder.file(att.localName, fallbackBin);
                                        else await writeFileDirect(att.localName || att.name || `files/${att.name}`, fallbackBin);
                                        downloadedAssets++;
                                        __globalDownloadedAssets = downloadedAssets;
                                        updateSharedProgress();
                                        saved = true;
                                        log(`[${listTitle}] ⚡ 已从 Takeout 离线池成功恢复文档: ${att.localName || att.name}`, 'info');
                                    }
                                } catch (fbErr) {}
                            }
                            if (!saved) {
                                failedAttachments.push({
                                    chat: listTitle,
                                    file: att.name || att.title || att.localName,
                                    reason: failReason || 'unknown'
                                });
                                log(`[${listTitle}] 附件下载失败: ${att.name || att.localName} (${failReason})`, 'error');
                            }
                        });
                    }

                    for (const att of m.attachments) {
                        if (att.type !== 'image' || !att.src) continue;
                        if (/^http:\/\/googleusercontent\.com\/(?:image_agent_tag|image_generation_content|lmdx_image)/i.test(att.src)) continue;

                        attachmentQueue.push(async () => {
                            try {
                                let toHighRes = (u) => {
                                    try {
                                        if (!u || typeof u !== 'string') return u;
                                        // Never mutate Google Maps / Places photo CDN signatures
                                        if (u.includes('gps-cs-s') || u.includes('/p/AF1Qip') || u.includes('googleapis.com') || (u.includes('=w') && u.includes('-h'))) {
                                            return u;
                                        }
                                        if (u.includes('/gg/')) {
                                            return u.includes('?') ? (u.includes('alr=yes') ? u : u + '&alr=yes') : u + '?alr=yes';
                                        }
                                        if (u.includes('=s')) {
                                            let parts = u.split('?');
                                            let base = parts[0].replace(/=s\d+(?:-[^\?]+)*/i, '');
                                            let q = parts[1] ? parts[1] + '&alr=yes' : 'alr=yes';
                                            return base + '=s1024-rj?' + q;
                                        }
                                        return u;
                                    } catch {
                                        return u;
                                    }
                                };
                                let rawUrl = att.originalUrl || att.sourceUrl || att.src;
                                let cands = [
                                    rawUrl, // 1. 原始完整 URL 优先（保持 Maps/Places CDN 完整签名）
                                    att.src,
                                    att.resolvedUrl,
                                    toHighRes(rawUrl)
                                ];
                                if (rawUrl && rawUrl.includes('?')) {
                                    cands.push(rawUrl.split('?')[0]);
                                }
                                if (att.src && att.src.includes('/gg/')) {
                                    let withAlr = att.src.includes('?') ? (att.src.includes('alr=yes') ? att.src : att.src + '&alr=yes') : att.src + '?alr=yes';
                                    cands.push(withAlr);
                                }
                                cands = [...new Set(cands.filter(Boolean))];

                                let bin = null;
                                let lastStatus = '';

                                let tab = await getGeminiTab(currentSlot);
                                if (tab) {
                                    let r2 = await new Promise(rv => {
                                        chrome.tabs.sendMessage(tab.id, {
                                            action: 'getImageBlob',
                                            candidates: cands,
                                            url: att.src
                                        }, resp => {
                                            if (chrome.runtime.lastError) {
                                                rv({
                                                    success: false,
                                                    error: chrome.runtime.lastError.message
                                                });
                                                return;
                                            }
                                            rv(resp);
                                        });
                                        setTimeout(() => rv({
                                            success: false,
                                            error: 'timeout'
                                        }), 15000);
                                    });
                                    if (r2 && r2.blobBase64) {
                                        bin = Uint8Array.from(atob(r2.blobBase64), c => c.charCodeAt(0));
                                    } else if (r2 && !r2.success) {
                                        lastStatus = 'CS: ' + (r2.error || 'unknown');
                                    }
                                }

                                if (!bin) {
                                    for (let u of cands) {
                                        try {
                                            let r = await fetch(u, {
                                                credentials: 'include',
                                                headers: {
                                                    'Accept': 'image/*,*/*;q=0.8'
                                                }
                                            });
                                            if (r.ok) {
                                                let ct = (r.headers.get('content-type') || '').toLowerCase();
                                                if (ct.startsWith('text/plain') || ct.startsWith('text/html')) {
                                                    let txt = await r.text();
                                                    let m = txt.match(/https:\/\/[^\s"'<>\\]*(?:googleusercontent|google)\.com\/[^\s"'<>\\]+/i);
                                                    if (m) {
                                                        let nextUrl = m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
                                                        if (!cands.includes(nextUrl)) cands.push(nextUrl);
                                                    }
                                                    continue;
                                                }
                                                let tempBlob = await r.blob();
                                                if (tempBlob.size > 800) {
                                                    let ab = await tempBlob.arrayBuffer();
                                                    bin = new Uint8Array(ab);
                                                    break;
                                                } else {
                                                    lastStatus = `too small (${tempBlob.size}B)`;
                                                }
                                            } else {
                                                lastStatus = `HTTP ${r.status}`;
                                            }
                                        } catch (e) {
                                            lastStatus = e.message;
                                        }
                                    }
                                }

                                if (!bin && typeof getTakeoutFallbackMedia === 'function') {
                                    try {
                                        let fallbackBin = await getTakeoutFallbackMedia(chat.id, att.localName || att.alt || att.src);
                                        if (fallbackBin && fallbackBin.length > 0) {
                                            bin = fallbackBin;
                                            log(`[${listTitle}] ⚡ 已从 Takeout 离线池成功恢复图片: ${att.localName || '未知'}`, 'info');
                                        }
                                    } catch (fbErr) {}
                                }

                                if (!bin) {
                                    let reason = `all ${cands.length} candidates failed: ${lastStatus}`;
                                    failedAttachments.push({
                                        chat: listTitle,
                                        file: att.localName || att.alt,
                                        reason
                                    });
                                    log(`[${listTitle}] 图片下载失败: ${att.localName || '未知'} (${reason})`, 'error');
                                    return;
                                }

                                if (finalUseZip) folder.file(att.localName, bin);
                                else await writeFileDirect(att.localName || `assets/${Date.now()}.png`, bin);

                                downloadedAssets++;
                                __globalDownloadedAssets = downloadedAssets;
                                updateSharedProgress();
                            } catch (ex) {
                                failedAttachments.push({
                                    chat: listTitle,
                                    file: att.localName || att.alt,
                                    reason: ex.message
                                });
                                log(`图片下载失败: ${att.localName || '未知'} (${ex.message})`, 'error');
                            }
                        });
                    }
                }
            }
            let lastUpdatedAt = null;
            if (listC && typeof listC.timestamp === 'number') lastUpdatedAt = toIso(listC.timestamp);
            else if (listC && listC.lastSeen) lastUpdatedAt = toIso(listC.lastSeen);
            else if (chat.timestamp) lastUpdatedAt = toIso(chat.timestamp);
            metaResults.push({
                id: chat.id,
                title: listTitle,
                url: chat.url,
                format: format,
                count: chat.messageCount || chat.messages?.length || 0,
                atts: chat.attachmentCount || 0,
                exportedAt: new Date().toISOString(),
                lastExportedBefore: prevExportedAt,
                lastUpdatedAt: lastUpdatedAt
            });
            chat.messages = null; // 释放内存
        }
        if (convsNeedSave) {
            await chrome.storage.local.set({ [convKey]: conversations }).catch(() => {});
        }
    }

    isFetchingDone = true;
    if (attachmentQueue.length > 0) {
        updateSharedProgress(payloadIds.length, typeof I18n !== 'undefined' ? I18n.t('progDownloadingAssets') : 'Downloading remaining assets...');
    }
    await Promise.all(consumerPool);

    if (__exportAborted) {
        log('已终止导出');
        $('btnExport').disabled = false;
        setExportRunning(false);
        return;
    }

    if (includeIndex) {
        const indexStr = JSON.stringify(metaResults, null, 2);
        if (finalUseZip) folder.file('_index.json', indexStr);
        else await writeFileDirect('_index.json', indexStr);

        let mdIndex = '# 导出目录\n\n';
        mdIndex += `导出时间: ${new Date().toISOString()} | 共 ${metaResults.length} 条\n\n`;
        for (const r of metaResults) {
            const upd = r.lastUpdatedAt ? ` | 最后更新 ${new Date(r.lastUpdatedAt).toLocaleString()}` : '';
            const exp = r.lastExportedBefore ? ` | 上次导出 ${new Date(r.lastExportedBefore).toLocaleString()}` : '';
            mdIndex += `- [${r.title} (${r.count}条含附件${r.atts})](./${sanitizeFileName(r.title, r.id)}_${r.id.slice(-6)}.md)${upd}${exp}\n`;
        }
        if (finalUseZip) folder.file('README.md', mdIndex);
        else await writeFileDirect('README.md', mdIndex);
    }

    // 🛠️ 开发者模式或有错误发生时，自动将全部会话日志与错误详情写入导出目录
    let isDevMode = document.body.classList.contains('dev-mode');
    if (!isDevMode) {
        try {
            const devData = await chrome.storage.local.get(['gemini_dev_mode']);
            isDevMode = !!devData?.gemini_dev_mode;
        } catch {}
    }

    if (isDevMode || failedChats.length > 0 || failedAttachments.length > 0) {
        const finalAttTotal = __globalTotalAssets || totalAssets;
        let fullLogText = `=======================================================\n`;
        fullLogText += ` Gemini Exporter Session Log (Dev Mode)\n`;
        fullLogText += ` Time: ${new Date().toISOString()}\n`;
        fullLogText += ` Summary: Landed ${landedChats}/${payloadIds.length} chats, Assets ${downloadedAssets}/${finalAttTotal}, Skipped ${skipped}\n`;
        fullLogText += ` Failed Chats: ${failedChats.length}, Failed Assets: ${failedAttachments.length}\n`;
        fullLogText += `=======================================================\n\n`;

        if (failedChats.length > 0) {
            fullLogText += `[FAILED CONVERSATIONS]\n`;
            for (const fc of failedChats) {
                fullLogText += `  - ${fc}\n`;
            }
            fullLogText += `\n`;
        }

        if (failedAttachments.length > 0) {
            fullLogText += `[FAILED ASSETS / ATTACHMENTS]\n`;
            for (const fa of failedAttachments) {
                fullLogText += `  - Chat: "${fa.chat}" | File: "${fa.file}" | Reason: ${fa.reason}\n`;
            }
            fullLogText += `\n`;
        }

        fullLogText += `[FULL RUNTIME LOGS]\n`;
        const chronoLogs = __logBuf.slice().reverse();
        for (const item of chronoLogs) {
            fullLogText += `[${item.time}] [${(__levelTag[item.level] || item.level || 'I').toUpperCase()}] ${item.text}\n`;
        }

        try {
            if (finalUseZip) {
                folder.file('_export_dev.log', fullLogText);
                if (failedAttachments.length || failedChats.length) {
                    folder.file('_export_errors.json', JSON.stringify({ failedChats, failedAttachments }, null, 2));
                }
            } else {
                await writeFileDirect('_export_dev.log', fullLogText);
                if (failedAttachments.length || failedChats.length) {
                    await writeFileDirect('_export_errors.json', JSON.stringify({ failedChats, failedAttachments }, null, 2));
                }
            }
            log('🛠️ [开发者模式] 已自动将完整导出日志与诊断写入 _export_dev.log', 'info');
        } catch (logWriteErr) {
            console.error('Failed to write _export_dev.log', logWriteErr);
        }
    }

    if (finalUseZip) {
        log('正在生成 ZIP 压缩包，请稍候…');
        try {
            const content = await zip.generateAsync({
                type: 'blob'
            });
            const url = URL.createObjectURL(content);
            const zName = exportFolderName + '.zip';
            const a = document.createElement('a');
            a.href = url;
            a.download = zName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            log('ZIP 打包完成，已开始下载');
        } catch (e) {
            log(`ZIP 生成失败: ${e.message}`);
        }
    } else {
        log(`导出完成，实际保存 ${landedChats} 条对话、${downloadedAssets} 个附件到 ${dirHandle.name}`);
    }

    if (failedChats.length) {
        log(`⚠️ 有 ${failedChats.length} 条对话导出失败`, 'error');
        console.error('Failed ids:', failedChats);
    }
    if (failedAttachments.length) {
        log(`⚠️ 有 ${failedAttachments.length} 个附件下载失败：`, 'error');
        for (const fa of failedAttachments.slice(0, 30)) {
            log(`  • [${fa.chat}] ${fa.file} - ${fa.reason}`, 'error');
        }
        if (failedAttachments.length > 30) log(`  ... 还有 ${failedAttachments.length - 30} 个未列出`, 'error');
        console.error('Failed attachments JSON:', JSON.stringify(failedAttachments, null, 2));
    }

    $('bar').style.width = '100%';
    const finalAttTotal = __globalTotalAssets || totalAssets;
    const attStr = finalAttTotal > 0 ? `，附件 ${downloadedAssets}/${finalAttTotal}${failedAttachments.length ? ` (失败${failedAttachments.length})` : ''}` : '';
    $('progText').textContent = `完成 ${landedChats}/${payloadIds.length} 条${attStr}，跳过 ${skipped} 条`;
    $('btnExport').disabled = false;
    setExportRunning(false);

    // Sync exportedIds and refresh conversation list on the right
    exportedIds = Object.assign({}, curIds);
    const currentSelected = new Set(getSelected().map(x => x.id));
    renderList(currentSelected);
    updateSelectedStat();

    chrome.runtime.sendMessage({
        action: 'exportProgress',
        done: metaResults.length,
        total: metaResults.length,
        title: '全部完成'
    });
}



function toMarkdown(chat) {
    if (typeof ChatFormatter !== 'undefined') {
        return ChatFormatter.toMarkdown(chat);
    }
    if (chat.error) return `# ${chat.title}\n\n> 导出失败: ${chat.error}\n\n> ID: ${chat.id} | URL: ${chat.url}\n`;
    return `# ${chat.title || 'Untitled'}\n\n${(chat.messages || []).map(m => m.content || '').join('\n\n')}`;
}

// 监听 background 进度 - debounce to prevent workbench flashing on deep scan
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const slot = currentSlot || 'u0';
    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
    const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;
    const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;

    if (changes[expKey] && !__exportRunning) {
        exportedIds = changes[expKey].newValue || {};
        const currentSelected = new Set(getSelected().map(x => x.id));
        renderList(currentSelected);
        updateSelectedStat();
    }

    if (!(changes[convKey] || changes[countKey] || changes.gemini_account_slots)) return;
    let newCount = changes[convKey]?.newValue?.length ?? changes[countKey]?.newValue ?? null;
    console.log('[workbench] storage.onChanged debounced', area, Object.keys(changes), newCount);
    // skip if same signature as last render (deep scan writes same large set repeatedly)
    if (newCount !== null && newCount === conversations.length && !changes.gemini_account_slots) {
        debouncedLoadStore(true);
        return;
    }
    debouncedLoadStore(true);
});
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'scanProgress') {
        const progWrap = $('progWrap');
        if (progWrap) progWrap.style.display = 'block';
        let bar = $('bar');
        let pt = $('progText');
        let pct = typeof msg.percent === 'number' ? msg.percent : (msg.total ? Math.floor((msg.done / msg.total) * 100) : 50);
        if (bar) bar.style.width = Math.min(Math.max(pct, 5), 100) + '%';
        if (pt) pt.textContent = msg.title || (typeof I18n !== 'undefined' ? I18n.t('progSyncing', msg.count || msg.done) : `Syncing (${msg.count || msg.done} items)...`);
        return;
    }
    if (msg.action === 'exportProgress') {
        if (__exportRunning) {
            log(`进度 [${msg.done}/${msg.total}]: ${msg.title || msg.id}`);
            return;
        }
        const progWrap = $('progWrap');
        if (progWrap) progWrap.style.display = 'block';
        const pct = msg.total ? Math.floor((msg.done / msg.total) * 100) : 0;
        let bar = $('bar');
        if (bar) bar.style.width = pct + '%';
        let pt = $('progText');
        if (pt) pt.textContent = typeof I18n !== 'undefined' ? I18n.t('progSyncProgress', msg.done, msg.total, msg.title || '') : `Progress ${msg.done}/${msg.total} | Current: ${msg.title || ''}`;
        log(`进度 ${msg.done}/${msg.total}: ${msg.title || msg.id}`);
        return;
    }
    if (msg.action === 'syncUpdate') {
        if (msg.slot) {
            currentSlot = msg.slot;
        }
        chrome.storage.local.get(['gemini_account_slots'], d => {
            accountSlots = d.gemini_account_slots || {};
            updateAccountSlotSelector();
        });
        const syncEl = $('syncCount');
        if (syncEl) syncEl.textContent = typeof I18n !== 'undefined' ? I18n.t('syncedBadge', msg.count) : `${msg.count} synced`;
        console.log('[workbench] syncUpdate received', msg.count, 'current', conversations.length, 'slot', currentSlot, 'from', msg.from);
        __lastRenderedSignature = null;
        debouncedLoadStore(false);
        return;
    }
    if (msg.action === 'assetProgress') {
        log(`下载图片 (${msg.done}/${msg.total}): ${msg.local}`);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('[workbench] DOMContentLoaded');
    if (typeof I18n !== 'undefined') {
        I18n.initLanguage().then(() => {
            I18n.applyI18n();
            updateZipUi();
        });
    }

    $('accountSlotSelect')?.addEventListener('change', (e) => {
        currentSlot = e.target.value;
        loadStore(false);
    });
    const verEl = document.getElementById('ver');
    if (verEl) {
        try {
            verEl.textContent = 'v' + chrome.runtime.getManifest().version;
        } catch (e) {}
    }
    // Auto-detect current active Gemini tab's slot
    (async () => {
        try {
            const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
            const activeTab = tabs.find(t => t.active) || tabs[0];
            if (activeTab?.url) {
                const m = activeTab.url.match(/\/u\/(\d+)(?:\/|$)/);
                if (m) {
                    currentSlot = 'u' + m[1];
                    console.log('[workbench] Auto-detected slot from active Gemini tab:', currentSlot);
                }
            }
        } catch {}
        loadStore();
    })();
    chrome.storage.local.get(['gemini_export_format', 'gemini_export_zip'], data => {
        if (data.gemini_export_format && $('format')) {
            $('format').value = data.gemini_export_format;
        }
        if (typeof data.gemini_export_zip !== 'undefined' && $('includeZip')) {
            $('includeZip').checked = data.gemini_export_zip;
            updateZipUi();
        }
    });
    $('format')?.addEventListener('change', e => {
        chrome.storage.local.set({ gemini_export_format: e.target.value });
    });
    $('langToggle')?.addEventListener('change', async (e) => {
        const nextLang = e.target.checked ? 'en' : 'zh';
        if (typeof I18n !== 'undefined') {
            const listEl = $('list');
            const savedScroll = listEl ? listEl.scrollTop : 0;
            await I18n.setLang(nextLang);
            updateAccountSlotSelector();
            updateZipUi();
            updateDirLabel();
            const syncCountEl = $('syncCount');
            if (syncCountEl) syncCountEl.textContent = I18n.t('syncedBadge', conversations.length);
            const lastSyncEl = $('lastSync');
            if (lastSyncEl && typeof __lastSyncRaw !== 'undefined' && __lastSyncRaw) {
                lastSyncEl.textContent = I18n.t('lastSync', new Date(__lastSyncRaw).toLocaleString(), conversations.length);
            }
            const currentSelected = new Set(getSelected().map(x => x.id));
            renderList(currentSelected);
            if (listEl) listEl.scrollTop = savedScroll;
            updateSelectedStat();
        }
    });
    // 开发者模式开关
    function updateDevFormatUi(isDev) {
        const opt = $('optFormatRaw');
        if (opt) {
            opt.hidden = !isDev;
            opt.style.display = isDev ? '' : 'none';
        }
        const fmt = $('format');
        if (fmt && !isDev && fmt.value === 'json_raw') {
            fmt.value = 'markdown';
            chrome.storage.local.set({ gemini_export_format: 'markdown' });
        }
    }

    const devToggle = $('devToggle');
    if (devToggle) {
        chrome.storage.local.get(['gemini_dev_mode'], (d) => {
            const isDev = !!d.gemini_dev_mode;
            devToggle.checked = isDev;
            document.body.classList.toggle('dev-mode', isDev);
            const labelDev = $('labelDevMode');
            if (labelDev) labelDev.style.color = isDev ? 'var(--accent2)' : 'var(--muted)';
            updateDevFormatUi(isDev);
        });
        devToggle.addEventListener('change', (e) => {
            const isDev = !!e.target.checked;
            document.body.classList.toggle('dev-mode', isDev);
            const labelDev = $('labelDevMode');
            if (labelDev) labelDev.style.color = isDev ? 'var(--accent2)' : 'var(--muted)';
            updateDevFormatUi(isDev);
            chrome.storage.local.set({ gemini_dev_mode: isDev });
            if (isDev) {
                log('🛠️ 开发者模式已启用：已显示诊断工具与原始JSON选项');
            } else {
                log('🔒 开发者模式已关闭');
            }
        });
    }
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
    $('logFilter')?.addEventListener('input', renderLog);
    $('logLevel')?.addEventListener('change', renderLog);
    $('btnClearLog')?.addEventListener('click', clearLog);
    $('btnCopyLog')?.addEventListener('click', async () => {
        const l = $('log');
        if (!l) return;
        const copiedText = typeof I18n !== 'undefined' ? I18n.t('copied') : 'Copied!';
        const origText = typeof I18n !== 'undefined' ? I18n.t('btnCopyLog') : 'Copy';
        try {
            await navigator.clipboard.writeText(l.textContent);
            const btn = $('btnCopyLog');
            btn.textContent = copiedText;
            setTimeout(() => btn.textContent = origText, 1500);
        } catch {
            const ta = document.createElement('textarea');
            ta.value = l.textContent;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            const btn = $('btnCopyLog');
            btn.textContent = copiedText;
            setTimeout(() => btn.textContent = origText, 1500);
        }
    });
    $('btnExportDiag')?.addEventListener('click', async () => {
        try {
            const data = await chrome.storage.local.get(['gemini_last_sync_diagnostics']);
            const diag = data.gemini_last_sync_diagnostics;
            if (!diag) {
                alert(typeof I18n !== 'undefined' ? I18n.t('noDiagData') : 'No diagnostic data yet.');
                return;
            }
            const blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gemini_sync_diagnostics_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            log('已下载诊断日志文件: ' + a.download);
        } catch (e) {
            log('导出诊断日志失败: ' + e.message);
        }
    });
    $('btnExport').addEventListener('click', exportSelected);
    $('btnSetDir')?.addEventListener('click', async () => {
        try {
            await requestDirHandle();
        } catch (e) {
            log(typeof I18n !== 'undefined' ? I18n.t('dirCancelled', e.message) : `Directory cancelled: ${e.message}`);
        }
    });
    if (typeof idb !== 'undefined') {
        idb.get('export_dir').then(handle => {
            if (handle) {
                __globalDirHandle = handle;
                updateDirLabel();
            }
        });
    }

    const zipCheck = $('includeZip');
    const updateZipUi = () => {
        if (!zipCheck) return;
        const isZip = zipCheck.checked;
        $('btnExport').textContent = isZip ? (typeof I18n !== 'undefined' ? I18n.t('btnExportZip') : 'Export Selected → ZIP') : (typeof I18n !== 'undefined' ? I18n.t('btnExportFolder') : 'Export Selected → Folder');
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
    if (zipCheck) {
        zipCheck.addEventListener('change', () => {
            updateZipUi();
            chrome.storage.local.set({ gemini_export_zip: zipCheck.checked });
        });
        updateZipUi();
    }
    $('btnExportJson').addEventListener('click', () => {
        const sel = getSelected();
        const content = JSON.stringify(sel, null, 2);
        const blob = new Blob([content], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gemini-list.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 800);
    });
    // 取消导出按钮
    const btnCancel = $('btnCancel');
    if (btnCancel) {
        btnCancel.addEventListener('click', () => {
            __exportAborted = true;
            log('正在终止导出…');
            chrome.runtime.sendMessage({
                action: 'cancelExport'
            }, () => {});
        });
    }
    // 终止同步按钮
    const btnStopScan = $('btnStopScan');
    if (btnStopScan) {
        btnStopScan.addEventListener('click', async () => {
            log('正在请求终止同步…');
            $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('stoppingSync') : 'Stopping sync...';
            btnStopScan.disabled = true;
            try {
                chrome.runtime.sendMessage({
                    action: 'abortSync',
                    accountSlot: currentSlot
                });
                const tab = await findTabForSlot(currentSlot);
                if (tab) {
                    chrome.tabs.sendMessage(tab.id, { action: 'abortSync' }, () => {});
                }
            } catch (e) {}
        });
    }
    // 同步最新会话按钮（增量）
    const btnIncr = $('btnIncrementalScan');
    const btnDeep = document.getElementById('btnDeepScan');
    if (btnIncr) {
        btnIncr.addEventListener('click', async () => {
            log('开始同步最新会话…');
            $('progWrap').style.display = 'block';
            $('bar').style.width = '5%';
            $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('syncingLatest') : 'Syncing latest conversations...';
            btnIncr.disabled = true;
            if (btnDeep) btnDeep.disabled = true;
            if (btnStopScan) {
                btnStopScan.style.display = 'inline-block';
                btnStopScan.disabled = false;
            }
            chrome.runtime.sendMessage({
                action: 'deepScan',
                maxIter: 150,
                mode: 'incremental',
                accountSlot: currentSlot
            }, (res) => {
                btnIncr.disabled = false;
                if (btnDeep) btnDeep.disabled = false;
                if (btnStopScan) btnStopScan.style.display = 'none';
                if (chrome.runtime.lastError) {
                    log('同步失败: ' + chrome.runtime.lastError.message);
                    $('progText').textContent = (typeof I18n !== 'undefined' ? I18n.t('failedPrefix') : 'Failed') + ': ' + chrome.runtime.lastError.message;
                    return;
                }
                log('同步完成，已更新列表');
                $('bar').style.width = '100%';
                $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('syncFinished', res?.totalMerged || res?.count || '0') : ('Done, synced ' + (res?.totalMerged || res?.count || '0') + ' conversations');
                if (res?.diagnostics) {
                    log(`[诊断] 停止原因: ${res.diagnostics.stopReason}`);
                    log(`[诊断] 翻页 ${res.diagnostics.totalPagesFetched} 次，共 ${res.diagnostics.totalConversations} 条。可点击左侧「导出诊断」下载完整 JSON。`);
                }
                if (res?.slot) currentSlot = res.slot;
                __lastRenderedSignature = null;
                setTimeout(() => loadStore(false), 200);
            });
        });
    }
    // 全量拉取历史按钮
    if (btnDeep) {
        btnDeep.addEventListener('click', async () => {
            log('开始全量拉取历史…');
            $('progWrap').style.display = 'block';
            $('bar').style.width = '5%';
            $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('deepSyncing') : 'Full deep sync in progress...';
            btnDeep.disabled = true;
            if (btnIncr) btnIncr.disabled = true;
            if (btnStopScan) {
                btnStopScan.style.display = 'inline-block';
                btnStopScan.disabled = false;
            }
            chrome.runtime.sendMessage({
                action: 'deepScan',
                maxIter: 150,
                mode: 'full',
                accountSlot: currentSlot
            }, (res) => {
                btnDeep.disabled = false;
                if (btnIncr) btnIncr.disabled = false;
                if (btnStopScan) btnStopScan.style.display = 'none';
                if (chrome.runtime.lastError) {
                    log('全量拉取失败: ' + chrome.runtime.lastError.message);
                    $('progText').textContent = (typeof I18n !== 'undefined' ? I18n.t('failedPrefix') : 'Failed') + ': ' + chrome.runtime.lastError.message;
                    console.error('[workbench] deepScan err', chrome.runtime.lastError);
                    return;
                }
                log('全量拉取完成，已更新列表');
                $('bar').style.width = '100%';
                $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('syncFinished', res?.totalMerged || res?.count || '0') : ('Done, synced ' + (res?.totalMerged || res?.count || '0') + ' conversations');
                if (res?.diagnostics) {
                    log(`[诊断] 停止原因: ${res.diagnostics.stopReason}`);
                    log(`[诊断] 翻页 ${res.diagnostics.totalPagesFetched} 次，共 ${res.diagnostics.totalConversations} 条。可点击左侧「导出诊断」下载完整 JSON。`);
                }
                if (res?.slot) currentSlot = res.slot;
                __lastRenderedSignature = null;
                setTimeout(() => loadStore(false), 200);
            });
        });
    }
    $('btnClearExported').addEventListener('click', async () => {
        if (!confirm(typeof I18n !== 'undefined' ? I18n.t('confirmClearExported') : 'Are you sure you want to clear export history?')) return;
        const slot = currentSlot || 'u0';
        const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
        await chrome.storage.local.remove(expKey);
        exportedIds = {};
        log(typeof I18n !== 'undefined' ? I18n.t('btnClearExported') : 'Export history cleared');
        const currentSelected = new Set(getSelected().map(x => x.id));
        renderList(currentSelected);
        updateSelectedStat();
    });
    $('btnClearAll').addEventListener('click', async () => {
        if (!confirm(typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : 'Are you sure you want to clear all locally cached conversations?')) return;
        const slot = currentSlot || 'u0';
        const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
        const syncKey = slot === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${slot}`;
        const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;
        await chrome.storage.local.remove([convKey, syncKey, countKey]);
        if (accountSlots[slot]) {
            accountSlots[slot].count = 0;
            await chrome.storage.local.set({ gemini_account_slots: accountSlots });
        }
        conversations = [];
        updateAccountSlotSelector();
        renderList(new Set());
        updateSelectedStat();
        log(typeof I18n !== 'undefined' ? I18n.t('btnClearAll') : 'Cache cleared');
    });

    // 📥 导入 Google Takeout ZIP
    const btnImportTakeout = $('btnImportTakeout');
    const takeoutFileInput = $('takeoutFileInput');
    if (btnImportTakeout && takeoutFileInput) {
        btnImportTakeout.addEventListener('click', () => {
            takeoutFileInput.value = '';
            takeoutFileInput.click();
        });
        takeoutFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                await parseTakeoutZip(file);
            }
        });
    }

    // 💾 备份与 📂 恢复数据
    const btnBackupData = $('btnBackupData');
    const btnRestoreData = $('btnRestoreData');
    const restoreFileInput = $('restoreFileInput');

    if (btnBackupData) {
        btnBackupData.addEventListener('click', async () => {
            await exportFullBackup();
        });
    }

    if (btnRestoreData && restoreFileInput) {
        btnRestoreData.addEventListener('click', () => {
            restoreFileInput.value = '';
            restoreFileInput.click();
        });
        restoreFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                await restoreFullBackup(file);
            }
        });
    }
});

// ==========================================
// 📦 Google Takeout ZIP 解析与离线媒体缓存池
// ==========================================
let __takeoutMediaMap = {};
let __takeoutGlobalMedia = {};
let __takeoutConvCache = {};

function getTakeoutOfflineChat(chatId) {
    if (!chatId) return null;
    const nid = normId(chatId);
    return __takeoutConvCache[nid] || null;
}

async function getTakeoutFallbackMedia(chatId, filenameOrId) {
    if (!filenameOrId) return null;
    const nid = normId(chatId);
    let target = String(filenameOrId).replace(/^.*[\\\/]/, '').trim();
    try { target = decodeURIComponent(target); } catch {}
    let targetStem = target.replace(/\.[^/.]+$/, '').toLowerCase();
    // 💡 彻底剥离前缀（如 39d5b4_ 或 c_ 前缀）与后缀（如 -16位hex）
    let cleanTargetStem = targetStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
    let cleanTarget = target.replace(/^[0-9a-fA-F]{4,16}_+/, '').trim();

    const convMedia = __takeoutMediaMap[nid];
    if (convMedia && convMedia.length) {
        for (const item of convMedia) {
            let itemFilename = item.filename;
            let itemStem = itemFilename.replace(/\.[^/.]+$/, '').toLowerCase();
            let cleanItemStem = itemStem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
            if (itemFilename === target || itemFilename === cleanTarget || itemStem === cleanTargetStem || cleanItemStem === cleanTargetStem || cleanItemStem === targetStem || (cleanItemStem.length > 3 && cleanTargetStem.includes(cleanItemStem)) || (cleanTargetStem.length > 3 && cleanItemStem.includes(cleanTargetStem))) {
                try {
                    let bin = await item.fileObj.async('uint8array');
                    if (bin && bin.length > 0) return bin;
                } catch {}
            }
        }
        if (convMedia.length === 1 && (/^image(?:-\d+)?$/i.test(cleanTargetStem) || /^file/i.test(cleanTargetStem) || /^asset/i.test(cleanTargetStem))) {
            try {
                let bin = await convMedia[0].fileObj.async('uint8array');
                if (bin && bin.length > 0) return bin;
            } catch {}
        }
    }

    if (__takeoutGlobalMedia[cleanTargetStem] || __takeoutGlobalMedia[targetStem] || __takeoutGlobalMedia[cleanTarget] || __takeoutGlobalMedia[target]) {
        const fObj = __takeoutGlobalMedia[cleanTargetStem] || __takeoutGlobalMedia[targetStem] || __takeoutGlobalMedia[cleanTarget] || __takeoutGlobalMedia[target];
        try {
            let bin = await fObj.async('uint8array');
            if (bin && bin.length > 0) return bin;
        } catch {}
    }

    for (const [stem, fileObj] of Object.entries(__takeoutGlobalMedia)) {
        let cleanStem = stem.replace(/^[0-9a-fA-F]{4,16}_+/, '').replace(/[-_][0-9a-fA-F]{6,16}$/i, '').trim();
        if ((cleanStem.length > 4 && (cleanStem === cleanTargetStem || cleanStem.includes(cleanTargetStem) || cleanTargetStem.includes(cleanStem))) ||
            (stem.length > 4 && (stem === cleanTargetStem || stem.includes(cleanTargetStem) || cleanTargetStem.includes(stem)))) {
            try {
                let bin = await fileObj.async('uint8array');
                if (bin && bin.length > 0) return bin;
            } catch {}
        }
    }

    return null;
}

async function parseTakeoutZip(file) {
    if (typeof JSZip === 'undefined') {
        log('JSZip 库未加载，无法解析 ZIP', 'error');
        alert('JSZip 库未加载，无法解析 ZIP');
        return;
    }
    const parsingMsg = typeof I18n !== 'undefined' ? I18n.t('takeoutParsing') : 'Parsing Takeout ZIP archive...';
    log(parsingMsg, 'info');
    $('progWrap').style.display = 'block';
    $('bar').style.width = '15%';
    $('progText').textContent = parsingMsg;

    try {
        const zip = await JSZip.loadAsync(file);
        $('bar').style.width = '40%';

        let activityFile = null;
        for (const filename of Object.keys(zip.files)) {
            if (zip.files[filename].dir) continue;
            if (/MyActivity\.html$/i.test(filename) && (/Gemini/i.test(filename) || /Bard/i.test(filename) || /我的活动/i.test(filename))) {
                activityFile = zip.files[filename];
                break;
            }
        }
        if (!activityFile) {
            for (const filename of Object.keys(zip.files)) {
                if (zip.files[filename].dir) continue;
                if (/MyActivity\.html$/i.test(filename) || /Gemini.*\.html$/i.test(filename) || /Bard.*\.html$/i.test(filename) || /我的活动.*\.html$/i.test(filename)) {
                    activityFile = zip.files[filename];
                    break;
                }
            }
        }

        if (!activityFile) {
            const notFoundMsg = typeof I18n !== 'undefined' ? I18n.t('takeoutNotFound') : 'Gemini Apps activity (MyActivity.html) not found in ZIP';
            log(notFoundMsg, 'error');
            $('progWrap').style.display = 'none';
            alert(notFoundMsg);
            return;
        }

        const htmlText = await activityFile.async('text');
        $('bar').style.width = '70%';

        __takeoutMediaMap = {};
        __takeoutGlobalMedia = {};
        __takeoutConvCache = {};
        let totalMediaCount = 0;

        for (const [path, fObj] of Object.entries(zip.files)) {
            if (fObj.dir || path.endsWith('.html') || path.endsWith('.json')) continue;
            let filename = path.replace(/^.*[\\\/]/, '').trim();
            let stem = filename.replace(/\.[^/.]+$/, '').toLowerCase();
            let cleanStem = stem.replace(/-[0-9a-fA-F]{16}$/i, '');
            __takeoutGlobalMedia[cleanStem] = fObj;
            __takeoutGlobalMedia[stem] = fObj;
            __takeoutGlobalMedia[filename] = fObj;
            totalMediaCount++;
        }

        const rawBlocks = htmlText.split('<div class="outer-cell');
        const extractedMap = {};

        for (let i = 1; i < rawBlocks.length; i++) {
            const block = rawBlocks[i];
            const linkMatches = Array.from(block.matchAll(/https:\/\/(?:gemini|bard)\.google\.com\/(?:u\/\d+\/)?(?:app|chat)\/([a-zA-Z0-9_-]{8,64})/g));
            if (!linkMatches.length) continue;

            const foundIds = [];
            for (const lm of linkMatches) {
                const fullId = lm[1].replace(/^c_/, '').trim();
                const cleanId = fullId.toLowerCase();
                if (cleanId.length >= 8 && !foundIds.includes(cleanId)) {
                    foundIds.push(cleanId);
                }
            }
            if (!foundIds.length) continue;

            let promptText = '';
            const promptMatch = block.match(/(?:Prompted|已提示|提示|プロンプト|Demande|Preguntado)\s*([\s\S]*?)(?:<br\s*\/?>|\n)/i)
                || block.match(/<div class="content-cell[^>]*>([\s\S]*?)(?:<br\s*\/?>|\n)/i);
            if (promptMatch) {
                promptText = promptMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[\u202f\xa0]/g, ' ').trim();
            }

            let ts = null;
            const timeMatchEn = block.match(/([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4},\s+\d{1,2}:\d{2}(?::\d{2})?\s*[\u202f\s]*(?:AM|PM)\s*[A-Z]*)/);
            const timeMatchZh = block.match(/(\d{4}年\d{1,2}月\d{1,2}日[\s\u202f\xa0]*(?:上午|下午)?\s*\d{1,2}:\d{2}(?::\d{2})?)/);
            const timeMatchIso = block.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}[\sT]\d{1,2}:\d{2}(?::\d{2})?)/);

            if (timeMatchEn) {
                let cleanT = timeMatchEn[1].replace(/\s+[A-Z]{3,4}$/, '').replace(/[\u202f\xa0]/g, ' ').trim();
                let dt = new Date(cleanT);
                if (!isNaN(dt.getTime())) ts = dt.getTime();
            } else if (timeMatchZh) {
                let rawZh = timeMatchZh[1];
                let isPm = rawZh.includes('下午');
                let cleanZh = rawZh.replace(/[年月日上下]/g, (m) => m === '年' || m === '月' ? '-' : (m === '日' ? ' ' : ''))
                                   .replace(/[\u202f\xa0]/g, ' ').replace(/\s+/g, ' ').trim();
                let dt = new Date(cleanZh);
                if (!isNaN(dt.getTime())) {
                    ts = dt.getTime() + (isPm ? 12 * 3600 * 1000 : 0);
                }
            } else if (timeMatchIso) {
                let dt = new Date(timeMatchIso[1].replace(/[\u202f\xa0]/g, ' '));
                if (!isNaN(dt.getTime())) ts = dt.getTime();
            }

            // 提取 AI 回答长文本与格式
            const contentCellMatch = block.match(/<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">([\s\S]*?)<\/div>/i);
            let responseHtml = '';
            if (contentCellMatch) {
                const rawCc = contentCellMatch[1];
                const parts = rawCc.split(/<br\s*\/?>|\n/);
                const respParts = [];
                let started = false;
                for (const p of parts) {
                    if (started) {
                        respParts.push(p);
                    } else if (/<p>|<pre>|<table>|<h1>|<h2>|<h3>|<ul>|<ol>|<strong>|<em>|<code>/i.test(p)) {
                        started = true;
                        respParts.push(p);
                    }
                }
                responseHtml = respParts.join('\n').trim();
            }

            const rawMediaMatches = block.match(/(?:src|href)=["']([^#"'>]+?)["']/gi) || [];
            const localMediaNames = [];
            for (const raw of rawMediaMatches) {
                const val = raw.replace(/^(?:src|href)=["']/, '').replace(/["']$/, '').trim();
                if (/^(?:https?:|\/\/|javascript:|mailto:|data:)/i.test(val) || /\.html?$/i.test(val)) continue;
                try {
                    const decoded = decodeURIComponent(val).replace(/^.*[\\\/]/, '').trim();
                    if (decoded && !localMediaNames.includes(decoded)) {
                        localMediaNames.push(decoded);
                    }
                } catch (e) {
                    const simpleName = val.replace(/^.*[\\\/]/, '').trim();
                    if (simpleName && !localMediaNames.includes(simpleName)) {
                        localMediaNames.push(simpleName);
                    }
                }
            }

            const turnMsgs = [];
            if (promptText) {
                turnMsgs.push({
                    role: 'user',
                    content: promptText,
                    timestamp: ts || Date.now()
                });
            }
            if (responseHtml) {
                turnMsgs.push({
                    role: 'model',
                    content: responseHtml,
                    timestamp: (ts ? ts + 2000 : Date.now())
                });
            }

            for (const cleanId of foundIds) {
                if (!__takeoutMediaMap[cleanId]) __takeoutMediaMap[cleanId] = [];
                for (const refName of localMediaNames) {
                    const refStem = refName.replace(/\.[^/.]+$/, '').toLowerCase();
                    for (const [path, fObj] of Object.entries(zip.files)) {
                        if (fObj.dir) continue;
                        const zipFilename = path.replace(/^.*[\\\/]/, '').trim();
                        const zipStem = zipFilename.replace(/\.[^/.]+$/, '').toLowerCase();
                        if (zipFilename === refName || zipStem === refStem || zipFilename.endsWith(refName) || (refStem.length > 5 && zipStem.includes(refStem))) {
                            if (!__takeoutMediaMap[cleanId].some(x => x.filename === zipFilename)) {
                                __takeoutMediaMap[cleanId].push({ filename: zipFilename, fileObj: fObj });
                            }
                        }
                    }
                }

                if (!__takeoutConvCache[cleanId]) {
                    __takeoutConvCache[cleanId] = {
                        id: cleanId,
                        title: promptText ? promptText.split('\n')[0].slice(0, 80) : 'Takeout conversation',
                        messages: [...turnMsgs],
                        timestamp: ts,
                        messageCount: turnMsgs.length,
                        source: 'takeout-offline'
                    };
                } else if (turnMsgs.length > 0) {
                    __takeoutConvCache[cleanId].messages.push(...turnMsgs);
                    __takeoutConvCache[cleanId].messageCount = __takeoutConvCache[cleanId].messages.length;
                }

                if (!extractedMap[cleanId]) {
                    extractedMap[cleanId] = {
                        id: cleanId,
                        title: promptText ? promptText.split('\n')[0].slice(0, 80) : 'Untitled conversation',
                        url: `https://gemini.google.com/app/${cleanId}`,
                        href: `https://gemini.google.com/app/${cleanId}`,
                        timestamp: ts,
                        lastSeen: ts ? new Date(ts).toISOString() : '',
                        accountSlot: currentSlot || 'u0',
                        source: 'takeout-import'
                    };
                } else {
                    if (promptText && (!extractedMap[cleanId].title || extractedMap[cleanId].title.startsWith('Untitled'))) {
                        extractedMap[cleanId].title = promptText.split('\n')[0].slice(0, 80);
                    }
                    if (ts && (!extractedMap[cleanId].timestamp || ts > extractedMap[cleanId].timestamp)) {
                        extractedMap[cleanId].timestamp = ts;
                        extractedMap[cleanId].lastSeen = new Date(ts).toISOString();
                    }
                }
            }
        }

        const takeoutList = Object.values(extractedMap);
        if (!takeoutList.length) {
            log('Takeout 中未解析到任何有效对话', 'warn');
            $('progWrap').style.display = 'none';
            return;
        }

        let existingMap = new Map();
        for (const c of conversations) {
            existingMap.set(normId(c.id).toLowerCase(), c);
        }

        let newAddedCount = 0;
        for (const item of takeoutList) {
            const nid = normId(item.id).toLowerCase();
            if (!existingMap.has(nid)) {
                existingMap.set(nid, item);
                newAddedCount++;
            } else {
                const exist = existingMap.get(nid);
                if ((!exist.title || exist.title.startsWith('Untitled')) && item.title && !item.title.startsWith('Untitled')) {
                    exist.title = item.title;
                }
                if (!exist.timestamp && item.timestamp) {
                    exist.timestamp = item.timestamp;
                    exist.lastSeen = item.lastSeen;
                }
            }
        }

        conversations = Array.from(existingMap.values());
        conversations.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        const slot = currentSlot || 'u0';
        const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
        const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;
        const syncKey = slot === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${slot}`;

        if (!accountSlots[slot]) {
            accountSlots[slot] = { name: slot === 'u0' ? '默认账号' : `账号 ${slot.toUpperCase()}`, count: conversations.length };
        } else {
            accountSlots[slot].count = conversations.length;
        }

        await chrome.storage.local.set({
            [convKey]: conversations,
            [countKey]: conversations.length,
            [syncKey]: new Date().toISOString(),
            gemini_account_slots: accountSlots
        });

        $('bar').style.width = '100%';
        const successMsg = typeof I18n !== 'undefined'
            ? I18n.t('takeoutSuccess', takeoutList.length, newAddedCount, totalMediaCount)
            : `Successfully imported ${takeoutList.length} chats (${newAddedCount} new) with ${totalMediaCount} offline assets ready!`;

        $('progText').textContent = successMsg;
        log(successMsg, 'info');

        __lastRenderedSignature = null;
        updateAccountSlotSelector();
        renderList(new Set());
        updateSelectedStat();

        setTimeout(() => {
            $('progWrap').style.display = 'none';
        }, 3000);

    } catch (err) {
        console.error('[Takeout Parse Error]', err);
        const errMsg = typeof I18n !== 'undefined' ? I18n.t('takeoutError', err.message) : `Takeout parse error: ${err.message}`;
        log(errMsg, 'error');
        $('progText').textContent = errMsg;
        $('progWrap').style.display = 'none';
    }
}

async function exportFullBackup() {
    try {
        const allData = await chrome.storage.local.get(null);
        const backupPayload = {
            app: 'gemini-exporter',
            version: 1,
            exportedAt: new Date().toISOString(),
            data: allData
        };
        const blob = new Blob([JSON.stringify(backupPayload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
        const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '');
        a.href = url;
        a.download = `gemini_exporter_backup_${dateStr}_${timeStr}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        log(typeof I18n !== 'undefined' ? I18n.t('backupSuccess') : 'Backup file downloaded successfully', 'info');
    } catch (err) {
        log(`备份失败: ${err.message}`, 'error');
    }
}

async function restoreFullBackup(file) {
    try {
        const text = await file.text();
        const payload = JSON.parse(text);
        const targetData = payload.data || payload;

        if (!targetData || (!targetData.gemini_conversations && !targetData.gemini_conversations_u0 && !targetData.exportedIds)) {
            alert('无效的备份文件格式！未找到有效的会话记录。');
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
        const msg = typeof I18n !== 'undefined'
            ? I18n.t('restoreSuccess', restoredCount)
            : `Successfully restored ${restoredCount} conversations!`;
        alert(msg);
        location.reload();
    } catch (err) {
        console.error('[Restore Error]', err);
        const errMsg = typeof I18n !== 'undefined' ? I18n.t('restoreFailed', err.message) : `Restore failed: ${err.message}`;
        alert(errMsg);
        log(errMsg, 'error');
    }
}