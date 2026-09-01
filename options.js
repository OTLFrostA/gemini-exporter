// options.js - Gemini Exporter workbench UI controller (Layered Architecture)
(function() {
    'use strict';

    function $(id) {
        return document.getElementById(id);
    }

    // Module References (with safe fallbacks)
    const Store = (typeof ConversationsStore !== 'undefined') ? ConversationsStore : null;
    const List = (typeof ListView !== 'undefined') ? ListView : null;
    const Log = (typeof LogView !== 'undefined') ? LogView : null;
    const Controller = (typeof ExportController !== 'undefined') ? ExportController : null;
    const Formats = (typeof FormatStore !== 'undefined') ? FormatStore : null;
    const Storage = (typeof StorageService !== 'undefined') ? StorageService : ((typeof window !== 'undefined' && window.StorageService) || null);

    const normId = id => String(id || '').replace(/^c_/, '');

    const isRealTitle = (typeof globalThis.GeminiUtils !== 'undefined' && typeof globalThis.GeminiUtils.isRealTitle === 'function')
        ? globalThis.GeminiUtils.isRealTitle
        : (typeof globalThis.isRealTitle === 'function'
            ? globalThis.isRealTitle
            : function isRealTitle(title, id) {
                if (!title || typeof title !== 'string') return false;
                let t = title.trim();
                if (!t || t.length < 2) return false;
                if (t === 'Untitled' || t === '未命名' || t === 'New chat' || t === '新对话') return false;
                if (id) {
                    let cleanId = String(id).replace(/^c_/, '').trim();
                    let cleanT = t.replace(/^c_/, '').trim();
                    if (cleanT === cleanId) return false;
                    if (cleanT.startsWith('未命名对话(') || cleanT.startsWith('Untitled(')) return false;
                    if (cleanT === 'c_' + cleanId || cleanId === 'c_' + cleanT) return false;
                }
                if (/^(未命名对话|Untitled conversation|Untitled|Document|Gemini|New chat|新对话|Search|搜索)$/i.test(t)) return false;
                if (/^Google Account/i.test(t)) return false;
                if (/^[a-f0-9_-]{8,64}$/i.test(t)) return false;
                if (/^[0-9a-f]{16}$/i.test(t) || /^c_[0-9a-f]{16}$/i.test(t)) return false;
                if (/^(?:我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i.test(t)) return false;
                return true;
            });

    const cleanTitle = (t) => {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle) return GeminiUtils.cleanTitle(t);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.cleanTitle) return globalThis.GeminiUtils.cleanTitle(t);
        } catch {}
        if (!t || typeof t !== 'string') return '';
        let s = t.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(s)) return '';
        s = s.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
        s = s.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
        s = s.trim();
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI)$/i.test(s)) return '';
        return s;
    };

    const resolveTitle = (typeof GeminiUtils !== 'undefined' && GeminiUtils.resolveTitle)
        ? GeminiUtils.resolveTitle
        : ((typeof globalThis.GeminiUtils !== 'undefined' && globalThis.GeminiUtils.resolveTitle)
            ? globalThis.GeminiUtils.resolveTitle
            : (chat) => ({ title: cleanTitle(chat?.title) || '未命名对话', source: chat?.titleSource || 'legacy' }));

    let __workbenchDebounceTimer = null;
    let __lastRenderedSignature = '';
    let __lastRenderTime = 0;
    let __chatSearchFilter = '';
    let __globalDirHandle = null;

    // Logging helper
    function log(msg, level = 'info') {
        if (Log && Log.log) Log.log(msg, level);
        else console.log(`[${level}] ${msg}`);
    }

    function clearLog() {
        if (Log && Log.clear) Log.clear();
    }

    function renderLog() {
        if (Log && Log.render) Log.render();
    }

    // Account selector
    function updateAccountSlotSelector() {
        const sel = $('accountSlotSelect');
        if (!sel) return;
        const accountSlots = Store ? Store.getAccountSlots() : {};
        const currentSlot = Store ? Store.getCurrentSlot() : 'u0';
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

    // Store & List Loader
    async function loadStore(force = false) {
        try {
            window.__workbenchLoadStore = loadStore;
            if (!Store) return;
            const slot = Store.getCurrentSlot() || 'u0';
            const { conversations: incoming, exportedIds, accountSlots } = await Store.loadStore(slot);
            updateAccountSlotSelector();

            let prevSelected = null;
            try {
                if (List && Store.getConversations().length > 0) {
                    prevSelected = List.getSelectedIds();
                }
            } catch {
                prevSelected = null;
            }

            const syncInfo = await Store.getLastSync(slot);
            const lastSyncVal = syncInfo.timestamp;

            const incomingSig = Store.getSignature(incoming);
            const currentList = Store.getConversations();
            const sameSig = (incomingSig === __lastRenderedSignature && incoming.length === currentList.length && currentList.length > 0);

            if (!force && sameSig && Date.now() - __lastRenderTime < 500) {
                const lastSyncElFast = $('lastSync');
                if (lastSyncElFast && lastSyncVal) {
                    const syncFmtFast = typeof I18n !== 'undefined'
                        ? I18n.t('lastSync', new Date(lastSyncVal).toLocaleString(), incoming.length)
                        : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${incoming.length}`;
                    lastSyncElFast.textContent = syncFmtFast;
                }
                return;
            }

            // Deduplicate and sanitize titles with resolveTitle
            const dedupMap = new Map();
            let hasDirtyTitles = false;
            (incoming || []).forEach(c => {
                if (!c || !c.id) return;
                const nid = normId(c.id);
                const u = (c.url || c.href || '').toString();
                if (/accounts\.google\.com|SignOutOptions/i.test(u)) return;

                const old = dedupMap.get(nid);
                const mergedTitles = { ...(old?.titles || {}), ...(c.titles || {}) };
                if (c.titleSource && c.title) {
                    const cleanT = cleanTitle(c.title);
                    if (cleanT && (isRealTitle(cleanT, nid) || c.titleSource === 'takeout')) {
                        mergedTitles[c.titleSource] = cleanT;
                    }
                } else if (c.title && !mergedTitles.legacy && !mergedTitles.rpc && !mergedTitles.dom && !mergedTitles.takeout) {
                    const cleanT = cleanTitle(c.title);
                    if (cleanT && isRealTitle(cleanT, nid)) {
                        mergedTitles.legacy = cleanT;
                    }
                }

                const tempChat = {
                    id: nid,
                    titles: mergedTitles,
                    title: c.title || old?.title,
                    titleSource: c.titleSource || old?.titleSource
                };

                const resolved = resolveTitle(tempChat);
                if (c.title !== resolved.title || c.titleSource !== resolved.source) hasDirtyTitles = true;

                c.id = nid;
                c.titles = mergedTitles;
                c.title = resolved.title;
                c.titleSource = resolved.source;

                if (!dedupMap.has(nid)) {
                    dedupMap.set(nid, c);
                } else {
                    dedupMap.set(nid, {
                        ...old,
                        ...c,
                        id: nid,
                        titles: mergedTitles,
                        title: resolved.title,
                        titleSource: resolved.source
                    });
                }
            });

            const processed = Array.from(dedupMap.values());
            if (hasDirtyTitles && Storage) {
                // Auto-scrub historical dirty titles in storage
                Storage.setConversations(slot, processed).catch(() => {});
            }

            processed.sort((a, b) => {
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

            Store.setConversations(processed);

            const lastSyncEl = $('lastSync');
            if (lastSyncEl) {
                if (lastSyncVal) {
                    lastSyncEl.textContent = typeof I18n !== 'undefined'
                        ? I18n.t('lastSync', new Date(lastSyncVal).toLocaleString(), processed.length)
                        : `Last sync: ${new Date(lastSyncVal).toLocaleString()} | Total: ${processed.length}`;
                } else {
                    lastSyncEl.textContent = processed.length ? (typeof I18n !== 'undefined' ? I18n.t('selectedStat', 0, processed.length) : `${processed.length} total`) : '';
                }
            }

            const syncCountEl = $('syncCount');
            if (syncCountEl && processed.length) {
                syncCountEl.textContent = typeof I18n !== 'undefined' ? I18n.t('syncedBadge', processed.length) : `Synced: ${processed.length}`;
            }

            if (List) {
                List.render(processed, exportedIds, prevSelected, __chatSearchFilter);
                List.updateStat(processed);
            }

            __lastRenderedSignature = Store.getSignature(processed);
            __lastRenderTime = Date.now();
            checkExportSession();
        } catch (e) {
            console.error('[workbench] loadStore error', e);
        }
    }

    async function checkExportSession() {
        try {
            // If an export task is actively running in memory, never show recovery banner
            if (Controller && Controller.isRunning()) {
                const banner = $('exportSessionBanner');
                if (banner) banner.style.display = 'none';
                return;
            }

            const { gemini_last_export_session: session } = await chrome.storage.local.get(['gemini_last_export_session']);
            const banner = $('exportSessionBanner');
            const bannerText = $('exportSessionText');
            if (!banner || !bannerText) return;

            if (!session || !session.total) {
                banner.style.display = 'none';
                return;
            }

            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (session.slot && session.slot !== slot) {
                banner.style.display = 'none';
                return;
            }

            const remaining = Math.max(0, session.total - (session.current || 0));

            if (session.status === 'running' || session.status === 'interrupted' || session.status === 'aborted') {
                if (remaining <= 0) {
                    banner.style.display = 'none';
                    return;
                }
                banner.style.display = 'flex';
                banner.style.borderColor = '#f59e0b';
                banner.style.background = '#221c12';
                let msg = typeof I18n !== 'undefined'
                    ? I18n.t('exportSessionInterrupted', session.total, session.current || 0, remaining)
                    : `⚠️ <b>发现未完成的导出任务</b>：共 ${session.total} 条，已处理 ${session.current || 0} 条，剩余 ${remaining} 条未导出。`;
                if (session.lastChatTitle) {
                    msg += typeof I18n !== 'undefined'
                        ? I18n.t('exportSessionLastChat', session.lastChatTitle.slice(0, 20))
                        : ` (上次停在: 「${session.lastChatTitle.slice(0, 20)}」)`;
                }
                bannerText.innerHTML = msg;
                if ($('btnResumeExport')) $('btnResumeExport').style.display = remaining > 0 ? '' : 'none';
            } else if (session.status === 'completed' || session.status === 'completed_with_errors') {
                const timeDiff = Date.now() - (session.updatedAt || 0);
                if (timeDiff < 300000) {
                    banner.style.display = 'flex';
                    banner.style.borderColor = session.failedCount > 0 ? '#f59e0b' : '#10b981';
                    banner.style.background = session.failedCount > 0 ? '#221c12' : '#0e231b';
                    let baseDone = typeof I18n !== 'undefined'
                        ? I18n.t('exportSessionCompleted', session.current || session.total)
                        : `✅ <b>上次导出已完成</b>：共导出 ${session.current || session.total} 条会话`;
                    if (session.failedCount > 0) {
                        baseDone += typeof I18n !== 'undefined'
                            ? I18n.t('exportSessionCompletedWithErrors', session.failedCount)
                            : ` (其中 ${session.failedCount} 条失败)`;
                    }
                    bannerText.innerHTML = baseDone;
                    if ($('btnResumeExport')) $('btnResumeExport').style.display = 'none';
                } else {
                    banner.style.display = 'none';
                }
            } else {
                banner.style.display = 'none';
            }
        } catch (e) {
            console.debug('[workbench] checkExportSession error', e);
        }
    }

    function debouncedLoadStore(quiet = true) {
        if (__workbenchDebounceTimer) clearTimeout(__workbenchDebounceTimer);
        __workbenchDebounceTimer = setTimeout(() => {
            __workbenchDebounceTimer = null;
            loadStore(quiet);
        }, 400);
    }

    // Directory Handle IndexedDB
    const IDB_NAME = 'gemini_exporter_idb';
    const IDB_STORE = 'handles';
    const IDB_KEY = 'export_dir_handle';

    function openHandleDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(IDB_STORE)) {
                    db.createObjectStore(IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function saveStoredDirHandle(handle) {
        try {
            const db = await openHandleDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('Failed to save dir handle to IndexedDB:', e);
            return false;
        }
    }

    async function getStoredDirHandle() {
        try {
            const db = await openHandleDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } catch (e) {
            console.warn('Failed to get dir handle from IndexedDB:', e);
            return null;
        }
    }

    async function verifyDirPermission(handle) {
        if (!handle) return false;
        try {
            const opts = { mode: 'readwrite' };
            if ((await handle.queryPermission(opts)) === 'granted') return true;
            if ((await handle.requestPermission(opts)) === 'granted') return true;
            return false;
        } catch {
            return false;
        }
    }

    async function restoreSavedDirHandle() {
        try {
            const handle = await getStoredDirHandle();
            if (handle) {
                __globalDirHandle = handle;
                const dirLabel = $('dirLabel');
                if (dirLabel) dirLabel.textContent = typeof I18n !== 'undefined' ? I18n.t('dirCurrent', handle.name) : `已选目录: ${handle.name}`;
                log(typeof I18n !== 'undefined' ? I18n.t('logDirRestored', handle.name) : `已恢复保存的导出目录: ${handle.name}`);
            }
        } catch (e) {
            console.warn('Failed to restore dir handle:', e);
        }
    }

    async function requestDirHandle() {
        if (!window.showDirectoryPicker) {
            throw new Error(typeof I18n !== 'undefined' ? I18n.t('browserNoDirPicker') : '当前浏览器不支持 FileSystem Access API 目录选择');
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        __globalDirHandle = handle;
        await saveStoredDirHandle(handle);
        const dirLabel = $('dirLabel');
        if (dirLabel) dirLabel.textContent = typeof I18n !== 'undefined' ? I18n.t('dirCurrent', handle.name) : `已选目录: ${handle.name}`;
        log(typeof I18n !== 'undefined' ? I18n.t('logFolderSelected', handle.name) : `已选择保存目录: ${handle.name}`);
        return handle;
    }

    // Export Action
    async function exportSelected() {
        const convs = Store ? Store.getConversations() : [];
        const selected = List ? List.getSelected(convs) : [];
        if (!selected.length) {
            const noSelMsg = typeof I18n !== 'undefined' ? I18n.t('noSelection') : 'Please select at least one conversation!';
            log(noSelMsg, 'warn');
            if ($('progText')) $('progText').textContent = noSelMsg;
            return;
        }

        const format = Formats ? Formats.getFormatFromSelect($('format')) : ($('format')?.value || 'markdown');
        const skip = $('skipExported')?.checked || false;
        const includeIndex = $('includeIndex')?.checked || false;
        const includeAssets = $('includeAssets') ? $('includeAssets').checked : true;
        const includeZip = $('includeZip') ? $('includeZip').checked : true;

        let dirHandle = null;
        if (!includeZip) {
            try {
                if (__globalDirHandle) {
                    const ok = await verifyDirPermission(__globalDirHandle);
                    if (ok) dirHandle = __globalDirHandle;
                    else dirHandle = await requestDirHandle();
                } else {
                    dirHandle = await requestDirHandle();
                }
            } catch (e) {
                log(typeof I18n !== 'undefined' ? I18n.t('logExportZipSwitched', e.message) : `已切换为导出为 ZIP: ${e.message}`);
                if ($('includeZip')) $('includeZip').checked = true;
            }
        }

        const finalUseZip = $('includeZip') ? $('includeZip').checked : true;
        if (!finalUseZip && !dirHandle) return;

        $('progWrap').style.display = 'block';
        $('bar').style.width = '0%';
        $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('progPreparing') : 'Preparing...';

        const slot = Store ? Store.getCurrentSlot() : 'u0';
        const exportedIds = Store ? Store.getExportedIds() : {};

        try {
            const result = await Controller.runExport({
                selected,
                format,
                skip,
                includeIndex,
                includeAssets,
                useZip: finalUseZip,
                dirHandle,
                currentSlot: slot,
                conversations: convs,
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
                    if (Store) {
                        const convs = Store.getConversations();
                        const item = convs.find(c => normId(c.id) === nid);
                        if (item) item.title = newTitle;
                    }
                    const itemEl = document.querySelector(`[data-chat-id="${nid}"]`);
                    if (itemEl) {
                        const titleDiv = itemEl.querySelector('.title > div');
                        if (titleDiv) {
                            const badgeEl = titleDiv.querySelector('.badge');
                            titleDiv.innerHTML = `${newTitle.replace(/</g, '&lt;')} ${badgeEl ? badgeEl.outerHTML : ''}`;
                        }
                    }
                },
                onItemExported: (chatId) => {
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
            if ($('progText')) $('progText').textContent = finishMsg;
        } catch (err) {
            log(typeof I18n !== 'undefined' ? I18n.t('logExportInterrupted', err.message) : `导出过程异常中断: ${err.message}`, 'error');
            if ($('progText')) $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('exportFailed', err.message) : `导出失败: ${err.message}`;
        } finally {
            __lastRenderedSignature = '';
            await loadStore(true);
        }
    }

    // Takeout handler
    async function parseTakeoutZip(file) {
        if (typeof TakeoutEngine === 'undefined') {
            log('TakeoutEngine module not loaded', 'error');
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

            const convs = Store ? Store.getConversations() : [];
            let existingMap = new Map();
            for (const c of convs) {
                existingMap.set(normId(c.id).toLowerCase(), c);
            }

            let addedCount = 0;
            for (const tc of res.conversations) {
                const nid = normId(tc.id).toLowerCase();
                if (!existingMap.has(nid)) {
                    convs.push(tc);
                    existingMap.set(nid, tc);
                    addedCount++;
                }
            }

            if (addedCount > 0 && Store) {
                const slot = Store.getCurrentSlot() || 'u0';
                await Store.saveConversations(slot, convs);
            }

            const successMsg = typeof I18n !== 'undefined'
                ? I18n.t('takeoutSuccessDetail', res.conversations.length, addedCount, res.totalMediaCount)
                : `Takeout 解析成功！发现 ${res.conversations.length} 条对话，已补全 ${addedCount} 条缺失历史，索引 ${res.totalMediaCount} 个离线资源`;
            log(successMsg, 'info');
            if ($('progText')) $('progText').textContent = successMsg;
            loadStore();
        } catch (err) {
            log(typeof I18n !== 'undefined' ? I18n.t('takeoutError', err.message) : `Takeout 导入失败: ${err.message}`, 'error');
            if ($('progText')) $('progText').textContent = typeof I18n !== 'undefined' ? I18n.t('takeoutError', err.message) : `Takeout 导入失败: ${err.message}`;
        } finally {
            $('progWrap').style.display = 'none';
        }
    }

    function exportListJson() {
        const convs = Store ? Store.getConversations() : [];
        const sel = List ? List.getSelected(convs) : [];
        if (!sel.length) {
            const noSelMsg = typeof I18n !== 'undefined' ? I18n.t('noSelection') : 'Please select at least one conversation!';
            log(noSelMsg, 'warn');
            if ($('progText')) $('progText').textContent = noSelMsg;
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
        log('已导出选中会话列表为 JSON', 'info');
    }

    async function exportDiagnostics() {
        try {
            const d = await chrome.storage.local.get(['gemini_last_sync_diagnostics']);
            const diag = d.gemini_last_sync_diagnostics;
            if (!diag) {
                const noDataMsg = typeof I18n !== 'undefined' ? I18n.t('noDiagData') : 'No diagnostic data yet.';
                log(noDataMsg, 'info');
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
            log('已生成诊断数据文件', 'info');
        } catch (e) {
            log('导出诊断失败: ' + e.message, 'error');
        }
    }

    // Workbench Initialization
    async function initWorkbench() {
        console.log('[workbench] Initializing...');

        // 1. App Version & Header
        const verEl = $('ver');
        if (verEl) {
            try {
                verEl.textContent = 'v' + (chrome.runtime.getManifest()?.version || '1.3.1');
            } catch {}
        }

        // 2. Initialize LogView
        if (Log && Log.init) Log.init('log');

        // 3. Language Init
        if (typeof I18n !== 'undefined') {
            try {
                await I18n.initLanguage();
                I18n.applyI18n();
            } catch (e) {
                console.warn('[workbench] i18n init error', e);
            }
        }

        // 4. Dev Mode Init
        try {
            const devOn = Store ? await Store.getDevMode() : false;
            if ($('devToggle')) $('devToggle').checked = devOn;
            document.body.classList.toggle('dev-mode', devOn);
            const labelDev = $('labelDevMode');
            if (labelDev) {
                labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
            }
        } catch (e) {}

        // 5. Export Settings Init (ZIP & Formats)
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

        if (Formats && Formats.loadFormat) {
            await Formats.loadFormat($('format'));
            Formats.bindFormatSelect($('format'));
        }

        if (zipCheck) {
            const d = await chrome.storage.local.get(['gemini_export_zip']);
            if (typeof d.gemini_export_zip !== 'undefined') {
                zipCheck.checked = d.gemini_export_zip;
            }
            zipCheck.addEventListener('change', () => {
                updateZipUi();
                chrome.storage.local.set({ gemini_export_zip: zipCheck.checked });
            });
            updateZipUi();
        }

        // 6. Language Switch Handlers
        const handleLangChange = async (targetLang) => {
            console.log('[workbench] Switching language to:', targetLang);
            if (typeof I18n !== 'undefined') {
                const currentSelected = List ? List.getSelectedIds() : new Set();
                await I18n.setLang(targetLang);
                updateAccountSlotSelector();
                const convs = Store ? Store.getConversations() : [];
                const expMap = Store ? Store.getExportedIds() : {};
                if (List) {
                    List.render(convs, expMap, currentSelected, __chatSearchFilter);
                    List.updateStat(convs);
                }
                updateZipUi();
                await checkExportSession();
                const syncCountEl = $('syncCount');
                if (syncCountEl && convs.length) {
                    syncCountEl.textContent = I18n.t('syncedBadge', convs.length);
                }
            }
        };

        $('langToggle')?.addEventListener('change', (e) => {
            handleLangChange(e.target.checked ? 'en' : 'zh');
        });
        $('labelLangZh')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if ($('langToggle')) $('langToggle').checked = false;
            handleLangChange('zh');
        });
        $('labelLangEn')?.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if ($('langToggle')) $('langToggle').checked = true;
            handleLangChange('en');
        });

        // 7. Dev Mode Switch Handlers
        const handleDevChange = async (devOn) => {
            console.log('[workbench] Switching dev mode to:', devOn);
            document.body.classList.toggle('dev-mode', devOn);
            const labelDev = $('labelDevMode');
            if (labelDev) {
                labelDev.style.color = devOn ? 'var(--accent2, #06b6d4)' : 'var(--muted, #8a92b2)';
            }
            if (devOn) renderLog();
            if (Formats && Formats.handleDevToggle) {
                await Formats.handleDevToggle(devOn, $('format'));
            }
            if (Store) await Store.setDevMode(devOn);
        };

        $('devToggle')?.addEventListener('change', (e) => handleDevChange(e.target.checked));
        $('labelDevMode')?.addEventListener('click', () => {
            const dt = $('devToggle');
            if (dt) {
                dt.checked = !dt.checked;
                handleDevChange(dt.checked);
            }
        });

        // 8. Account Slot Switch Handler
        $('accountSlotSelect')?.addEventListener('change', async (e) => {
            const newSlot = e.target.value;
            console.log('[workbench] Account slot changed to:', newSlot);
            if (Store) {
                Store.setCurrentSlot(newSlot);
                await loadStore();
            }
        });

        // 9. Search Bar Handler
        ($('chatSearchInput') || $('search'))?.addEventListener('input', (e) => {
            __chatSearchFilter = (e.target.value || '').trim();
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            const currentSelected = List ? List.getSelectedIds() : new Set();
            if (List) List.render(convs, expMap, currentSelected, __chatSearchFilter);
        });

        // 10. List Selection Filter Buttons
        $('btnSelectAll')?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            if (List) List.selectAll(convs);
        });
        ($('btnSelectNone') || $('btnDeselectAll'))?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            if (List) List.deselectAll(convs);
        });
        ($('btnSelectUnexported') || $('btnFilterNew'))?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) List.selectUnexported(convs, expMap);
        });
        ($('btnSelectUpdated') || $('btnFilterNeedsUpdate'))?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) List.selectNeedsUpdate(convs, expMap);
        });

        // 11. Directory Selection Buttons
        $('btnSetDir')?.addEventListener('click', async () => {
            try {
                await requestDirHandle();
            } catch (err) {
                log(typeof I18n !== 'undefined' ? I18n.t('dirCancelled', err.message) : `选择目录失败: ${err.message}`, 'warn');
            }
        });

        // 12. Export Execution & Cancellation
        $('btnExport')?.addEventListener('click', exportSelected);
        $('btnCancel')?.addEventListener('click', () => {
            if (Controller) Controller.abort();
            log(typeof I18n !== 'undefined' ? I18n.t('stoppingExport') : '正在终止导出任务...', 'warn');
        });
        $('btnResumeExport')?.addEventListener('click', () => {
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) List.selectUnexported(convs, expMap);
            exportSelected();
        });
        $('btnDismissExportBanner')?.addEventListener('click', async () => {
            const banner = $('exportSessionBanner');
            if (banner) banner.style.display = 'none';
            await chrome.storage.local.remove(['gemini_last_export_session']);
        });

        // 13. Local Takeout Archive Import
        $('btnImportTakeout')?.addEventListener('click', () => $('takeoutFileInput')?.click());
        $('takeoutFileInput')?.addEventListener('change', (e) => {
            const f = e.target.files && e.target.files[0];
            if (f) parseTakeoutZip(f);
        });

        // 14. Sync Actions
        function setScanRunning(running) {
            if ($('btnIncrementalScan')) $('btnIncrementalScan').disabled = !!running;
            if ($('btnDeepScan')) $('btnDeepScan').disabled = !!running;
            if ($('btnStopScan')) $('btnStopScan').style.display = running ? 'inline-flex' : 'none';
            if ($('btnExport')) $('btnExport').disabled = !!running;
            if ($('btnImportTakeout')) $('btnImportTakeout').disabled = !!running;
            if ($('btnSetDir')) $('btnSetDir').disabled = !!running;
            if ($('btnClearExported')) $('btnClearExported').disabled = !!running;
            if ($('btnClearAll')) $('btnClearAll').disabled = !!running;
        }

        $('btnIncrementalScan')?.addEventListener('click', () => {
            if (Controller && Controller.isRunning()) return;
            const progWrap = $('progWrap');
            const bar = $('bar');
            const progText = $('progText');
            if (progWrap) progWrap.style.display = 'block';
            if (bar) bar.style.width = '5%';
            if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('syncingLatest') : '正在同步最新会话...';
            setScanRunning(true);

            const slot = Store ? Store.getCurrentSlot() : 'u0';
            chrome.runtime.sendMessage({ action: 'deepScan', mode: 'incremental', accountSlot: slot }, (res) => {
                setScanRunning(false);

                if (chrome.runtime.lastError) {
                    const err = chrome.runtime.lastError.message;
                    log(typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `增量同步失败: ${err}`, 'error');
                    if (progText) progText.textContent = typeof I18n !== 'undefined' ? `${I18n.t('failedPrefix')}: ${err}` : `失败: ${err}`;
                    return;
                }
                if (res && res.success) {
                    const count = res.count || res.total || 0;
                    log(typeof I18n !== 'undefined' ? I18n.t('syncFinished', count) : `增量同步完成，共 ${count} 条`);
                    if (bar) bar.style.width = '100%';
                    if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('syncFinished', count) : `增量同步完成，共 ${count} 条`;
                    setTimeout(() => {
                        if (progWrap) progWrap.style.display = 'none';
                        if (bar) bar.style.width = '0%';
                        if (progText) progText.textContent = '';
                    }, 2500);
                    loadStore();
                } else {
                    const err = res ? res.error : '未知错误';
                    log(typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `同步失败: ${err}`, 'error');
                    if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `同步失败: ${err}`;
                }
            });
        });

        $('btnDeepScan')?.addEventListener('click', () => {
            if (Controller && Controller.isRunning()) return;
            const progWrap = $('progWrap');
            const bar = $('bar');
            const progText = $('progText');
            if (progWrap) progWrap.style.display = 'block';
            if (bar) bar.style.width = '5%';
            if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('deepSyncing') : '正在全量扫描历史...';
            setScanRunning(true);

            const slot = Store ? Store.getCurrentSlot() : 'u0';
            chrome.runtime.sendMessage({ action: 'deepScan', mode: 'full', accountSlot: slot }, (res) => {
                setScanRunning(false);

                if (chrome.runtime.lastError) {
                    const err = chrome.runtime.lastError.message;
                    log(typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `全量扫描失败: ${err}`, 'error');
                    if (progText) progText.textContent = typeof I18n !== 'undefined' ? `${I18n.t('failedPrefix')}: ${err}` : `失败: ${err}`;
                    return;
                }
                if (res && res.success) {
                    const count = res.count || res.total || 0;
                    log(typeof I18n !== 'undefined' ? I18n.t('deepSyncFinished', count) : `全量拉取完成，共 ${count} 条`);
                    if (bar) bar.style.width = '100%';
                    if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('deepSyncFinished', count) : `全量拉取完成，共 ${count} 条`;
                    setTimeout(() => {
                        if (progWrap) progWrap.style.display = 'none';
                        if (bar) bar.style.width = '0%';
                        if (progText) progText.textContent = '';
                    }, 2500);
                    loadStore();
                } else {
                    const err = res ? res.error : '未知错误';
                    log(typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `全量拉取失败: ${err}`, 'error');
                    if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('syncFailed', err) : `全量拉取失败: ${err}`;
                }
            });
        });

        $('btnStopScan')?.addEventListener('click', () => {
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            chrome.runtime.sendMessage({ action: 'stopDeepScan', accountSlot: slot }, () => {
                log(typeof I18n !== 'undefined' ? I18n.t('stoppingSync') : '正在终止同步...');
                const progText = $('progText');
                if (progText) progText.textContent = typeof I18n !== 'undefined' ? I18n.t('stoppingSync') : '正在终止同步...';
                setScanRunning(false);
            });
        });

        // 15. Clear Cache
        $('btnClearExported')?.addEventListener('click', async () => {
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (Store) await Store.clearExported(slot);
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            const currentSelected = new Set(List ? List.getSelected(convs).map(x => x.id) : []);
            if (List) {
                List.render(convs, expMap, currentSelected, __chatSearchFilter);
                List.updateStat(convs);
            }
            log(typeof I18n !== 'undefined' ? I18n.t('confirmClearExported') : '已清空已导出记录', 'info');
        });

        $('btnClearAll')?.addEventListener('click', async () => {
            const confirmMsg = typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : '确定清空本地所有会话数据？';
            if (!confirm(confirmMsg)) return;
            const slot = Store ? Store.getCurrentSlot() : 'u0';
            if (Store) await Store.clearAll(slot);
            const convs = Store ? Store.getConversations() : [];
            const expMap = Store ? Store.getExportedIds() : {};
            if (List) {
                List.render(convs, expMap, null, __chatSearchFilter);
                List.updateStat(convs);
            }
            log(typeof I18n !== 'undefined' ? I18n.t('confirmClearAll') : '本地会话数据已清空');
        });

        // 17. Logs & Diagnostics
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

        // 18. Broadcast Listener for Progress & Live Updates
        chrome.runtime.onMessage.addListener((msg) => {
            if (msg.action === 'scanProgress') {
                const progWrap = $('progWrap');
                const bar = $('bar');
                const progText = $('progText');
                if (progWrap) progWrap.style.display = 'block';
                let pct = typeof msg.percent === 'number' ? msg.percent : 50;
                if (bar) bar.style.width = Math.min(Math.max(pct, 5), 100) + '%';
                if (progText && msg.title) progText.textContent = msg.title;
                if (msg.title) log(msg.title);
            }
            if (msg.action === 'syncUpdate') {
                loadStore(true);
            }
        });

        // 19. Initial Data & Directory Restore
        await restoreSavedDirHandle();
        try { window.__workbenchLoadStore = loadStore; } catch {}
        await loadStore();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initWorkbench);
    } else {
        initWorkbench();
    }
})();
