// options-popup.js - Popup UI controller for Gemini Exporter
(function(){
  function $(id){ return document.getElementById(id); }
  function log(msg){
    const l=$('log');
    if(!l) return;
    const time = new Date().toLocaleTimeString();
    l.textContent = `[${time}] ${msg}\n` + l.textContent.slice(0,2000);
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
      const convKey = slot === 'u0' ? 'gemini_conversations' : `gemini_conversations_${slot}`;
      const countKey = slot === 'u0' ? 'gemini_last_count' : `gemini_last_count_${slot}`;
      const data = await chrome.storage.local.get([convKey, countKey]);
      const count = data[convKey]?.length || data[countKey] || 0;
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
    log('正在导出当前页…');
    const progWrap = $('progWrap');
    const bar = $('bar');
    if(progWrap) progWrap.style.display = 'block';
    if(bar) bar.style.width = '10%';

    try{
      const tabs = await chrome.tabs.query({active:true, currentWindow:true});
      const tab = tabs[0];
      if(!tab || !tab.url || !tab.url.includes('gemini.google.com')){
        log('当前页不是 gemini.google.com，请先打开 Gemini 对话页');
        return;
      }
      // Extract conversation ID from URL
      const m = tab.url.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
      if(!m){
        log('当前页未打开具体对话 (URL 中没找到对话 ID)');
        return;
      }
      const convId = m[2].replace(/^c_/,'');
      log(`找到对话 ID: ${convId}，正在抓取内容…`);
      if(bar) bar.style.width = '40%';

      chrome.runtime.sendMessage({action:'fetchChat', conversationId: convId}, (res)=>{
        if(chrome.runtime.lastError){
          log('抓取失败: '+chrome.runtime.lastError.message);
          return;
        }
        if(!res || !res.success){
          log('抓取失败: '+(res?.error || '未知错误'));
          return;
        }
        if(bar) bar.style.width = '80%';
        const chat = res.data || res;
        if(!chat.id) chat.id = convId;
        if(!chat.url) chat.url = `https://gemini.google.com/app/${convId}`;
        if(!chat.title || chat.title === 'Untitled conversation') {
          try {
            const data = await chrome.storage.local.get(['gemini_conversations']);
            const list = data.gemini_conversations || [];
            const found = list.find(c => c.id === convId || c.id === `c_${convId}`);
            if (found && found.title) chat.title = found.title;
          } catch {}
        }

        let content, ext, mime;
        if(format === 'json'){
          content = JSON.stringify(chat, null, 2);
          ext = 'json';
          mime = 'application/json';
        } else if(format === 'json_openai'){
          let openaiFormat = (chat.messages || []).map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.content || ''
          }));
          content = JSON.stringify(openaiFormat, null, 2);
          ext = 'json';
          mime = 'application/json';
        } else if(format === 'json_raw'){
          content = JSON.stringify(chat._raw || chat, null, 2);
          ext = 'json';
          mime = 'application/json';
        } else {
          // markdown
          let md = `# ${chat.title||chat.id}\n\n> ID: ${chat.id} | 导出: ${new Date().toLocaleString()} | 来源: ${chat.url}\n\n---\n\n`;
          for(const msg of chat.messages||[]){
            if(msg.role==='user') {
              md += `## 🙋 你\n\n${msg.content||''}\n\n`;
            } else {
              md += `## 🤖 Gemini\n\n`;
              if (msg.thinking && msg.thinking.trim()) {
                md += `<details><summary>🧠 思考过程</summary>\n\n${msg.thinking.trim()}\n\n</details>\n\n`;
              }
              md += `${msg.content||''}\n\n`;
              if (msg.citations && msg.citations.length) {
                md += `> 🌐 **参考来源：**\n`;
                for (const c of msg.citations) {
                  md += `> - [${c.title || c.url}](${c.url})\n`;
                }
                md += `\n`;
              }
              md += `---\n\n`;
            }
          }
          content = md;
          ext = 'md';
          mime = 'text/markdown';
        }

        const safeTitle = (chat.title||chat.id).replace(/[<>:"/\\|?*]+/g,'_').slice(0,60);
        const fileName = `${safeTitle}_${convId.slice(-6)}.${ext}`;
        const blob = new Blob([content], {type: mime});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(()=>URL.revokeObjectURL(url), 3000);

        if(bar) bar.style.width = '100%';
        log(`已导出: ${fileName} (${chat.messages?.length||0} 条消息)`);
      });
    }catch(e){
      log('导出异常: '+e.message);
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
