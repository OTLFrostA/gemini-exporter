#!/usr/bin/env python3
"""
scripts/framework/lifecycle_tracker.py
--------------------------------------
Gemini Exporter 在线测试会话生命周期回收管理器 (SessionLifecycleTracker).

核心铁律：
1. 记录测试全过程中产生的所有在线会话 ID（无论正常完成还是中间异常熔断）；
2. 践行“用一条删一条、跑完即焚 (Teardown Cleanup)”原则；
3. 在测试结束（无论 PASS 或 FAIL）由 try...finally 自动触发物理删除，坚决杜绝测试会话污染用户个人账号侧边栏；
4. 仅在显式传入 `--keep-chats` 时豁免删除以供人工排障。
"""

import sys
import os
import time
from typing import List, Set


class SessionLifecycleTracker:
    """在线会话生命周期追踪与自动回收器"""

    def __init__(self):
        self._tracked_chat_ids: List[str] = []
        self._deleted_chat_ids: Set[str] = set()

    def track(self, chat_id: str):
        """登记新创建的在线会话 ID"""
        if chat_id and chat_id not in self._tracked_chat_ids:
            self._tracked_chat_ids.append(chat_id)
            print(f"   📋 [生命周期追踪] 已登记测试会话 ID: {chat_id} (当前总计: {len(self._tracked_chat_ids)} 个)")

    def mark_deleted(self, chat_id: str):
        """标记某个会话已在测试中被提前销毁 (例如瞬态自毁测试)"""
        if chat_id:
            self._deleted_chat_ids.add(chat_id)

    def teardown(self, cdp_gemini, keep_chats: bool = False) -> int:
        """
        在测试执行器 finally 阶段统一执行自动回收。
        遍历所有已登记且未被销毁的会话，通过网页端真实三点菜单逐一彻底删除。
        """
        if keep_chats:
            print(f"\n💡 [生命周期回收] 检测到 --keep-chats 标志，已豁免物理删除 (保留 {len(self._tracked_chat_ids)} 个测试会话以供人工审计)")
            return 0

        to_delete = [cid for cid in self._tracked_chat_ids if cid not in self._deleted_chat_ids]
        if not to_delete:
            print("\n🧹 [生命周期回收] 没有需要清理的残留测试会话，环境完全纯净。")
            return 0

        print(f"\n🧹 [生命周期回收] 启动全自动 Teardown 清理，正在物理销毁本次测试产生的 {len(to_delete)} 个在线会话...")
        from scripts.framework.actions import CDPActions

        success_count = 0
        for cid in reversed(to_delete):
            print(f"   🗑️ 正在物理销毁测试会话: [{cid}]...")
            try:
                ok = CDPActions.delete_conversation_via_web(cdp_gemini, cid)
                if ok:
                    success_count += 1
                    self._deleted_chat_ids.add(cid)
                    print(f"      ✓ 会话 [{cid}] 已彻底从云端账号销毁！")
                else:
                    print(f"      ⚠️ 网页端删除操作未完全响应 [{cid}]")
            except Exception as e:
                print(f"      ⚠️ 删除会话异常 [{cid}]: {e}")
            time.sleep(1.0)

        print(f"✨ [生命周期回收完成] 共彻底销毁 {success_count}/{len(to_delete)} 个在线测试会话，已恢复零污染干净环境！\n")
        return success_count
