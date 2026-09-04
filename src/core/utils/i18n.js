// i18n.js - Complete, centralized internationalization engine for Gemini Exporter
(function(root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else {
        root.I18n = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

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
            skipExported: "跳过已导出",
            btnClearExported: "清除",
            btnClearExportedTip: "清除历史导出标记，允许重新导出全部",
            includeIndex: "含 _index.json",
            includeAssets: "下载附件",
            includeAssetsTip: "下载对话中的图片与文件附件",
            includeZip: "打包成 ZIP",
            includeZipTip: "打包为 ZIP 文件下载",
            btnSetDir: "设置目录...",
            dirNotSet: "未设置目录",
            dirCurrent: "已选目录: {0}",
            logDirRestored: "已恢复保存的导出目录: {0}",
            btnExportZip: "导出选中 → ZIP",
            btnExportFolder: "导出选中 → 文件夹",
            btnOnlyJson: "仅导列表 JSON",
            btnCancel: "终止导出",
            stoppingExport: "正在终止导出任务...",
            logLevelAll: "全部日志",
            logLevelInfo: "简要日志",
            logLevelWarn: "警告及错误",
            logLevelError: "仅错误",
            filterAll: "会话列表",
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
            btnStopScan: "终止同步",
            btnPruneDeleted: "清理失效会话",
            btnPruneDeletedTip: "对比云端存活会话，自动清理本地已在 Google 删除的失效会话",
            removeChat: "移除",
            removeChatTip: "从本地列表中移除此会话",
            confirmDeleteChat: "确定从本地列表中移除会话 \"{0}\" 吗？",
            logChatRemoved: "[{0}] 已从本地列表移除",
            logChatDeletedAndPruned: "[{0}] ⚡ 云端已确认该会话不存在或已被删除，已自动从本地列表中移除",
            logPruneStarted: "正在检测云端存活会话并清理本地失效会话...",
            logPruneFinished: "清理完成: 成功剔除 {0} 条已删除会话，保留 {1} 条有效会话",
            logPruneClean: "所有本地会话均与云端状态一致，无失效残留会话",
            btnClearAll: "清空全部",
            selectedStat: "已选 {0} 条 / 共 {1} 条",
            emptyList: "暂无会话数据，请打开 gemini.google.com 页面同步。",
            emptySearchList: "没有找到匹配的对话。",
            noSelection: "请至少勾选一条对话！",
            confirmClearExported: "确定清空已导出记录？清空后将允许重新导出全部对话。",
            confirmClearAll: "确定清空本地所有已同步的会话列表？",
            exportAborted: "已终止导出。",
            exportFinished: "导出完成！成功: {0}，失败: {1}，总计: {2}",
            exportSuccess: "导出完成！已导出 {0} 篇对话。",
            exportFailed: "导出失败: {0}",
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
            currentTabMissing: "未找到当前打开的 Gemini 标签页，请先打开 gemini.google.com",
            defaultAccount: "默认账号 (u0)",
            accountSlot: "账号",
            lastSync: "最后 sync: {0} | 共 {1} 条",
            notSynced: "未同步",
            btnCopyLog: "复制",
            btnClearLog: "清空",
            logFilterPlaceholder: "过滤关键字 (-排除)",
            logReady: "就绪",
            btnExportDiag: "导出诊断",
            btnExportDiagTip: "导出本次同步底层的详细诊断报告 (包含翻页游标、请求体与停滞原因)",
            copied: "已复制!",
            popupExporting: "正在导出当前页…",
            popupNotGemini: "当前页不是 gemini.google.com，请先打开 Gemini 对话页",
            popupNoChatId: "当前页未打开具体对话 (URL 中没找到对话 ID)",
            popupFoundChat: "找到对话 ID: {0}，正在抓取内容…",
            popupFetchFailed: "抓取失败: {0}",
            popupExported: "已导出: {0} ({1} 条消息)",
            popupExportError: "导出异常: {0}",
            progPreparing: "准备中…",
            progExporting: "进度 {0}/{1} ({2}%)",
            progCurrent: "当前: {0}",
            progAssets: "附件: {0}/{1}",
            progDownloadingAssets: "正在下载剩余附件…",
            progPackagingZip: "打包 ZIP 中 ({0}%)",
            progExportDone: "完成 {0}/{1} 条，跳过 {2} 条",
            progAssetsSummary: "附件 {0}/{1}",
            progSyncing: "正在同步 ({0} 条)…",
            progSyncProgress: "进度 {0}/{1} | 当前: {2}",
            stoppingSync: "正在终止同步…",
            syncingLatest: "正在同步最新会话…",
            deepSyncing: "正在全量拉取历史…",
            failedPrefix: "失败",
            syncFinished: "增量同步完成，共 {0} 条",
            deepSyncFinished: "全量同步完成，共 {0} 条",
            noDiagData: "暂无诊断数据，请先点击「同步最新会话」或「全量拉取历史」",
            browserNoDirPicker: "当前浏览器不支持 FileSystem Access API 目录选择",
            logFolderSelected: "已选择保存目录: {0}",
            logExportZipSwitched: "已切换为导出为 ZIP: {0}",
            logExportingChats: "开始导出 {0} 条对话…",
            logExportDone: "导出完成，实际保存 {0} 条对话、{1} 个附件到 {2}",
            btnImportTakeout: "📥 导入 Takeout",
            btnImportTakeoutTip: "读取 Google Takeout 压缩包，自动补全历史无法扫描的远古对话，并加载离线附件兜底池",
            btnBackup: "💾 备份数据",
            btnBackupTip: "导出完整会话列表与设置备份文件 (.json)",
            btnRestore: "📂 恢复备份",
            btnRestoreTip: "从 JSON 备份文件恢复全部会话底账与设置",
            takeoutParsing: "正在解析 Takeout 压缩包…",
            takeoutParsingDetail: "正在解析对话并建立离线媒体索引...",
            takeoutSuccessDetail: "Takeout 解析成功！发现 {0} 条对话，已补全 {1} 条缺失历史，索引 {2} 个离线资源",
            takeoutNotFound: "未在 ZIP 包中找到 Gemini Apps 活动记录 (MyActivity.html)",
            takeoutError: "解析 Takeout ZIP 失败: {0}",
            logTakeoutChatRecovered: "[{0}] ⚡ 已自动从 Takeout 离线记录恢复问答并导出",
            logTakeoutAssetRecovered: "[{0}] ⚡ 附件从 Takeout 离线池补全成功: {1}",
            logTakeoutImageRecovered: "[{0}] ⚡ 图片从 Takeout 离线池补全成功: {1}",
            backupSuccess: "备份文件已成功生成并开始下载",
            backupFailed: "备份失败: {0}",
            restoreConfirm: "恢复备份将覆盖当前的会话列表与导出记录，确定继续吗？",
            restoreSuccess: "成功恢复 {0} 条会话底账！",
            restoreFailed: "恢复备份失败: {0}",
            restoreInvalidFormat: "无效的备份文件格式！",
            exportSessionInterrupted: "⚠️ <b>发现未完成的导出任务</b>：共 {0} 条，已处理 {1} 条，剩余 {2} 条未导出。",
            exportSessionLastChat: " (上次停在: 「{0}」)",
            exportSessionCompleted: "✅ <b>上次导出已完成</b>：共导出 {0} 条会话",
            exportSessionCompletedWithErrors: " (其中 {0} 条失败)",
            btnResumeExport: "▶️ 继续导出未完成项",
            btnDismissBanner: "✕ 关闭",
            logFetchFailed: "抓取对话失败: {0}",
            logExportSkipped: "[{0}] 导出跳过: {1}",
            logExportSuccess: "[{0}] ✓ 文本导出成功 ({1})",
            logAssetFailed: "[{0}] 附件获取失败 ({1}): {2}",
            logImageFailed: "[{0}] 图片获取失败 ({1}): {2}",
            logDevLogWritten: "🛠️ [开发者模式] 已自动将完整导出日志与诊断写入 _export_dev.log",
            logPackagingZip: "正在打包 ZIP 压缩包…",
            logAssetsAborted: "附件下载因终止而中断",
            openLink: "原文",
            tourBtnGuide: "💡 新手引导",
            tourBtnGuideTip: "启动新手操作引导",
            tourStep1Title: "步骤 1/4: 连接到 Google Gemini",
            tourStep1NoTab: "未检测到已打开的 Gemini 页面。请先打开并登录 Google Gemini，扩展才能读取您的对话列表。",
            tourStep1NeedRefresh: "检测到已打开的 Gemini 页面，但页面尚未注入扩展脚本。请刷新该页面以激活连接。",
            tourStep1Connected: "已成功连接到 Google Gemini 页面！扩展已就绪。",
            tourStep1BtnOpen: "🚀 打开 Google Gemini",
            tourStep1BtnRefresh: "🔄 刷新 Gemini 页面",
            tourStep1Checking: "正在检测连接状态…",
            tourStep2Title: "步骤 2/4: 同步对话列表",
            tourStep2Desc: "点击【同步最新会话】可秒级拉取最近对话。初次使用若想备份全部历史，也可以使用【全量拉取历史】。",
            tourStep3Title: "步骤 3/4: 勾选想要导出的对话",
            tourStep3Desc: "在列表中勾选想要导出的对话。您可以单选、多选，也可以点击【全选】一键全选所有对话。",
            tourStep4Title: "步骤 4/4: 一键开始导出",
            tourStep4Desc: "默认导出格式为 Markdown 并自动打包为 ZIP（含高清图片与附件）。点击【导出选中 → ZIP】，马上开启您的第一次导出吧！",
            tourBtnNext: "下一步",
            tourBtnPrev: "上一步",
            tourBtnDone: "🎉 完成并开始使用",
            tourBtnSkip: "跳过教程"
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
            skipExported: "Skip Exported",
            btnClearExported: "Clear",
            btnClearExportedTip: "Clear export history markers to allow re-exporting all chats",
            includeIndex: "Include _index.json",
            includeAssets: "Download Assets",
            includeAssetsTip: "Download images and file attachments in chats",
            includeZip: "Package as ZIP",
            includeZipTip: "Bundle all files into a single ZIP archive",
            btnSetDir: "Set Folder...",
            dirNotSet: "Directory not set",
            dirCurrent: "Selected folder: {0}",
            logDirRestored: "Restored saved export directory: {0}",
            btnExportZip: "Export Selected → ZIP",
            btnExportFolder: "Export Selected → Folder",
            btnOnlyJson: "Export List JSON",
            btnCancel: "Abort Export",
            stoppingExport: "Stopping export task...",
            logLevelAll: "All Logs",
            logLevelInfo: "Info / Warn",
            logLevelWarn: "Warnings & Errors",
            logLevelError: "Errors Only",
            filterAll: "Conversations",
            filterExported: "Exported",
            filterUpdated: "Updated",
            filterUnexported: "Unexported",
            filterFailed: "Failed",
            searchPlaceholder: "Search title / ID...",
            selectAll: "All",
            selectNone: "None",
            selectUnexported: "Unexported Only",
            selectUpdated: "Updated Only",
            btnIncrementalScan: "Sync Latest",
            btnIncrementalScanTip: "Quickly fetch newly created and updated chats (recommended for daily use)",
            btnDeepScan: "Full Deep Sync",
            btnDeepScanTip: "Thoroughly fetch all conversation history for this account (recommended for first-time use)",
            btnStopScan: "Stop Sync",
            btnPruneDeleted: "Clean Deleted",
            btnPruneDeletedTip: "Compare with cloud active sessions and prune chats that were deleted on Google",
            removeChat: "Remove",
            removeChatTip: "Remove this conversation from local list",
            confirmDeleteChat: "Are you sure you want to remove \"{0}\" from the local list?",
            logChatRemoved: "[{0}] removed from local list",
            logChatDeletedAndPruned: "[{0}] ⚡ Cloud confirmed conversation doesn't exist or was deleted; automatically pruned from local list",
            logPruneStarted: "Checking cloud conversations and pruning stale local entries...",
            logPruneFinished: "Cleanup complete: pruned {0} deleted conversations, kept {1} active conversations",
            logPruneClean: "All local conversations match cloud state; no stale records found",
            btnClearAll: "Clear All",
            selectedStat: "Selected: {0} / {1}",
            emptyList: "No conversations found. Please open gemini.google.com to sync.",
            emptySearchList: "No matching conversations found.",
            noSelection: "Please select at least one conversation!",
            confirmClearExported: "Are you sure you want to clear export history? All conversations will be allowed to re-export.",
            confirmClearAll: "Are you sure you want to clear all locally synced conversations?",
            exportAborted: "Export aborted by user.",
            exportFinished: "Export completed! Success: {0}, Failed: {1}, Total: {2}",
            exportSuccess: "Export completed! {0} conversations exported.",
            exportFailed: "Export failed: {0}",
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
            currentTabMissing: "No active Gemini tab found. Please open gemini.google.com first.",
            defaultAccount: "Default Account (u0)",
            accountSlot: "Account",
            lastSync: "Last sync: {0} | Total: {1}",
            notSynced: "Not synced",
            btnCopyLog: "Copy",
            btnClearLog: "Clear",
            logFilterPlaceholder: "Filter logs (-exclude)",
            logReady: "Ready",
            btnExportDiag: "Export Diagnostics",
            btnExportDiagTip: "Export detailed diagnostic report (cursors, payloads & stop reasons)",
            copied: "Copied!",
            popupExporting: "Exporting current page...",
            popupNotGemini: "Current page is not gemini.google.com. Please open a Gemini chat page.",
            popupNoChatId: "No conversation found in current tab URL.",
            popupFoundChat: "Found conversation ID: {0}, fetching content...",
            popupFetchFailed: "Fetch failed: {0}",
            popupExported: "Exported: {0} ({1} messages)",
            popupExportError: "Export error: {0}",
            progPreparing: "Preparing...",
            progExporting: "Progress {0}/{1} ({2}%)",
            progCurrent: "Current: {0}",
            progAssets: "Assets: {0}/{1}",
            progDownloadingAssets: "Downloading remaining attachments...",
            progPackagingZip: "Packaging ZIP ({0}%)",
            progExportDone: "Completed {0}/{1}, skipped {2}",
            progAssetsSummary: "Assets: {0}/{1}",
            progSyncing: "Syncing ({0} items)...",
            progSyncProgress: "Progress {0}/{1} | Current: {2}",
            stoppingSync: "Stopping sync...",
            syncingLatest: "Syncing latest conversations...",
            deepSyncing: "Full deep sync in progress...",
            failedPrefix: "Failed",
            syncFinished: "Incremental sync completed, total {0} chats",
            deepSyncFinished: "Full sync completed, total {0} chats",
            noDiagData: "No diagnostic data yet. Please click 'Sync Latest' or 'Full Deep Sync' first.",
            browserNoDirPicker: "Directory picker not supported by this browser.",
            logFolderSelected: "Folder selected: {0}",
            logExportZipSwitched: "Switched to export as ZIP: {0}",
            logExportingChats: "Starting export for {0} conversations...",
            logExportDone: "Export complete, saved {0} conversations and {1} assets to {2}",
            btnImportTakeout: "📥 Import Takeout",
            btnImportTakeoutTip: "Load Google Takeout ZIP to recover unscannable legacy chats and enable offline asset fallback",
            btnBackup: "💾 Backup Data",
            btnBackupTip: "Export full conversation list and settings backup file (.json)",
            btnRestore: "📂 Restore Backup",
            btnRestoreTip: "Restore all conversations and settings from a JSON backup file",
            takeoutParsing: "Parsing Takeout ZIP archive...",
            takeoutParsingDetail: "Parsing conversations and indexing offline media...",
            takeoutSuccessDetail: "Takeout parsed successfully! Found {0} chats, recovered {1} legacy chats, indexed {2} offline assets",
            takeoutNotFound: "Gemini Apps activity (MyActivity.html) not found in ZIP",
            takeoutError: "Failed to parse Takeout ZIP: {0}",
            logTakeoutChatRecovered: "[{0}] ⚡ Recovered chat messages from Takeout offline archive",
            logTakeoutAssetRecovered: "[{0}] ⚡ Asset recovered from Takeout offline pool: {1}",
            logTakeoutImageRecovered: "[{0}] ⚡ Image recovered from Takeout offline pool: {1}",
            backupSuccess: "Backup file generated and download started",
            backupFailed: "Backup failed: {0}",
            restoreConfirm: "Restoring backup will replace current conversations and export markers. Continue?",
            restoreSuccess: "Successfully restored {0} conversations!",
            restoreFailed: "Failed to restore backup: {0}",
            restoreInvalidFormat: "Invalid backup file format!",
            exportSessionInterrupted: "⚠️ <b>Unfinished export task found</b>: Total {0} chats, processed {1}, {2} remaining.",
            exportSessionLastChat: " (Last paused at: \"{0}\")",
            exportSessionCompleted: "✅ <b>Previous export completed</b>: {0} conversations exported",
            exportSessionCompletedWithErrors: " ({0} failed)",
            btnResumeExport: "▶️ Resume Unfinished",
            btnDismissBanner: "✕ Dismiss",
            logFetchFailed: "Failed to fetch conversation: {0}",
            logExportSkipped: "[{0}] Export skipped: {1}",
            logExportSuccess: "[{0}] ✓ Text exported ({1})",
            logAssetFailed: "[{0}] Asset fetch failed ({1}): {2}",
            logImageFailed: "[{0}] Image fetch failed ({1}): {2}",
            logDevLogWritten: "🛠️ [Dev Mode] Full session logs and diagnostics written to _export_dev.log",
            logPackagingZip: "Packaging ZIP archive...",
            logAssetsAborted: "Asset downloading aborted by user",
            openLink: "Open",
            tourBtnGuide: "💡 Tour Guide",
            tourBtnGuideTip: "Start onboarding tour guide",
            tourStep1Title: "Step 1/4: Connect to Google Gemini",
            tourStep1NoTab: "No open Gemini tab detected. Please open and sign in to Google Gemini so the extension can access your conversations.",
            tourStep1NeedRefresh: "Gemini tab detected, but the extension script is not loaded yet. Please refresh the tab to activate connection.",
            tourStep1Connected: "Successfully connected to Google Gemini! Extension is ready.",
            tourStep1BtnOpen: "🚀 Open Google Gemini",
            tourStep1BtnRefresh: "🔄 Refresh Gemini Tab",
            tourStep1Checking: "Checking connection...",
            tourStep2Title: "Step 2/4: Sync Conversations",
            tourStep2Desc: "Click 'Sync Latest' to fetch newly updated chats in seconds. Use 'Full Deep Sync' if you want all historical chats.",
            tourStep3Title: "Step 3/4: Select Conversations",
            tourStep3Desc: "Check the conversations you wish to export in the list. You can select individual items or click 'All' to select all.",
            tourStep4Title: "Step 4/4: Start Export",
            tourStep4Desc: "Default format is Markdown bundled in a ZIP archive with images. Click 'Export Selected → ZIP' to complete your first export!",
            tourBtnNext: "Next",
            tourBtnPrev: "Back",
            tourBtnDone: "🎉 Got it & Start",
            tourBtnSkip: "Skip Tour"
        }
    };

    let currentLang = 'en';
    const langChangeListeners = new Set();

    async function initLanguage() {
        try {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                const data = await chrome.storage.local.get('gemini_exporter_lang');
                if (data.gemini_exporter_lang && LOCALES[data.gemini_exporter_lang]) {
                    currentLang = data.gemini_exporter_lang;
                } else {
                    const sys = (typeof navigator !== 'undefined' ? navigator.language || '' : '').toLowerCase();
                    currentLang = sys.startsWith('zh') ? 'zh' : 'en';
                }
            } else {
                currentLang = 'zh';
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
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({ gemini_exporter_lang: lang });
            }
        } catch {}
        applyI18n();
        for (const listener of langChangeListeners) {
            try { listener(currentLang); } catch (e) { console.error('langChangeListener err', e); }
        }
    }

    function onLanguageChange(fn) {
        if (typeof fn === 'function') langChangeListeners.add(fn);
    }

    function t(key, ...args) {
        let str = LOCALES[currentLang]?.[key] || LOCALES['zh']?.[key] || LOCALES['en']?.[key] || key;
        if (args.length) {
            args.forEach((val, idx) => {
                str = str.replace(new RegExp(`\\{${idx}\\}`, 'g'), val != null ? val : '');
            });
        }
        return str;
    }

    function applyI18n(container) {
        if (typeof document === 'undefined') return;
        const root = container || document;

        // 1. Text content: data-i18n
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const val = t(key);
            if (val) el.textContent = val;
        });

        // 2. HTML content: data-i18n-html
        root.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            const val = t(key);
            if (val) el.innerHTML = val;
        });

        // 3. Tooltips / Titles: data-i18n-title
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const val = t(key);
            if (val) el.title = val;
        });

        // 4. Input Placeholders: data-i18n-placeholder
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const val = t(key);
            if (val) el.placeholder = val;
        });

        // 5. Language Switch UI State
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

    return {
        LOCALES,
        initLanguage,
        getLang,
        setLang,
        onLanguageChange,
        t,
        applyI18n
    };
}));
