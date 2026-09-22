# scripts/framework/cases/export.py
import os
import json
import time
from typing import Tuple, Optional, Dict, Any

from scripts.framework.cases.base import FeatureTestCase, TestContext
from scripts.framework.features import FeatureDomain
from scripts.framework.actions import CDPActions
from scripts.framework.assertions import CDPAssertions
from scripts.framework.selectors import WorkbenchSelectors

DESIGNATED_HISTORICAL_CHATS = [
    {
        "id": "1bd028d5c5b0c0e2",
        "category": "AI 生成图片 (Imagen)",
        "name": "火星宇航员猫咪（AI 生成图片 Imagen）",
        "expected_snippets": ["astronaut cat"],
        "expected_generated_images": 1,
        "syntax_checks": ["image"]
    },
    {
        "id": "1cea7e48cc166b57",
        "category": "高质量技术代码块 (Python)",
        "name": "Python日志与耗时装饰器设计（高质量技术代码块）",
        "expected_snippets": ["Python", "def ", "functools"],
        "syntax_checks": ["codeblock"]
    },
    {
        "id": "7b29852ecae8344a",
        "category": "Markdown 对比表格与量子理论",
        "name": "贝尔不等式推导与物理意义（复杂表格与量子理论）",
        "expected_snippets": ["贝尔不等式"],
        "syntax_checks": ["table"]
    },
    {
        "id": "f8ba969fe8c7d880",
        "category": "长文本深度推演 (深空探测)",
        "name": "韦伯望远镜深空探测重大发现（长文本科学报告）",
        "expected_snippets": ["韦伯", "深空探测"],
        "syntax_checks": []
    },
    {
        "id": "533ac8ca2ecb8bd7",
        "category": "用户文件附件 (JSON/Docs)",
        "name": "测试配置文件加载（用户文件附件 JSON）",
        "expected_snippets": ["test_config.json"],
        "expected_file_attachments": ["test_config.json"],
        "syntax_checks": [],
        "optional": True
    }
]


class LiveDiskAutoSaveCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_live_auto_save_disk_write",
            domain=FeatureDomain.EXPORT_DISK,
            name="物理磁盘实时落盘与非零字节核验",
            description="直接扫描本地磁盘 gemini_export/ 目录，验证 .md 文件及 assets/ 所有图片 > 0 字节",
            critical=True,
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            live_cfg = cdp_opt.eval("""
            (() => {
                return new Promise((resolve) => {
                    chrome.storage.local.get(['live_save_config'], (data) => {
                        resolve(data.live_save_config || null);
                    });
                });
            })()
            """, await_promise=True) or {}

            is_live_disk_enabled = bool(live_cfg.get("enabledDisk"))
            live_dir_name = live_cfg.get("dirName") or ""

            if not is_live_disk_enabled:
                return True, "扩展未启用实时磁盘保存，跳过物理磁盘扫描 (live_save_config.enabledDisk != true)", {"skipped_reason": "not_enabled"}

            target_cids = [r["chat_id"] for r in ctx.chat_records if r.get("chat_id")]
            candidate_dirs = [
                os.path.join(os.path.expanduser("~"), "Downloads", live_dir_name),
                os.path.join(os.path.expanduser("~"), "Downloads", "gemini"),
                os.path.join(os.path.expanduser("~"), "Downloads")
            ]
            valid_live_dir = next((d for d in candidate_dirs if os.path.isdir(d)), None)
            if not valid_live_dir:
                return False, f"已配置实时落盘但本地目录不存在 (dirName: '{live_dir_name}')", None

            disk_ok, disk_msg, disk_data = CDPAssertions.assert_real_disk_live_save(
                target_dir=valid_live_dir,
                target_chat_ids=target_cids,
                min_mtime=ctx.start_time
            )
            if disk_ok:
                return True, disk_msg, disk_data
            return False, disk_msg, disk_data
        finally:
            cdp_opt.close()


class ZipExportDownloadCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_zip_export_download",
            domain=FeatureDomain.EXPORT_DISK,
            name="手动勾选 ZIP 导出与落盘",
            description="点击【导出选中 -> ZIP】主按钮，进度条视觉反馈，下载落盘并校验文件非空",
            critical=True,
            prerequisites=[
                "feat_search_clear_restore",
                "feat_authoritative_title_upgrade"
            ]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            # 确保搜索框已彻底清空并恢复全量工作台项目
            CDPActions.clear_search_workbench(cdp_opt)
            time.sleep(0.5)

            target_ids = []
            target_ids.extend([r["chat_id"] for r in ctx.chat_records if r.get("chat_id") and len(str(r["chat_id"])) > 8])
            target_ids.extend([h["id"] for h in DESIGNATED_HISTORICAL_CHATS])

            target_titles = ["Martian Astronaut Cat", "Python日志与耗时装饰器", "贝尔不等式推导与物理意义", "韦伯望远镜深空探测重大发现", "Test Configuration Status Load"]

            check_res = cdp_opt.eval(f"""
            (() => {{
                const searchInput = document.getElementById('chatSearchInput') || document.getElementById('search');
                if (searchInput && searchInput.value) {{
                    searchInput.value = '';
                    searchInput.dispatchEvent(new Event('input', {{ bubbles: true }}));
                }}
                const selectNone = document.getElementById('btnSelectNone');
                if (selectNone) selectNone.click();
                const targetIds = {json.dumps(target_ids)};
                const targetTitles = {json.dumps(target_titles)};
                const items = Array.from(document.querySelectorAll('#list .item'));
                let checkedCount = 0;
                const matchedList = [];
                items.forEach(item => {{
                    const cid = item.dataset.chatId;
                    const titleText = item.querySelector('.chat-title, .title')?.textContent || '';
                    const matchId = targetIds.some(tid => cid && (cid === tid || cid.includes(tid) || tid.includes(cid)));
                    const matchTitle = targetTitles.some(tt => tt && tt.length > 2 && (titleText.includes(tt) || tt.includes(titleText)));
                    if (matchId || matchTitle) {{
                        const cb = item.querySelector('input[type=checkbox]');
                        if (cb && !cb.checked) {{
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            checkedCount++;
                            matchedList.push({{ id: cid, title: titleText }});
                        }}
                    }}
                }});
                return {{
                    totalItems: items.length,
                    checkedCount: checkedCount,
                    matched: matchedList
                }};
            }})()
            """) or {}
            time.sleep(0.5)

            checked_count = check_res.get("checkedCount", 0)
            expected_min_checked = 6 if ctx.chat_records else 4
            if checked_count < expected_min_checked:
                return False, f"工作台勾选数不足: 实际 {checked_count} < 预期 {expected_min_checked}", check_res

            downloaded_zip = CDPActions.trigger_export_zip(cdp_opt, ctx.output_dir, max_wait=60)
            if downloaded_zip and os.path.isfile(downloaded_zip) and os.path.getsize(downloaded_zip) > 0:
                ctx.shared_data["downloaded_zip"] = downloaded_zip
                size = os.path.getsize(downloaded_zip)
                return True, f"ZIP 导出成功落盘: {os.path.basename(downloaded_zip)} ({size} bytes)", {"zip_path": downloaded_zip, "size": size}
            return False, "未能成功下载或落盘 ZIP 文件", None
        finally:
            cdp_opt.close()


class MultimodalSpecCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_multimodal_spec_assertion",
            domain=FeatureDomain.EXPORT_DISK,
            name="4 大黄金分类规范断言",
            description="解压导出的 ZIP，严格断言 Frontmatter 7 键、附件非空、AI Imagen 模型归属",
            critical=True,
            prerequisites=["feat_zip_export_download"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        downloaded_zip = ctx.shared_data.get("downloaded_zip")
        if not downloaded_zip or not os.path.isfile(downloaded_zip):
            return False, "未找到有效的 ZIP 文件用于多模态规范断言", None

        extract_dir = os.path.join(ctx.output_dir, "extracted_verify_" + str(int(time.time())))
        golden_chats = [dict(c) for c in DESIGNATED_HISTORICAL_CHATS]
        expected_scenarios = ctx.scenarios[:2] if ctx.chat_records else []
        min_conversations = 6 if ctx.chat_records else 4
        uploaded_files = [ctx.shared_data["uploaded_test_file"]] if "uploaded_test_file" in ctx.shared_data else None

        spec_ok, spec_msg, spec_data = CDPAssertions.assert_exported_zip_spec(
            zip_path=downloaded_zip,
            extract_dir=extract_dir,
            min_conversations=min_conversations,
            expected_golden_chats=golden_chats,
            expected_scenarios=expected_scenarios,
            uploaded_files=uploaded_files
        )

        if spec_ok:
            return True, spec_msg, spec_data
        return False, spec_msg, spec_data


class FastSkipExportedCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_fast_skip_exported",
            domain=FeatureDomain.EXPORT_DISK,
            name="跳过已导出会话前置极速过滤",
            description="勾选【跳过已导出】时，已导出会话前置分流瞬间跳过（防空 ZIP 保护），含新会话时精准分流导出",
            critical=True,
            prerequisites=["feat_multimodal_spec_assertion"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            # 确保清空搜索框
            CDPActions.clear_search_workbench(cdp_opt)
            time.sleep(0.5)

            # 步骤 1：全量跳过与防空 ZIP 保护断言 (All-Skip Fast Path)
            target_ids = []
            target_ids.extend([r["chat_id"] for r in ctx.chat_records if r.get("chat_id") and len(str(r["chat_id"])) > 8])
            target_ids.extend([h["id"] for h in DESIGNATED_HISTORICAL_CHATS])
            target_titles = ["Martian Astronaut Cat", "Python日志与耗时装饰器", "贝尔不等式推导与物理意义", "韦伯望远镜深空探测重大发现", "Test Configuration Status Load"]

            select_res = cdp_opt.eval(f"""
            (() => {{
                const selectNone = document.getElementById('btnSelectNone');
                if (selectNone) selectNone.click();
                document.querySelectorAll('#list input[type=checkbox]').forEach(cb => {{
                    if (cb.checked) {{
                        cb.checked = false;
                        cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                    }}
                }});

                const targetIds = {json.dumps(target_ids)};
                const targetTitles = {json.dumps(target_titles)};
                const items = Array.from(document.querySelectorAll('#list .item'));
                let checkedCount = 0;
                items.forEach(item => {{
                    const cid = item.dataset.chatId;
                    const titleText = item.querySelector('.chat-title, .title')?.textContent || '';
                    const hasBadge = Boolean(item.querySelector('.badge-exported'));
                    const matchId = targetIds.some(tid => cid && (cid === tid || cid.includes(tid) || tid.includes(cid)));
                    const matchTitle = targetTitles.some(tt => tt && tt.length > 2 && (titleText.includes(tt) || tt.includes(titleText)));
                    if (hasBadge || matchId || matchTitle) {{
                        const cb = item.querySelector('input[type=checkbox]');
                        if (cb) {{
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            checkedCount++;
                        }}
                    }}
                }});
                const skipCb = document.getElementById('skipExported');
                if (skipCb && !skipCb.checked) {{
                    skipCb.checked = true;
                    skipCb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                const zipCb = document.getElementById('includeZip');
                if (zipCb && !zipCb.checked) {{
                    zipCb.checked = true;
                    zipCb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                const actualChecked = document.querySelectorAll('#list input[type=checkbox]:checked').length;
                return {{ checkedCount, actualChecked }};
            }})()
            """) or {}

            actual_checked = select_res.get("actualChecked", 0)
            if actual_checked < 6:
                return False, f"未能在工作台中勾选足够的已导出会话: actualChecked={actual_checked} < 6", select_res

            # 触发导出前记录时间戳与当前输出目录文件列表
            start_t = time.time()
            existing_files = set(os.listdir(ctx.output_dir)) if os.path.isdir(ctx.output_dir) else set()

            # 点击导出
            cdp_opt.eval(f"document.querySelector('{WorkbenchSelectors.BTN_EXPORT}')?.click();")

            # 等待极速跳过完成（至多 6 秒，正常情况下在 0.5s 之内瞬间完成）
            completed = False
            skip_log_found = False
            finish_msg = ""
            for _ in range(12):
                time.sleep(0.5)
                status_info = cdp_opt.eval(f"""
                (() => {{
                    const progText = document.getElementById('progText')?.textContent || '';
                    const logEl = document.querySelector('{WorkbenchSelectors.LOG}') || document.getElementById('log');
                    const logText = logEl ? logEl.textContent : '';
                    const btn = document.querySelector('{WorkbenchSelectors.BTN_EXPORT}');
                    const isBusy = btn && btn.disabled;
                    const hasSkip = logText.includes('跳过') || logText.includes('skipped') || logText.includes('无需生成 ZIP') ||
                                    progText.includes('跳过') || progText.includes('skipped') || progText.includes('无需生成 ZIP');
                    return {{
                        progText,
                        logSnippet: logText.slice(-200),
                        hasSkipLog: Boolean(hasSkip),
                        isBusy: Boolean(isBusy)
                    }};
                }})()
                """) or {}
                if status_info.get("hasSkipLog"):
                    skip_log_found = True
                if not status_info.get("isBusy") and status_info.get("hasSkipLog"):
                    completed = True
                    finish_msg = status_info.get("progText", "") or status_info.get("logSnippet", "")
                    break

            all_skip_duration = time.time() - start_t
            if not completed or not skip_log_found:
                return False, f"全量已导出会话未在预期时间内瞬间跳过: duration={all_skip_duration:.2f}s, msg={finish_msg}", None

            # 检查输出目录，验证没有生成新的空 ZIP 文件 (防空 ZIP 保护)
            current_files = set(os.listdir(ctx.output_dir)) if os.path.isdir(ctx.output_dir) else set()
            new_zips = [f for f in (current_files - existing_files) if f.endswith(".zip")]
            if new_zips:
                return False, f"全量跳过时异常生成了无内容 ZIP 包: {new_zips}", None

            # 步骤 2：部分跳过与分流导出断言 (Partial Skip + Export)
            partial_prep = cdp_opt.eval("""
            (() => {
                const selectNone = document.getElementById('btnSelectNone');
                if (selectNone) selectNone.click();
                document.querySelectorAll('#list input[type=checkbox]').forEach(cb => {
                    if (cb.checked) {
                        cb.checked = false;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                const items = Array.from(document.querySelectorAll('#list .item'));
                let unexportedItem = null;
                let exportedItem = null;
                for (const it of items) {
                    const hasExportedBadge = it.querySelector('.badge-exported');
                    if (hasExportedBadge && !exportedItem) {
                        exportedItem = it;
                    } else if (!hasExportedBadge && !unexportedItem) {
                        unexportedItem = it;
                    }
                    if (exportedItem && unexportedItem) break;
                }
                if (exportedItem) {
                    const cb = exportedItem.querySelector('input[type=checkbox]');
                    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
                }
                if (unexportedItem) {
                    const cb = unexportedItem.querySelector('input[type=checkbox]');
                    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
                }
                const skipCb = document.getElementById('skipExported');
                if (skipCb && !skipCb.checked) {
                    skipCb.checked = true;
                    skipCb.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return {
                    hasExported: Boolean(exportedItem),
                    hasUnexported: Boolean(unexportedItem),
                    exportedTitle: exportedItem?.querySelector('.chat-title')?.textContent || '',
                    unexportedTitle: unexportedItem?.querySelector('.chat-title')?.textContent || ''
                };
            })()
            """) or {}

            if partial_prep.get("hasExported") and partial_prep.get("hasUnexported"):
                partial_zip = CDPActions.trigger_export_zip(cdp_opt, ctx.output_dir, max_wait=30, skip_exported=True)
                if not partial_zip or not os.path.isfile(partial_zip):
                    return False, "部分跳过导出时未能成功生成未导出会话的 ZIP 包", partial_prep

            return True, f"已导出会话前置极速过滤与防空 ZIP 保护验证通过 (全量跳过耗时 {all_skip_duration:.2f}s，防空 ZIP 生效)", {
                "all_skip_duration": all_skip_duration,
                "finish_msg": finish_msg,
                "partial_prep": partial_prep
            }
        finally:
            cdp_opt.close()
