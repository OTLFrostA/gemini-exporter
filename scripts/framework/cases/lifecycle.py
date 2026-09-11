# scripts/framework/cases/lifecycle.py
import time
from typing import Tuple, Optional, Dict, Any

from scripts.framework.cases.base import FeatureTestCase, TestContext
from scripts.framework.features import FeatureDomain
from scripts.framework.actions import CDPActions
from scripts.framework.assertions import CDPAssertions

try:
    from scripts.cdp_client import CDPConnection
except ImportError:
    from cdp_client import CDPConnection


class ContinuedChatPromotionCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_continued_chat_promotion",
            domain=FeatureDomain.LIFECYCLE,
            name="老会话追加提问实时置顶",
            description="回访较早创建的会话追加提问，STREAM_COMPLETE 触发后在 Options 列表无刷新置顶至首位",
            critical=True,
            prerequisites=["feat_chat_generation"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        if len(ctx.chat_records) < 2:
            return False, "会话记录不足 2 个，无法验证老会话置顶升权", None

        s1_id = ctx.chat_records[0].get("chat_id")
        s2_id = ctx.chat_records[1].get("chat_id")
        if not s1_id or not s2_id or s1_id == s2_id:
            return False, f"会话 ID 无效或重复 (s1={s1_id}, s2={s2_id})", None

        print(f"\n   🔄 回访较早创建的会话 1 ({s1_id}) 进行追加提问...")
        cdp_g2 = ctx.connect_gemini()
        try:
            cdp_g2.eval(f"location.href = 'https://gemini.google.com/app/{s1_id}'")
            time.sleep(2.5)
            try:
                cdp_g2.reconnect()
            except Exception:
                pass
            CDPActions.wait_for_gemini_ready(cdp_g2, max_wait=15)

            add_turn = "针对刚才深入探讨的系统架构设计，请再补充一条关于线上压测与容量规划的核心避坑建议，保持极简总结。"
            print(f"      ▶️ 追加提问: '{add_turn[:36]}...'")
            ok_add, msg_add = CDPActions.send_gemini_turn(cdp_g2, add_turn, max_wait=120)
            if ok_add:
                ctx.chat_records[0]["turns"].append(add_turn)
                return True, "老会话追加提问成功完成并触发 STREAM_COMPLETE", None
            return False, f"追加提问失败: {msg_add}", None
        finally:
            cdp_g2.close()


class UpdatedBadgeDisplayCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_updated_badge_display",
            domain=FeatureDomain.LIFECYCLE,
            name="「已更新」徽章与智能勾选",
            description="已导出过的会话检测到新提问后，渲染琥珀色「已更新」徽章并被默认自动勾选",
            critical=True,
            prerequisites=["feat_continued_chat_promotion"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        if len(ctx.chat_records) < 2:
            return False, "会话记录不足 2 个", None

        s1_id = ctx.chat_records[0].get("chat_id")
        s2_id = ctx.chat_records[1].get("chat_id")
        if not s1_id or not s2_id:
            return False, "会话 ID 无效", None

        cdp_opt = ctx.connect_options()
        try:
            # 严格禁止任何直接写入 chrome.storage.local 的后门作弊！
            # 真实断言：因之前 Chat 1 已真实导出落盘，且刚完成追加提问，
            # 页面已通过真实事件将 Chat 1 提升至列表首位，并自然判定为已更新状态
            time.sleep(1.0)
            order_ok, order_msg, _ = CDPAssertions.assert_realtime_order(cdp_opt, s1_id, s2_id)
            badge_ok, badge_msg, _ = CDPAssertions.assert_badge_status(cdp_opt, s1_id, "updated")

            if order_ok and badge_ok:
                return True, f"真实置顶与徽章双重断言通过: {order_msg}; {badge_msg}", None
            return False, f"真实断言未通过: Order={order_msg} | Badge={badge_msg}", None
        finally:
            cdp_opt.close()


class EphemeralChatPruningCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_ephemeral_chat_pruning",
            domain=FeatureDomain.LIFECYCLE,
            name="瞬态会话网页端删除实时剥离",
            description="在网页端侧边栏删除会话，Options 列表与 Storage 在无需刷新情况下平滑剥离该项",
            critical=True,
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_gem_live = ctx.connect_gemini()
        cdp_opt = ctx.connect_options()
        try:
            cdp_gem_live.eval("location.href = 'https://gemini.google.com/app'")
            time.sleep(2.0)
            try:
                cdp_gem_live.reconnect()
            except Exception:
                pass

            eph_query = ctx.provider.pop_ephemeral_query()
            print(f"   ▶️ 生成瞬态会话用于删除测试: '{eph_query[:30]}...'")
            ok_eph, msg_eph = CDPActions.send_gemini_turn(cdp_gem_live, eph_query, max_wait=90)
            if not ok_eph:
                return False, f"瞬态会话发帖超时: {msg_eph}", None

            eph_chat_id = CDPActions.get_current_chat_id(cdp_gem_live)
            if not eph_chat_id:
                return False, "未能获取瞬态会话 ID", None

            ctx.tracker.track(eph_chat_id)
            print(f"   🗑️ 成功生成瞬态会话 ({eph_chat_id})，在侧边栏触发网页原生删除...")
            del_ok = CDPActions.delete_conversation_via_web(cdp_gem_live, eph_chat_id)
            if del_ok:
                ctx.tracker.mark_deleted(eph_chat_id)

            pruned_ok, pruned_msg, _ = CDPAssertions.assert_dom_pruned(cdp_opt, eph_chat_id, timeout=5.0)
            if pruned_ok:
                return True, "瞬态会话已实时剥离 DOM 与本地 Storage", None
            return False, f"DOM剥离校验失败: {pruned_msg}", None
        finally:
            cdp_gem_live.close()
            cdp_opt.close()
