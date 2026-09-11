# scripts/framework/cases/export.py
import os
import json
import time
from typing import Tuple, Optional, Dict, Any

from scripts.framework.cases.base import FeatureTestCase, TestContext
from scripts.framework.features import FeatureDomain
from scripts.framework.actions import CDPActions
from scripts.framework.assertions import CDPAssertions

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
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            target_ids = []
            target_titles = []
            target_ids.extend([r["chat_id"] for r in ctx.chat_records if r.get("chat_id") and len(str(r["chat_id"])) > 8])
            target_titles.extend([r.get("title", "") for r in ctx.chat_records if r.get("title")])

            target_ids.extend([h["id"] for h in DESIGNATED_HISTORICAL_CHATS])
            target_titles.extend(["Martian Astronaut Cat", "Python日志与耗时装饰器", "贝尔不等式推导与物理意义", "韦伯望远镜深空探测重大发现"])

            check_res = cdp_opt.eval(f"""
            (() => {{
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
            expected_min_checked = 6
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
        expected_scenarios = ctx.scenarios[:2]

        spec_ok, spec_msg, spec_data = CDPAssertions.assert_exported_zip_spec(
            zip_path=downloaded_zip,
            extract_dir=extract_dir,
            min_conversations=6,
            expected_golden_chats=golden_chats,
            expected_scenarios=expected_scenarios
        )

        if spec_ok:
            return True, spec_msg, spec_data
        return False, spec_msg, spec_data
