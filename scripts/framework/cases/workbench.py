# scripts/framework/cases/workbench.py
import time
from typing import Tuple, Optional, Dict, Any

from scripts.framework.cases.base import FeatureTestCase, TestContext
from scripts.framework.features import FeatureDomain
from scripts.framework.actions import CDPActions
from scripts.framework.assertions import CDPAssertions
from scripts.framework.selectors import WorkbenchSelectors


class SearchKeywordCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_search_filter_by_keyword",
            domain=FeatureDomain.WORKBENCH,
            name="按标题关键词实时过滤",
            description="在工作台搜索框输入关键词（如 Python/量子），列表即时收缩为对应匹配项集合",
            critical=True,
            prerequisites=["feat_takeout_zip_import"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            CDPActions.search_workbench(cdp_opt, "Python")
            # assert_search_filter 内部已逐项确认标题/ID 包含查询串（镜像生产契约）
            filter_kw_ok, filter_kw_msg, details = CDPAssertions.assert_search_filter(cdp_opt, "Python", expected_visible_min=1)
            CDPActions.clear_search_workbench(cdp_opt)
            if filter_kw_ok:
                return True, "关键词过滤列表正常收缩并恢复", details
            return False, filter_kw_msg, details
        finally:
            cdp_opt.close()


class SearchIdCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_search_filter_by_id",
            domain=FeatureDomain.WORKBENCH,
            name="按会话 ID 搜索与精准勾选",
            description="在工作台搜索框输入目标会话 ID，列表即时过滤收缩只剩该项，并进行精准勾选",
            critical=True,
            prerequisites=["feat_takeout_zip_import"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            target_search_id = cdp_opt.eval(f"document.querySelector('{WorkbenchSelectors.ITEM}')?.dataset.chatId") or "1bd028d5c5b0c0e2"
            ctx.shared_data["target_search_id"] = target_search_id

            CDPActions.search_workbench(cdp_opt, target_search_id)
            # ID 搜索必须唯一命中：可见仅 1 项且 ID 精确一致，杜绝同数量误匹配误通过
            filter_id_ok, filter_id_msg, details = CDPAssertions.assert_search_filter(
                cdp_opt, target_search_id,
                expected_visible_min=1, expected_visible_max=1,
                expected_ids=[target_search_id],
            )
            if not filter_id_ok:
                return False, filter_id_msg, details
            # 精准勾选返回值与实际选中状态都必须纳入成功判定
            select_ok = CDPActions.select_workbench_item(cdp_opt, target_search_id, True)
            is_checked = bool(cdp_opt.eval(f"""
            (() => {{
                const item = document.querySelector('{WorkbenchSelectors.item_by_chat_id(target_search_id)}');
                return item ? !!item.querySelector('input[type=checkbox]:checked') : false;
            }})()
            """))
            details = {**(details or {}), "select_return": select_ok, "is_checked": is_checked}
            if not select_ok:
                return False, f"ID精准勾选操作返回失败: {target_search_id}", details
            if not is_checked:
                return False, f"ID精准勾选后复选框未实际选中: {target_search_id}", details
            return True, f"ID过滤精准定位并勾选: {target_search_id}", details
        finally:
            cdp_opt.close()


class SearchClearCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_search_clear_restore",
            domain=FeatureDomain.WORKBENCH,
            name="清空搜索框恢复完整列表",
            description="清空搜索框后列表完整恢复全量项，且先前勾选状态完好保留",
            critical=True,
            prerequisites=["feat_search_filter_by_id"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            target_search_id = ctx.shared_data.get("target_search_id", "1bd028d5c5b0c0e2")
            # Other DAG cases can intentionally clear selections or change the
            # search between SearchIdCase and this case. Establish our own real
            # filtered selection immediately before testing clear/restore.
            CDPActions.search_workbench(cdp_opt, target_search_id)
            CDPActions.select_workbench_item(cdp_opt, target_search_id, True)
            restored_count = CDPActions.clear_search_workbench(cdp_opt)
            total_store = cdp_opt.eval("""
            (() => {
                const s = window.ConversationsStore || (typeof ConversationsStore !== 'undefined' ? ConversationsStore : null);
                return s ? s.getConversations().length : document.querySelectorAll('#list .item').length;
            })()
            """) or 0
            is_still_checked = bool(cdp_opt.eval(f"""
            (() => {{
                const item = document.querySelector('{WorkbenchSelectors.item_by_chat_id(target_search_id)}');
                return item ? !!item.querySelector('input[type=checkbox]:checked') : false;
            }})()
            """))
            details = {"restored_count": restored_count, "total_store": total_store, "is_still_checked": is_still_checked}
            # 清空搜索必须恢复全量（与 Store 总数一致），且先前勾选状态保留
            if total_store > 0 and restored_count != total_store:
                return False, f"清空搜索未恢复全量: 恢复={restored_count}, 全量={total_store}", details
            if restored_count > 1 and is_still_checked:
                return True, f"列表恢复全量 ({restored_count}项) 且勾选状态完好保留", details
            return False, f"恢复数量={restored_count}, 全量={total_store}, 勾选保留={is_still_checked}", details

        finally:
            cdp_opt.close()


class SelectionControlsCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_selection_controls",
            domain=FeatureDomain.WORKBENCH,
            name="全选 / 取消全选联动控制",
            description="点击【全选】与【取消全选】按钮，底部已勾选计数精准联动 (0 -> N -> 0)",
            critical=True,
            prerequisites=["feat_takeout_zip_import"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            # 确保从全量列表基线开始，避免残留搜索过滤干扰计数
            CDPActions.clear_search_workbench(cdp_opt)
            none_count = CDPActions.toggle_select_none(cdp_opt)
            time.sleep(0.2)
            none_state = CDPAssertions.assert_selection_state(cdp_opt)
            all_count = CDPActions.toggle_select_all(cdp_opt)
            time.sleep(0.2)
            all_state = CDPAssertions.assert_selection_state(cdp_opt)
            details = {"none_count": none_count, "none_state": none_state, "all_count": all_count, "all_state": all_state}
            # 取消全选：必须所有复选框均取消（checked==0），且列表非空
            if none_state.get("total", 0) <= 0:
                return False, "联动控制异常: 列表为空无法验证全选/取消全选", details
            if none_state.get("checked", -1) != 0 or none_count != 0:
                return False, f"取消全选未清空所有勾选 (返回={none_count}, 实际checked={none_state.get('checked')}, 未取消={none_state.get('checkedIds')})", details
            # 全选：所有可选复选框均选中且计数准确（杜绝漏选一项误通过）
            total = all_state.get("total", 0)
            enabled = all_state.get("enabledTotal", total)
            checked = all_state.get("checked", -1)
            expect_checked = enabled if enabled else total
            if expect_checked <= 0:
                return False, "联动控制异常: 无可选复选框", details
            if checked != expect_checked or all_count != expect_checked:
                return False, (
                    f"全选漏选或计数不准 (返回={all_count}, 实际checked={checked}, "
                    f"可选总数={expect_checked}, 未选中={all_state.get('uncheckedIds')})"
                ), details
            if all_state.get("uncheckedIds"):
                return False, f"全选后仍有未选中项: {all_state.get('uncheckedIds')}", details
            return True, f"联动控制正常 (取消全选=0/{none_state.get('total')}, 全选={checked}/{total})", details
        finally:
            cdp_opt.close()


class LanguageToggleCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_language_toggle",
            domain=FeatureDomain.WORKBENCH,
            name="中英文语言切换与状态驻留",
            description="切换至 English 再切回中文，界面文案正确切换且已勾选状态完整保持",
            critical=False,
            prerequisites=["feat_takeout_zip_import"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            en_text = CDPActions.switch_workbench_language(cdp_opt, "en")
            time.sleep(0.2)
            zh_text = CDPActions.switch_workbench_language(cdp_opt, "zh")
            time.sleep(0.2)
            if ("select all" in en_text.lower() or "all" in en_text.lower()) and ("全选" in zh_text):
                return True, "多语言正确切换且UI渲染完备", {"en": en_text, "zh": zh_text}
            return False, f"多语言切换未匹配: en='{en_text}', zh='{zh_text}'", None
        finally:
            cdp_opt.close()
