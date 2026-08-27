// options.js - Gemini Exporter workbench controller
let conversations = [];
let exportedIds = {};
let currentSlot = 'u0';
let accountSlots = {};

let __workbenchDebounceTimer = null;
let __lastRenderedSignature = '';
let __lastRenderTime = 0;
let __exportAborted = false;
let __globalTotalAssets = 0;
let __globalDownloadedAssets = 0;

function $(id) {
    return document.getElementById(id)
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms))
}

function setExportRunning(running) {
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
    if (format === 'json') {
        return {
            content: JSON.stringify(chat, null, 2),
            ext: 'json'
        };
    }
    if (format === 'json_openai') {
        let openaiFormat = (chat.messages || []).map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content || ''
        }));
        return {
            content: JSON.stringify(openaiFormat, null, 2),
            ext: 'json'
        };
    }
    if (format === 'json_raw') {
        return {
            content: JSON.stringify(chat._raw || chat, null, 2),
            ext: 'json'
        };
    }
    if (format === 'txt') {
        let txt = `${chat.title || chat.id}\n${'='.repeat(40)}\nID: ${chat.id}\nURL: ${chat.url || ''}\n\n`;
        if (!chat.messages || !chat.messages.length) {
            txt += '(空对话或取回失败)\n';
        }
        for (const m of chat.messages || []) {
            if (m.role === 'user') txt += `[你]:\n${m.content || ''}\n\n`;
            else txt += `[Gemini]:\n${m.content || ''}\n\n`;
            txt += '---\n\n';
        }
        return {
            content: txt,
            ext: 'txt'
        };
    }
    // default: markdown
    return {
        content: toMarkdown(chat),
        ext: 'md'
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
    for (const s of sorted) {
        const info = accountSlots[s];
        const label = info?.name || (s === 'u0' ? '默认账号 (u0)' : `账号 ${s.toUpperCase()}`);
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

async function loadStore(forceQuiet = false) {
    console.log('[workbench] loadStore called', 'forceQuiet', forceQuiet, 'prevLen', conversations.length, 'slot', currentSlot);
    try {
        const slot = currentSlot || 'u0';
        const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
        const syncKey = slot === 'u0' ? 'gemini_last_sync' : `gemini_last_sync_${slot}`;
        const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
        const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;

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
            const u0Data = await chrome.storage.local.get(['gemini_conversations']);
            if (u0Data.gemini_conversations && u0Data.gemini_conversations.length) {
                console.log('[workbench] Slot', slot, 'is empty but u0 has', u0Data.gemini_conversations.length, 'chats. Falling back to u0.');
                currentSlot = 'u0';
                slot = 'u0';
                convKey = 'gemini_conversations';
                incoming = u0Data.gemini_conversations;
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
        // 保留当前勾选 - robust handling of empty set
        let prevSelectedRaw = [];
        try {
            prevSelectedRaw = getSelectedSafe().map(x => x.id);
        } catch (e) {
            prevSelectedRaw = [];
        }
        const prevSelected = new Set(prevSelectedRaw);
        const hadLength = conversations.length;
        exportedIds = data[expKey] || {};
        const incomingSig = getSignature(incoming);
        const sameSig = (incomingSig === __lastRenderedSignature && incoming.length === conversations.length && conversations.length > 0);
        // If signature same and within 500ms of last render, skip render to stop flash
        if (sameSig && Date.now() - __lastRenderTime < 500) {
            const lastSyncElFast = $('lastSync');
            if (lastSyncElFast && data[syncKey]) {
                lastSyncElFast.textContent = `最后 sync: ${new Date(data[syncKey]).toLocaleString()} | 共 ${incoming.length} 条`;
            }
            return;
        }
        conversations = incoming;
        const same = (hadLength === conversations.length);
        const lastSyncEl = $('lastSync');
        if (lastSyncEl) {
            lastSyncEl.textContent = data[syncKey] ? `最后 sync: ${new Date(data[syncKey]).toLocaleString()} | 共 ${conversations.length} 条` : (conversations.length ? `共 ${conversations.length} 条 (无时间戳)` : '');
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
                dedupMap.set(normId, { ...old, ...c, id: normId });
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
            if (!valA && a.lastSeen) valA = new Date(a.lastSeen).getTime();
            if (!valB && b.lastSeen) valB = new Date(b.lastSeen).getTime();
            return valB - valA;
        });
        if (_badIds.length || conversations.length !== incoming.length) {
            console.log('[workbench] 清理脏对话与合并重复项', incoming.length, '->', conversations.length);
            await chrome.storage.local.set({
                [convKey]: conversations,
                [countKey]: conversations.length,
                [syncKey]: new Date().toISOString()
            });
        }
        const syncCountEl = $('syncCount');
        if (syncCountEl) syncCountEl.textContent = `已同步 ${conversations.length} 条`;
        console.log('[workbench] loadStore conversations', conversations.length, 'same?', same, 'sigSame?', sameSig, 'prevSelected size', prevSelected.size);
        renderList(prevSelected);
        __lastRenderedSignature = incomingSig;
        __lastRenderTime = Date.now();
        updateSelectedStat();
        if (!forceQuiet && !same) {
            log(`已加载 ${conversations.length} 条对话 (已导出 ${Object.keys(exportedIds).length} 条)`);
        }
        // storage 空时被动拉取 - only if truly empty
        if (conversations.length === 0) {
            console.log('[workbench] conversations empty, trying to pull from Gemini tab');
            try {
                const tab = await findTabForSlot(slot);
                if (tab) {
                    log('正在同步会话列表…');
                    const tryViaMessage = () => new Promise(resolve => {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'getLinks'
                        }, (res) => {
                            if (chrome.runtime.lastError) {
                                resolve({
                                    ok: false,
                                    err: chrome.runtime.lastError.message
                                });
                                return;
                            }
                            resolve({
                                ok: true,
                                res
                            });
                        });
                    });
                    (async () => {
                        let r = await tryViaMessage();
                        if (r.ok && r.res && r.res.links && r.res.links.length) {
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'resync'
                            }, (r2) => {
                                if (chrome.runtime.lastError) {
                                    log('同步失败: ' + chrome.runtime.lastError.message);
                                    return;
                                }
                                setTimeout(loadStore, 900);
                            });
                            return;
                        }
                        console.log('[workbench] getLinks via msg failed/empty', r);
                        try {
                            let results = await chrome.scripting.executeScript({
                                target: {
                                    tabId: tab.id
                                },
                                func: () => {
                                    try {
                                        if (window.__gemExporterGetLinks) {
                                            return window.__gemExporterGetLinks();
                                        }
                                        // fallback minimal scan
                                        return [...document.querySelectorAll('a[href*=\"/app/\"]')].map(a => {
                                            let href = a.getAttribute('href') || a.href || '';
                                            let m = href.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
                                            if (!m) return null;
                                            let id = (m[2] || m[1] || '').replace(/^c_/, '');
                                            if (!id) return null;
                                            return {
                                                id,
                                                title: (a.textContent || '').trim().slice(0, 80),
                                                href: href.startsWith('http') ? href.split('?')[0] : 'https://gemini.google.com' + href.split('?')[0],
                                                url: href.startsWith('http') ? href.split('?')[0] : 'https://gemini.google.com' + href.split('?')[0]
                                            };
                                        }).filter(Boolean).filter((v, i, arr) => arr.findIndex(x => x.id === v.id) === i);
                                    } catch (e) {
                                        return {
                                            error: e.message
                                        };
                                    }
                                }
                            });
                            let links = results && results[0] && results[0].result;
                            if (links && Array.isArray(links) && links.length) {
                                log(`已同步 ${links.length} 条对话`);
                                console.log('[workbench] executeScript links', links.length);
                                const now = new Date().toISOString();
                                let toSave = links.map(c => ({
                                    ...c,
                                    lastSeen: now,
                                    source: 'scripting-fallback'
                                }));
                                await chrome.storage.local.set({
                                    gemini_conversations: toSave,
                                    gemini_last_count: toSave.length,
                                    gemini_last_sync: now
                                });
                                setTimeout(loadStore, 500);
                            } else if (links && links.error) {
                                log(`同步失败: ${links.error}`);
                            } else {
                                log('未获取到会话，请确保 Gemini 页面侧边栏已展开');
                            }
                        } catch (ex) {
                            log(`同步异常: ${ex.message}，请刷新 Gemini 页面重试`);
                            console.error('[workbench] scripting fallback err', ex);
                        }
                    })();
                } else {
                    log('未找到 Gemini 标签页，请先打开 gemini.google.com');
                }
            } catch (e) {
                log('自动同步异常: ' + e.message);
                console.error('[workbench] auto pull err', e);
            }
        }
    } catch (e) {
        console.error('[workbench] loadStore fatal err', e);
        log('数据加载异常: ' + e.message);
    }
}

function renderList(prevSelectedSet) {
    const list = $('list');
    if (!list) {
        console.warn('[workbench] no #list');
        return;
    }
    if (!conversations.length) {
        console.log('[workbench] renderList empty -> placeholder');
        list.innerHTML = typeof I18n !== 'undefined' ? I18n.t('emptyList') : 'No conversations found.';
        return;
    }
    console.log('[workbench] renderList', conversations.length, 'prevSelectedSet', prevSelectedSet instanceof Set ? prevSelectedSet.size : 'notSet');
    // FIX: never early return when prevSelectedSet empty - that's the 16 vs 0 bug.
    // prevSelectedSet empty means first load: should show all, checked = true by default.
    const bNeedsReexport = typeof I18n !== 'undefined' ? I18n.t('badgeNeedsReexport') : 'Needs re-export';
    const bExported = typeof I18n !== 'undefined' ? I18n.t('badgeExported') : 'Exported';
    const bNew = typeof I18n !== 'undefined' ? I18n.t('badgeNew') : 'New';

    list.innerHTML = conversations.map((c, i) => {
        const rec = exportedIds[c.id];
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
            if (prevSelectedSet.size === 0) {
                checked = true;
            } else {
                checked = prevSelectedSet.has(c.id);
            }
        }
        let badge = '';
        if (isUpdated) badge = `<span class="badge" style="background:#3a2f1d;border-color:#5a4a2a;color:#f0c87a">${bNeedsReexport}</span>`;
        else if (isExported) badge = `<span class="badge" style="background:#1d3a2a;border-color:#2a5a3a;color:#8ae6b0">${bExported}</span>`;
        else badge = `<span class="badge" style="background:#181a29;border-color:#282c44;color:#a5b4fc">${bNew}</span>`;
        let rawTs = c.timestamp;
        if (typeof rawTs === 'string') rawTs = new Date(rawTs).getTime();
        if (!rawTs && c.lastSeen) rawTs = new Date(c.lastSeen).getTime();
        const dateStr = rawTs ? new Date(rawTs).toLocaleDateString() : '';
        return `<label class="item"><input type="checkbox" data-idx="${i}" ${checked?'checked':''}><div class="title"><div>${safeTitle} ${badge}</div><div class="meta">${c.id} | <a href="${c.url||c.href||'https://gemini.google.com/app/'+c.id}" target="_blank">Open</a> | ${dateStr}</div></div></label>`;
    }).join('');
    list.querySelectorAll('input[type=checkbox]').forEach(cb => cb.addEventListener('change', updateSelectedStat));
}

function updateSelectedStat() {
    const checks = [...document.querySelectorAll('#list input[type=checkbox]:checked')];
    const total = conversations.length;
    const selEl = $('selectedStat');
    if (selEl) {
        selEl.textContent = typeof I18n !== 'undefined' ? I18n.t('selectedStat', checks.length, total, total * 3) : `Selected: ${checks.length} / ${total}`;
    }
    console.log('[workbench] selected', checks.length, '/', total);
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
}

function renderLog() {
    const l = $('log');
    if (!l) return;
    const lv = $('logLevel')?.value || 'all';
    const q = ($('logFilter')?.value || '').trim().toLowerCase();
    let lines = __logBuf;
    if (lv !== 'all') lines = lines.filter(x => x.level === lv);
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
}

function getSelectedSafe() {
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

function getSelected() {
    return getSelectedSafe();
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
    if (!window.showDirectoryPicker) throw new Error('浏览器不支持 showDirectoryPicker');
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
        label.textContent = __globalDirHandle ? `当前目录: ${__globalDirHandle.name}` : '未设置目录';
    }
}

function sanitizeFileName(name, fallback = 'untitled') {
    if (!name) return fallback;
    let s = String(name).replace(/[\r\n]+/g, ' ').replace(/[\u0000-\u001F\u007F]/g, '_');
    s = s.replace(/[<>:"/\\|?*]+/g, '_');
    s = s.replace(/^\.+|\.+$/g, '');
    s = s.trim();
    if (!s) return fallback;
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
        alert('未选中任何会话');
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
    $('progText').textContent = '准备中…';

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

    function updateSharedProgress() {
        $('progText').textContent = `完成 ${landedChats}/${payloadIds.length} | 附件 ${downloadedAssets}/${__globalTotalAssets||totalAssets}`;
    }

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

        for (const chat of chunkResults) {
            if (__exportAborted) break;
            totalAssets += chat.attachmentCount || 0;
            __globalTotalAssets = totalAssets;
            let {
                content,
                ext
            } = mdContent(chat);
            const listC = conversations.find(c => c.id === chat.id) || null;
            const listTitle = listC?.title || chat.title || chat.id;
            const prevExportedAt = curIds[chat.id]?.exportedAt || null;
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
                    curIds[chat.id] = {
                        title: listTitle,
                        exportedAt: new Date().toISOString(),
                        messageCount: chat.messageCount || chat.messages?.length || 0,
                        chatTime: exportTs,
                        status: 'ok'
                    };
                    chrome.storage.local.set({
                        [expKey]: curIds
                    }).catch(() => {});
                }
            } else {
                failedChats.push(chat.id);
            }
            updateSharedProgress();

            if (includeAssets && chat.messages && writeOk) {
                for (const m of chat.messages) {
                    if (!m.attachments) continue;

                    for (const att of m.attachments) {
                        if (att.type !== 'file') continue;
                        if (att.contentMarkdown) {
                            if (finalUseZip) {
                                try {
                                    folder.file(att.localName, att.contentMarkdown);
                                } catch {}
                            } else {
                                attachmentQueue.push(async () => await writeFileDirect(att.localName || `${safeBase}_${chat.id.slice(-6)}.md`, att.contentMarkdown));
                            }
                            continue;
                        }

                        attachmentQueue.push(async () => {
                            let saved = false;
                            let failReason = '';
                            try {
                                let tabs = await chrome.tabs.query({
                                    url: 'https://gemini.google.com/*'
                                });
                                if (tabs.length) {
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
                                        chrome.tabs.sendMessage(tabs[0].id, {
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
                            if (!saved) {
                                failedAttachments.push({
                                    chat: listTitle,
                                    file: att.name || att.title || att.localName,
                                    reason: failReason || 'unknown'
                                });
                                log(`附件下载失败: ${att.name || att.localName} (${failReason})`);
                            }
                        });
                    }

                    for (const att of m.attachments) {
                        if (att.type !== 'image' || !att.src) continue;

                        attachmentQueue.push(async () => {
                            try {
                                let toHighRes = (u) => {
                                    try {
                                        let parts = u.split('?');
                                        let base = parts[0].replace(/=s\d+(?:-[^\?]+)*/i, '');
                                        let q = parts[1] ? parts[1] + '&alr=yes' : 'alr=yes';
                                        return base + '=s1024-rj?' + q;
                                    } catch {
                                        return u;
                                    }
                                };
                                let cands = [toHighRes(att.src), att.src, att.originalUrl].filter(Boolean);
                                cands = [...new Set(cands)];

                                let bin = null;
                                let lastStatus = '';

                                let tabs = await chrome.tabs.query({
                                    url: 'https://gemini.google.com/*'
                                });
                                if (tabs.length) {
                                    let r2 = await new Promise(rv => {
                                        chrome.tabs.sendMessage(tabs[0].id, {
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

                                if (!bin) {
                                    let reason = `all ${cands.length} candidates failed: ${lastStatus}`;
                                    failedAttachments.push({
                                        chat: listTitle,
                                        file: att.localName || att.alt,
                                        reason
                                    });
                                    log(`图片下载失败: ${att.localName || '未知'}`);
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
                                log(`图片下载失败: ${att.localName || '未知'}`);
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
    }

    isFetchingDone = true;
    if (attachmentQueue.length > 0) {
        let pt = document.getElementById('progText');
        if (pt) pt.textContent += ' (正在下载剩余附件…)';
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

    if (finalUseZip) {
        log('正在生成 ZIP 压缩包，请稍候…');
        try {
            const content = await zip.generateAsync({
                type: 'blob'
            });
            const url = URL.createObjectURL(content);
            const zName = exportFolderName + '.zip';
            if (chrome.downloads && chrome.downloads.download) {
                chrome.downloads.download({
                    url: url,
                    filename: zName,
                    saveAs: true
                }, () => {
                    URL.revokeObjectURL(url);
                    log('ZIP 打包完成，已开始下载');
                });
            } else {
                const a = document.createElement('a');
                a.href = url;
                a.download = zName;
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                log('ZIP 打包完成，已开始下载');
            }
        } catch (e) {
            log(`ZIP 生成失败: ${e.message}`);
        }
    } else {
        log(`导出完成，实际保存 ${landedChats} 条对话、${downloadedAssets} 个附件到 ${dirHandle.name}`);
    }

    if (failedChats.length) {
        log(`⚠️ 有 ${failedChats.length} 条对话导出失败`);
        console.error('Failed ids:', failedChats);
    }
    if (failedAttachments.length) {
        log(`⚠️ 有 ${failedAttachments.length} 个附件下载失败：`);
        for (const fa of failedAttachments.slice(0, 30)) {
            log(`  • [${fa.chat}] ${fa.file} - ${fa.reason}`, 'error');
        }
        if (failedAttachments.length > 30) log(`  ... 还有 ${failedAttachments.length - 30} 个未列出`);
        console.error('Failed attachments JSON:', JSON.stringify(failedAttachments, null, 2));
    }

    $('bar').style.width = '100%';
    $('progText').textContent = `完成 ${landedChats} 条，附件 ${downloadedAssets}/${totalAssets}${failedAttachments.length? ` (失败${failedAttachments.length})`:''}，跳过 ${skipped} 条`;
    $('btnExport').disabled = false;
    setExportRunning(false);
    chrome.runtime.sendMessage({
        action: 'exportProgress',
        done: metaResults.length,
        total: metaResults.length,
        title: '全部完成'
    });
}



function toMarkdown(chat) {
    if (chat.error) return `# ${chat.title}\n\n> 导出失败: ${chat.error}\n\n> ID: ${chat.id} | URL: ${chat.url}\n`;
    let md = `# ${chat.title}\n\n> ID: ${chat.id} | 导出: ${new Date().toLocaleString()} | 来源: ${chat.url}`;
    if (chat.attachmentCount) md += ` | 附件: ${chat.attachmentCount} 个`;
    md += `\n\n---\n\n`;
    if (!chat.messages || !chat.messages.length) md += `_空对话或取回失败_ 原始URL: ${chat.url}\n`;
    for (const m of chat.messages || []) {
        if (m.role === 'user') md += `## 🙋 你\n\n${m.content||''}\n\n`;
        else md += `## 🤖 Gemini\n\n${m.content||''}\n\n`;
        if (m.attachments && m.attachments.length) {
            for (const att of m.attachments) {
                if (att.type === 'image') {
                    const local = att.localName || `assets/img.png`;
                    if (att.isBlob) md += `> ![${att.alt||'图片'}](${local}) (blob 原链接需 content-script 转存)\n\n`;
                    else md += `![${att.alt||'图片'}](${local}) <!-- ${att.src.slice(0,110)} -->\n\n`;
                } else if (att.type === 'file') {
                    const local = att.localName || `files/${att.name}`;
                    if (att.url) md += `- 📎 [${att.name}](${local}) (原: ${att.url.slice(0,90)})\n`;
                    else md += `- 📎 ${att.name} (上传文件)\n`;
                }
            }
            md += `\n`;
        }
        if (m.role === 'model') md += `---\n\n`;
    }
    return md;
}

// 监听 background 进度 - debounce to prevent workbench flashing on deep scan
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const slot = currentSlot || 'u0';
    const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
    const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;
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
        if (pt) pt.textContent = msg.title || `正在同步 (${msg.count || msg.done} 条)…`;
        return;
    }
    if (msg.action === 'exportProgress') {
        const progWrap = $('progWrap');
        if (progWrap) progWrap.style.display = 'block';
        const pct = msg.total ? Math.floor((msg.done / msg.total) * 100) : 0;
        let bar = $('bar');
        if (bar) bar.style.width = pct + '%';
        let pt = $('progText');
        if (pt) pt.textContent = msg.title ? `[${msg.done}/${msg.total}] ${msg.title}` : `进度 ${msg.done}/${msg.total}`;
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
            updateZipUi();
            const currentSelected = new Set(getSelectedSafe().map(x => x.id));
            renderList(currentSelected);
            if (listEl) listEl.scrollTop = savedScroll;
            updateSelectedStat();
        }
    });
    $('btnSelectAll').addEventListener('click', () => {
        document.querySelectorAll('#list input[type=checkbox]').forEach(c => c.checked = true);
        updateSelectedStat();
    });
    $('btnSelectNone').addEventListener('click', () => {
        document.querySelectorAll('#list input[type=checkbox]').forEach(c => c.checked = false);
        updateSelectedStat();
    });
    $('logFilter')?.addEventListener('input', renderLog);
    $('logLevel')?.addEventListener('change', renderLog);
    $('btnClearLog')?.addEventListener('click', clearLog);
    $('btnExportDiag')?.addEventListener('click', async () => {
        try {
            const data = await chrome.storage.local.get(['gemini_last_sync_diagnostics']);
            const diag = data.gemini_last_sync_diagnostics;
            if (!diag) {
                alert('暂无诊断数据，请先点击「同步最新会话」或「全量拉取历史」');
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
            $('progText').textContent = '正在终止同步…';
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
            $('progText').textContent = '正在同步最新会话…';
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
                    $('progText').textContent = '失败: ' + chrome.runtime.lastError.message;
                    return;
                }
                log('同步完成，已更新列表');
                $('bar').style.width = '100%';
                $('progText').textContent = '完成，已同步 ' + (res?.totalMerged || res?.count || '未知') + ' 条';
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
            $('progText').textContent = '正在全量拉取历史…';
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
                    $('progText').textContent = '失败: ' + chrome.runtime.lastError.message;
                    console.error('[workbench] deepScan err', chrome.runtime.lastError);
                    return;
                }
                log('全量拉取完成，已更新列表');
                $('bar').style.width = '100%';
                $('progText').textContent = '完成，已同步 ' + (res?.totalMerged || res?.count || '未知') + ' 条';
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
        renderList(new Set());
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

    console.log('[workbench] loadStore initial trigger done');
});

// Manual test helper exposed for task requirement
window.__workbenchDump = async () => {
    const d = await chrome.storage.local.get(['gemini_conversations', 'gemini_last_count', 'gemini_last_sync']);
    console.log('STORAGE_DUMP workbench', d.gemini_conversations?.length, d.gemini_last_count);
    return d;
};