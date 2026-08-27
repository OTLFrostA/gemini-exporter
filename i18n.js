// i18n.js - Lightweight internationalization engine for Gemini Exporter
(function(global) {
    const LOCALES = {
        zh: {
            extName: "Gemini Exporter",
            syncedBadge: "已同步 {0} 条",
            langSwitch: "English",
            openWorkbench: "打开导出面板",
            noteLabel: "说明",
            popupDesc: "在 gemini.google.com 页面会自动同步会话列表。点击“去工作台选 批量导出”可进入导出面板进行批量管理和下载。",
            quickExportLabel: "快捷导出",
            btnCurrent: "只导当前页",
            btnOptions: "去工作台选 批量导出",
            exportSettings: "导出设置",
            format: "格式",
            fmtMarkdown: "Markdown (.md)",
            fmtJsonOpenAI: "JSON (OpenAI格式)",
            fmtJsonStandard: "JSON (插件标准)",
            fmtJsonRaw: "JSON (Gemini原始)",
            fmtTxt: "TXT (.txt)",
            skipExported: "跳过已导出",
            btnClearExported: "清除导出记录",
            btnClearExportedTip: "清除历史导出标记，允许重新导出全部",
            includeIndex: "含 _index.json",
            includeAssets: "下载附件",
            includeAssetsTip: "下载对话中的图片与文件附件",
            includeZip: "打包成 ZIP",
            includeZipTip: "打包为 ZIP 文件下载",
            btnSetDir: "设置目录...",
            dirNotSet: "未设置目录",
            btnExportZip: "导出选中 → ZIP",
            btnExportFolder: "导出选中 → 文件夹",
            btnOnlyJson: "仅导列表 JSON",
            btnCancel: "终止导出",
            logLevelAll: "全部日志",
            logLevelInfo: "简要日志",
            logLevelWarn: "仅错误",
            filterAll: "全部",
            filterExported: "已导出",
            filterUpdated: "有更新",
            filterUnexported: "未导出",
            filterFailed: "失败",
            searchPlaceholder: "搜索标题 / ID...",
            selectAll: "全选",
            selectNone: "全不选",
            selectUnexported: "只选未导出",
            selectUpdated: "只选已更新",
            btnIncrementalScan: "同步最新会话",
            btnIncrementalScanTip: "快速拉取最近更新的会话（日常推荐，通常仅需 1~2 秒）",
            btnDeepScan: "全量拉取历史",
            btnDeepScanTip: "地毯式扫描并同步该账号下的所有历史会话（初次使用或换账号时推荐）",
            btnClearAll: "清空缓存",
            selectedStat: "已勾选 {0} 条 / 共 {1} 条（约 {2} 轮对话）",
            emptyList: "没有找到匹配的对话。",
            noSelection: "请至少勾选一条对话！",
            confirmClearExported: "确定清空已导出记录？清空后将允许重新导出全部对话。",
            confirmClearAll: "确定清空本地所有已同步的会话列表？",
            exportAborted: "已终止导出。",
            exportFinished: "导出完成！成功: {0}，失败: {1}，总计: {2}",
            exportingChat: "导出中 ({0}/{1}): {2}",
            downloadingAsset: "下载图片 ({0}/{1}): {2}",
            syncCompleted: "同步完成，已更新列表",
            syncFailed: "同步失败: {0}",
            pillInit: "初始化…",
            pillSynced: "已同步 {0} 条",
            badgeNeedsReexport: "待重新导出",
            badgeExported: "已导出",
            badgeNew: "未导出",
            dirCancelled: "设置目录取消: {0}",
            currentTabMissing: "未找到当前打开的 Gemini 标签页，请先打开 gemini.google.com"
        },
        en: {
            extName: "Gemini Exporter",
            syncedBadge: "{0} synced",
            langSwitch: "简体中文",
            openWorkbench: "Open Workbench",
            noteLabel: "NOTE",
            popupDesc: "Conversations automatically sync while browsing gemini.google.com. Click 'Go to Workbench' for batch management and downloads.",
            quickExportLabel: "QUICK EXPORT",
            btnCurrent: "Export Current Page",
            btnOptions: "Go to Workbench",
            exportSettings: "Export Settings",
            format: "Format",
            fmtMarkdown: "Markdown (.md)",
            fmtJsonOpenAI: "JSON (OpenAI format)",
            fmtJsonStandard: "JSON (Standard)",
            fmtJsonRaw: "JSON (Raw Gemini)",
            fmtTxt: "TXT (.txt)",
            skipExported: "Skip Exported",
            btnClearExported: "Clear Export History",
            btnClearExportedTip: "Clear export history markers to allow re-exporting all chats",
            includeIndex: "Include _index.json",
            includeAssets: "Download Assets",
            includeAssetsTip: "Download images and file attachments in chats",
            includeZip: "Package as ZIP",
            includeZipTip: "Bundle all files into a single ZIP archive",
            btnSetDir: "Set Folder...",
            dirNotSet: "Directory not set",
            btnExportZip: "Export Selected → ZIP",
            btnExportFolder: "Export Selected → Folder",
            btnOnlyJson: "Export List JSON",
            btnCancel: "Abort Export",
            logLevelAll: "All Logs",
            logLevelInfo: "Info / Warn",
            logLevelWarn: "Errors Only",
            filterAll: "All",
            filterExported: "Exported",
            filterUpdated: "Updated",
            filterUnexported: "Unexported",
            filterFailed: "Failed",
            searchPlaceholder: "Search title / ID...",
            selectAll: "Select All",
            selectNone: "Deselect All",
            selectUnexported: "Unexported Only",
            selectUpdated: "Updated Only",
            btnIncrementalScan: "Sync Latest",
            btnIncrementalScanTip: "Quickly fetch newly created and updated chats (recommended for daily use)",
            btnDeepScan: "Full Deep Sync",
            btnDeepScanTip: "Thoroughly fetch all conversation history for this account (recommended for first-time use)",
            btnClearAll: "Clear Cache",
            selectedStat: "Selected: {0} / Total: {1} (approx {2} turns)",
            emptyList: "No matching conversations found.",
            noSelection: "Please select at least one conversation!",
            confirmClearExported: "Are you sure you want to clear export history? All conversations will be allowed to re-export.",
            confirmClearAll: "Are you sure you want to clear all locally cached conversations?",
            exportAborted: "Export aborted by user.",
            exportFinished: "Export completed! Success: {0}, Failed: {1}, Total: {2}",
            exportingChat: "Exporting ({0}/{1}): {2}",
            downloadingAsset: "Downloading image ({0}/{1}): {2}",
            syncCompleted: "Sync completed, list updated.",
            syncFailed: "Sync failed: {0}",
            pillInit: "Initializing...",
            pillSynced: "{0} synced",
            badgeNeedsReexport: "Needs re-export",
            badgeExported: "Exported",
            badgeNew: "New",
            dirCancelled: "Directory setup cancelled: {0}",
            currentTabMissing: "No active Gemini tab found. Please open gemini.google.com first."
        }
    };

    let currentLang = 'en';

    async function initLanguage() {
        try {
            const data = await chrome.storage.local.get('gemini_exporter_lang');
            if (data.gemini_exporter_lang && LOCALES[data.gemini_exporter_lang]) {
                currentLang = data.gemini_exporter_lang;
            } else {
                const sys = (navigator.language || '').toLowerCase();
                currentLang = sys.startsWith('zh') ? 'zh' : 'en';
            }
        } catch {
            currentLang = 'en';
        }
        return currentLang;
    }

    function getLang() {
        return currentLang;
    }

    async function setLang(lang) {
        if (!LOCALES[lang]) return;
        currentLang = lang;
        try {
            await chrome.storage.local.set({ gemini_exporter_lang: lang });
        } catch {}
        applyI18n();
    }

    function t(key, ...args) {
        let str = LOCALES[currentLang]?.[key] || LOCALES['en']?.[key] || key;
        if (args.length) {
            args.forEach((val, idx) => {
                str = str.replace(new RegExp(`\\{${idx}\\}`, 'g'), val);
            });
        }
        return str;
    }

    function applyI18n(container = document) {
        // Text content
        container.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const val = t(key);
            if (val) el.textContent = val;
        });
        // Titles / Tooltips
        container.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const val = t(key);
            if (val) el.title = val;
        });
        // Placeholders
        container.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const val = t(key);
            if (val) el.placeholder = val;
        });
        // Language switch component state
        const langToggle = document.getElementById('langToggle');
        if (langToggle) {
            langToggle.checked = (currentLang === 'en');
        }
        const labelZh = document.getElementById('labelLangZh');
        const labelEn = document.getElementById('labelLangEn');
        if (labelZh && labelEn) {
            labelZh.style.color = currentLang === 'zh' ? 'var(--text, #f1f3fc)' : 'var(--muted, #8a92b2)';
            labelZh.style.opacity = currentLang === 'zh' ? '1' : '0.6';
            labelEn.style.color = currentLang === 'en' ? 'var(--text, #f1f3fc)' : 'var(--muted, #8a92b2)';
            labelEn.style.opacity = currentLang === 'en' ? '1' : '0.6';
        }
    }

    global.I18n = {
        initLanguage,
        getLang,
        setLang,
        t,
        applyI18n
    };
})(typeof window !== 'undefined' ? window : this);
