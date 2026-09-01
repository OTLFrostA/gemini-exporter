// options-popup.js - Popup UI controller for Gemini Exporter
(function(){
  const Storage = (typeof StorageService !== 'undefined') ? StorageService : (window.StorageService || null);

  function $(id){ return document.getElementById(id); }
  function log(msg){
    const l=$('log');
    if(!l) return;
    const time = new Date().toLocaleTimeString();
    l.textContent = `[${time}] ${msg}\n` + l.textContent.slice(0,2000);
  }

  function sanitizeFileName(name, fallback = 'untitled') {
    if (typeof GeminiUtils !== 'undefined' && GeminiUtils.sanitizeFileName) {
      return GeminiUtils.sanitizeFileName(name, fallback);
    }
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

  // Update synced count badge
  async function updateCount(){
    try{
      let slot = 'u0';
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url && tab.url.includes('gemini.google.com')) {
        const m = tab.url.match(/\/u\/(\d+)(?:\/|$)/);
        if (m) slot = 'u' + m[1];
      }
      let count = 0;
      if (Storage) {
        const convs = await Storage.getConversations(slot);
        count = convs.length;
        if (!count) {
          const syncInfo = await Storage.getLastSync(slot);
          count = syncInfo.count || 0;
        }
      } else {
        const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
        const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;
        const data = await chrome.storage.local.get([convKey, countKey]);
        count = data[convKey]?.length || data[countKey] || 0;
      }
      const badge = $('countBadge');
      if(badge) {
        const text = typeof I18n !== 'undefined' ? I18n.t('syncedBadge', count) : `${count} synced`;
        badge.textContent = slot === 'u0' ? text : `${text} (${slot.toUpperCase()})`;
      }
    }catch(e){ console.warn('[popup] updateCount err', e); }
  }

  // Language switch toggle
  $('langToggle')?.addEventListener('change', async (e) => {
    const nextLang = e.target.checked ? 'en' : 'zh';
    if (typeof I18n !== 'undefined') {
      await I18n.setLang(nextLang);
      updateCount();
    }
  });

  // Open options/workbench page
  $('openOptions')?.addEventListener('click', (e)=>{
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  chrome.storage.local.get(['gemini_export_format'], data => {
    if (data.gemini_export_format && $('format')) {
      $('format').value = data.gemini_export_format;
    }
  });
  $('format')?.addEventListener('change', e => {
    chrome.storage.local.set({ gemini_export_format: e.target.value });
  });

  // "去工作台选 批量导出" button
  $('btnOptions')?.addEventListener('click', ()=>{
    chrome.runtime.openOptionsPage();
  });

  // "只导当前页" button
  $('btnCurrent')?.addEventListener('click', async ()=>{
    const format = $('format')?.value || 'markdown';
    log(typeof I18n !== 'undefined' ? I18n.t('popupExporting') : '正在导出当前页…');
    const progWrap = $('progWrap');
    const bar = $('bar');
    if(progWrap) progWrap.style.display = 'block';
    if(bar) bar.style.width = '10%';

    try{
      const tabs = await chrome.tabs.query({active:true, currentWindow:true});
      const tab = tabs[0];
      if(!tab || !tab.url || !tab.url.includes('gemini.google.com')){
        log(typeof I18n !== 'undefined' ? I18n.t('popupNotGemini') : '当前页不是 gemini.google.com，请先打开 Gemini 对话页');
        return;
      }
      const slotMatch = tab.url.match(/\/u\/(\d+)(?:\/|$)/);
      const slot = slotMatch ? ('u' + slotMatch[1]) : 'u0';
      const m = tab.url.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
      if(!m){
        log(typeof I18n !== 'undefined' ? I18n.t('popupNoChatId') : '当前页未打开具体对话 (URL 中没找到对话 ID)');
        return;
      }
      const convId = m[2].replace(/^c_/,'');
      log(typeof I18n !== 'undefined' ? I18n.t('popupFoundChat', convId) : `找到对话 ID: ${convId}，正在抓取内容…`);
      if(bar) bar.style.width = '40%';

      chrome.runtime.sendMessage({action:'fetchChat', conversationId: convId, accountSlot: slot}, async (res)=>{
        if(chrome.runtime.lastError){
          log(typeof I18n !== 'undefined' ? I18n.t('popupFetchFailed', chrome.runtime.lastError.message) : ('抓取失败: '+chrome.runtime.lastError.message));
          return;
        }
        if(!res || !res.success){
          log(typeof I18n !== 'undefined' ? I18n.t('popupFetchFailed', res?.error || '未知错误') : ('抓取失败: '+(res?.error || '未知错误')));
          return;
        }
        if(bar) bar.style.width = '80%';
        const chat = res.data || res;
        if(!chat.id) chat.id = convId;
        if(!chat.url) chat.url = `https://gemini.google.com/app/${convId}`;
        if(!chat.title || chat.title === 'Untitled conversation') {
          try {
            const list = Storage ? await Storage.getConversations(slot) : [];
            const found = list.find(c => c.id === convId || c.id === `c_${convId}`);
            if (found && found.title) chat.title = found.title;
          } catch {}
        }

        const formatted = (typeof ChatFormatter !== 'undefined')
          ? ChatFormatter.formatContent(chat, format)
          : { content: JSON.stringify(chat, null, 2), ext: 'json', mime: 'application/json' };
        const content = formatted.content;
        const ext = formatted.ext;
        const mime = formatted.mime;

        const safeTitle = sanitizeFileName(chat.title || chat.id, 'conversation');
        const fileName = `${safeTitle}_${convId.slice(-6)}.${ext}`;
        const blob = new Blob([content], {type: mime});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url), 3000);

        if(bar) bar.style.width = '100%';
        log(typeof I18n !== 'undefined' ? I18n.t('popupExported', fileName, chat.messages?.length||0) : `已导出: ${fileName} (${chat.messages?.length||0} 条消息)`);

        try {
          const rec = {
            title: chat.title || convId,
            exportedAt: new Date().toISOString(),
            messageCount: chat.messages?.length || 0,
            chatTime: chat.timestamp || Date.now(),
            status: 'ok'
          };
          if (Storage) {
            await Storage.saveExportRecord(slot, convId, rec);
          } else {
            const expKey = slot === 'u0' ? 'exportedIds' : `gemini_exported_${slot}`;
            const expData = await chrome.storage.local.get([expKey]);
            const curExp = expData[expKey] || {};
            curExp[convId] = rec;
            await chrome.storage.local.set({ [expKey]: curExp });
          }
        } catch {}
      });
    }catch(e){
      log(typeof I18n !== 'undefined' ? I18n.t('popupExportError', e.message) : ('导出异常: '+e.message));
      console.error('[popup] export current err', e);
    }
  });

  // Listen for sync updates
  chrome.runtime.onMessage.addListener((msg)=>{
    if(msg.action==='syncUpdate'){
      const badge = $('countBadge');
      if(badge) badge.textContent = typeof I18n !== 'undefined' ? I18n.t('syncedBadge', msg.count) : `${msg.count} synced`;
    }
    if(msg.action==='exportProgress' || msg.action==='scanProgress'){
      const bar = $('bar');
      const progWrap = $('progWrap');
      if(progWrap) progWrap.style.display = 'block';
      let pct = typeof msg.percent === 'number' ? msg.percent : (msg.total ? Math.floor((msg.done/msg.total)*100) : 50);
      if(bar) bar.style.width = Math.min(Math.max(pct, 5), 100)+'%';
      if(msg.title) log(msg.title);
    }
  });

  // Init i18n and count
  if (typeof I18n !== 'undefined') {
    I18n.initLanguage().then(() => {
      I18n.applyI18n();
      updateCount();
    });
  } else {
    updateCount();
  }
  // Refresh count periodically
  setInterval(updateCount, 5000);
})();
