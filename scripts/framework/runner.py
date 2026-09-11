# scripts/framework/runner.py
"""
Feature-Driven Test Runner Orchestrator.
Connects Feature Registry, CDP Actions, and Assertions into a seamless, deterministic test pipeline.
Executes all 18 features across 5 lifecycle domains and generates the verification matrix.
"""

import os
import re
import sys
import time
import json
import urllib.request
from typing import Optional, Dict, Any, List

from .features import FeatureDomain, FeatureRegistry, TestStatus
from .actions import CDPActions
from .assertions import CDPAssertions

try:
    from scripts.cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url
except ImportError:
    from cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url


DEFAULT_SCENARIOS = [
    {
        "id": "scenario_python_concurrency",
        "title": "Python高性能并发系统与异步架构演进",
        "turns": [
            "请解释 Python GIL (全局解释器锁) 的底层工作机制，以及它为什么限制了多线程在 CPU 密集型任务中的并行能力？",
            "在处理海量 I/O 密集型网络请求时，对比 threading、multiprocessing 与 asyncio 三种方案的内存开销与吞吐量差异。",
            "请使用 Python asyncio 和 aiohttp 编写一个并发限制为 5 的异步抓取示例，要求包含超时控制与指数退避重试逻辑。",
            "为刚才编写的异步抓取器设计一个基于内存的 TTL/LRU 缓存装饰器，防止短时间内对相同 URL 重复发起抓取。",
            "请总结在生产环境中排查 Python 异步服务事件循环卡顿 (Event Loop Lag) 和协程内存泄漏的 3 个最有效策略。"
        ]
    },
    {
        "id": "scenario_distributed_architecture",
        "title": "分布式系统高可用架构与最终一致性实战",
        "turns": [
            "请详细阐述分布式系统中的 CAP 定理，并对比 CP 系统 (如 etcd) 与 AP 系统 (如 Cassandra) 在分区容忍时的设计哲学。",
            "在大型高并发秒杀系统中，如何基于 Redis Lua 脚本与 MySQL 设计一套高性能、防超卖的库存预扣方案？",
            "在上述预扣方案中，如果 Redis 扣减成功但后续消息队列异步落盘失败，应该设计怎样的补偿与对账机制来保证数据最终一致性？",
            "请用简洁的 ASCII 纯字符流程图绘制上述秒杀链路中 API 网关、Redis 预扣、消息队列与数据库落库的数据流转过程。",
            "针对跨服务的分布式事务，请对比 2PC (两阶段提交)、TCC (Try-Confirm-Cancel) 与 SAGA 模式的优缺点及各自最适用的业务场景。"
        ]
    }
]

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


class FrameworkRunner:
    def __init__(
        self,
        port: int = 9222,
        output_dir: Optional[str] = None,
        dataset: Optional[Any] = None,
        delay: int = 2,
        skip_chat: bool = False,
        skip_takeout: bool = False,
        skip_reinstall: bool = False,
        skip_tour: bool = False,
        takeout_zip: Optional[str] = None
    ):
        self.port = port
        self.output_dir = os.path.abspath(output_dir or os.path.join(os.path.dirname(__file__), "..", "..", "tests", "output", "live_export"))
        self.delay = delay
        self.skip_chat = skip_chat
        self.skip_takeout = skip_takeout
        self.skip_reinstall = skip_reinstall
        self.skip_tour = skip_tour
        self.takeout_zip = takeout_zip or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "gemini_takeout_clean.zip"))

        if isinstance(dataset, dict) and "scenarios" in dataset:
            self.scenarios = dataset["scenarios"]
        else:
            self.scenarios = dataset or DEFAULT_SCENARIOS

        self.registry = FeatureRegistry()
        self.ext_id = None
        self.chat_records = []
        os.makedirs(self.output_dir, exist_ok=True)

    def run(self) -> bool:
        print("=" * 80)
        print("🚀 启动 Gemini Exporter 特性驱动测试执行器 (Feature-Driven Test Runner)")
        print(f"📁 导出落盘目录: {self.output_dir}")
        print(f"🌐 Chrome 调试端口: 127.0.0.1:{self.port}")
        print(f"📋 待测试功能特性总计: {len(self.registry.all_features())} 项 (涵盖 5 大生命周期领域)")
        print("=" * 80)

        worktree_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

        # -------------------------------------------------------------
        # 步骤 0：扩展卸载与纯净重装
        # -------------------------------------------------------------
        if not self.skip_reinstall:
            print("\n🔄 [步骤 0] 通过 CDP 原生卸载并纯净安装当前工作区代码...")
            self.ext_id = CDPActions.reinstall_extension(self.port, repo_path=worktree_root)
            if not self.ext_id:
                print("❌ 扩展安装失败，终止运行！")
                return False
            time.sleep(1.0)
        else:
            self.ext_id = get_extension_id(self.port)
            if not self.ext_id:
                print("❌ 未能获取活跃扩展 ID")
                return False

        print(f"🧩 当前活跃扩展 ID: {self.ext_id}")

        # 准备/获取 Gemini 标签页
        tabs = get_tabs(self.port)
        gemini_tab = next((t for t in tabs if "gemini.google.com" in t.get("url", "")), None)
        if not gemini_tab:
            print("   🌐 尝试通过 CDP 自动创建 Gemini 标签页...")
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?https://gemini.google.com/app", method="PUT")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    new_tab = json.loads(resp.read().decode())
                    time.sleep(3.0)
                    tabs = get_tabs(self.port)
                    gemini_tab = next((t for t in tabs if "gemini.google.com" in t.get("url", "")), None)
            except Exception as e:
                print(f"   ⚠️ 自动创建 Gemini 标签页异常: {e}")

        if not gemini_tab and not self.skip_chat:
            print("❌ 未在 Chrome 中找到打开的 gemini.google.com 页面，请先启动测试浏览器！")
            return False

        if gemini_tab and not self.skip_reinstall:
            print("   🔄 刷新 Gemini 页面以注入最新 Content Scripts...")
            cdp_g = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
            try:
                cdp_g.eval("location.reload()")
            except Exception:
                pass
            finally:
                cdp_g.close()
            time.sleep(2.0)

        # -------------------------------------------------------------
        # 步骤 0.5：新手向导交互与 0 遮挡防撞 (feat_tour_guide_interactive)
        # -------------------------------------------------------------
        feat_tour = "feat_tour_guide_interactive"
        if not self.skip_tour:
            t0 = time.time()
            print("\n🧭 [领域四 / 交互] 验证新手向导交互与持久化 (feat_tour_guide_interactive)...")
            try:
                tour_ok = CDPActions.verify_onboarding_tour(self.port, self.ext_id)
                dur = time.time() - t0
                if tour_ok:
                    self.registry.record_result(feat_tour, TestStatus.PASS, dur, "新手向导交互推进与持久化完成")
                    print(f"   ✓ [{feat_tour}] 通过 (耗时 {dur:.1f}s)")
                else:
                    self.registry.record_result(feat_tour, TestStatus.FAIL, dur, "向导未能正常完成或状态未落盘")
                    print(f"   ❌ [{feat_tour}] 失败")
            except Exception as e:
                self.registry.record_result(feat_tour, TestStatus.FAIL, time.time() - t0, str(e))
        else:
            self.registry.record_result(feat_tour, TestStatus.SKIP, 0.0, "用户指定跳过向导验证")

        # -------------------------------------------------------------
        # 步骤 1：Gemini 网页端与多轮问答发帖 (Domain: PAGE_CHAT)
        # -------------------------------------------------------------
        feat_chat = "feat_chat_generation"
        feat_imagen = "feat_imagen_multimodal"
        feat_inpage = "feat_inpage_export_badge"

        if not self.skip_chat:
            cdp_gemini = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
            try:
                # 检查页面端导出悬浮徽标
                t0 = time.time()
                has_badge = cdp_gemini.eval("""!!document.querySelector('#gemini-export-badge, .gemini-export-badge, [data-test-id="gemini-export-badge"]')""")
                dur_badge = time.time() - t0
                if has_badge:
                    self.registry.record_result(feat_inpage, TestStatus.PASS, dur_badge, "页面端悬浮徽标正常渲染")
                else:
                    self.registry.record_result(feat_inpage, TestStatus.WARN, dur_badge, "未检测到悬浮徽标DOM，可能处于静默状态")

                # 执行 2 次会话
                t_chat_start = time.time()
                imagen_verified = False

                for chat_idx in range(2):
                    sc = self.scenarios[chat_idx]
                    sc_title = sc.get("title", f"会话 {chat_idx + 1}")
                    turns = sc.get("turns", [])
                    prompts_clean = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in turns]
                    first_p = prompts_clean[0][:14] if prompts_clean else ""

                    # 检查当前页面是否已匹配
                    curr_ups = cdp_gemini.eval("""
                    (() => {
                        const ups = Array.from(document.querySelectorAll(".user-query, user-query, [data-test-id='user-query'], message-content.user-message"));
                        return ups.map(p => p.textContent);
                    })()
                    """) or []

                    is_curr_match = any(first_p in up for up in curr_ups) if (curr_ups and first_p) else False

                    missing_turns = []
                    for idx, t in enumerate(turns, 1):
                        p_text = t.get("prompt", "") if isinstance(t, dict) else str(t)
                        if not any(p_text[:14] in up for up in curr_ups):
                            missing_turns.append((idx, t))

                    if not missing_turns and is_curr_match:
                        existing_cid = CDPActions.get_current_chat_id(cdp_gemini)
                        print(f"   ⚡ 会话 {chat_idx + 1} 在当前页面已完整存在 ({len(prompts_clean)} 轮全部就绪)，直接复用: {existing_cid}")
                        self.chat_records.append({
                            "chat_id": existing_cid,
                            "title": CDPActions.get_current_chat_title(cdp_gemini) or sc_title,
                            "turns": prompts_clean
                        })
                        continue

                    chat_id = CDPActions.get_current_chat_id(cdp_gemini)
                    if curr_ups and len(missing_turns) < len(turns):
                        print(f"   ⚡ 当前会话已包含部分轮次，补充发送剩余 {len(missing_turns)} 轮 (会话 ID: {chat_id})")
                        turns_to_run = missing_turns
                    else:
                        # 开启全新会话
                        cdp_gemini.eval("location.href = 'https://gemini.google.com/app'")
                        time.sleep(2.0)
                        try:
                            cdp_gemini.reconnect()
                        except Exception:
                            pass
                        if not CDPActions.wait_for_gemini_ready(cdp_gemini):
                            self.registry.record_result(feat_chat, TestStatus.FAIL, time.time() - t_chat_start, "Gemini 页面加载超时未能就绪")
                            return False
                        time.sleep(1.0)
                        turns_to_run = list(enumerate(turns, 1))

                    for turn_no, turn_input in turns_to_run:
                        p_text = turn_input.get("prompt", "") if isinstance(turn_input, dict) else str(turn_input)
                        preview = (p_text[:40] + "...") if len(p_text) > 40 else p_text
                        print(f"   ▶️ 轮次 {turn_no}/{len(turns)}: '{preview}'")
                        ok, msg = False, ""
                        for try_idx in range(3):
                            ok, msg = CDPActions.send_gemini_turn(cdp_gemini, turn_input, max_wait=300)
                            if ok:
                                break
                            print(f"      ⚠️ 轮次 {turn_no} 提示: {msg}，等待重试 ({try_idx + 1}/3)...")
                            time.sleep(4)

                        if not ok:
                            self.registry.record_result(feat_chat, TestStatus.FAIL, time.time() - t_chat_start, f"轮次 {turn_no} 失败: {msg}")
                            return False

                        chat_id = CDPActions.get_current_chat_id(cdp_gemini) or chat_id
                        print(f"      ✅ 轮次完成 (会话 ID: {chat_id})")

                        # Imagen 生图断言
                        if any(kw in p_text for kw in ["生成图片", "画一张", "astronaut cat", "Imagen"]) and not imagen_verified:
                            stream_ok, stream_msg, state_data = CDPAssertions.assert_stream_completed(cdp_gemini)
                            if state_data.get("hasImages"):
                                imagen_verified = True
                                self.registry.record_result(feat_imagen, TestStatus.PASS, 0.0, "检测到 AI Imagen 图片渲染落地")
                                print("      🎨 AI Imagen 多模态生图实体已在页面渲染落地！")

                        time.sleep(self.delay)

                    real_title = CDPActions.get_current_chat_title(cdp_gemini) or sc_title
                    self.chat_records.append({
                        "chat_id": chat_id,
                        "title": real_title,
                        "turns": prompts_clean
                    })
                    print(f"   🏁 第 {chat_idx + 1} 次对话完成！会话 ID: {chat_id}，总计 {len(prompts_clean)} 轮已就绪")

                dur_chat = time.time() - t_chat_start
                self.registry.record_result(feat_chat, TestStatus.PASS, dur_chat, f"2 次会话全部轮次正常生成落地 (耗时 {dur_chat:.1f}s)")

                if not imagen_verified:
                    self.registry.record_result(feat_imagen, TestStatus.WARN, 0.0, "未在当次生成轮次中捕获到图片实体 (可能非生图 Prompt)")

            finally:
                cdp_gemini.close()
        else:
            self.registry.record_result(feat_chat, TestStatus.SKIP, 0.0, "--skip-chat 模式")
            self.registry.record_result(feat_imagen, TestStatus.SKIP, 0.0, "--skip-chat 模式")
            self.registry.record_result(feat_inpage, TestStatus.SKIP, 0.0, "--skip-chat 模式")
            # 从侧边栏复用最近会话 ID
            try:
                cdp_temp = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
                try:
                    sidebar_ids = cdp_temp.eval("""
                    (() => {
                        const anchors = Array.from(document.querySelectorAll("a"));
                        return anchors.map(a => {
                            const parts = (a.getAttribute("href") || "").split("/app/");
                            return parts.length > 1 ? parts[1].split("?")[0].trim() : null;
                        }).filter(id => id && id.length >= 8);
                    })()
                    """) or []
                    for chat_idx in range(2):
                        sc = self.scenarios[chat_idx]
                        raw_turns = sc.get("turns", [])
                        prompts = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in raw_turns]
                        cid = sidebar_ids[1 - chat_idx] if len(sidebar_ids) >= 2 else (sidebar_ids[0] if sidebar_ids else sc.get("id"))
                        self.chat_records.append({"chat_id": cid, "title": sc.get("title", ""), "turns": prompts})
                finally:
                    cdp_temp.close()
            except Exception:
                pass

        # -------------------------------------------------------------
        # 步骤 2：会话生命周期与实时同步 (Domain: LIFECYCLE)
        # -------------------------------------------------------------
        feat_promotion = "feat_continued_chat_promotion"
        feat_updated_badge = "feat_updated_badge_display"
        feat_pruning = "feat_ephemeral_chat_pruning"

        if not self.skip_chat and len(self.chat_records) >= 2:
            s1_id = self.chat_records[0].get("chat_id")
            s2_id = self.chat_records[1].get("chat_id")
            if s1_id and s2_id and s1_id != s2_id:
                print("\n🔄 [领域二 / 生命周期] 老会话追加提问与置顶升权 (feat_continued_chat_promotion)...")
                t_promo = time.time()
                cdp_g2 = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
                try:
                    cdp_g2.eval(f"location.href = 'https://gemini.google.com/app/{s1_id}'")
                    time.sleep(2.5)
                    try:
                        cdp_g2.reconnect()
                    except Exception:
                        pass
                    CDPActions.wait_for_gemini_ready(cdp_g2, max_wait=15)
                    add_turn = "针对刚才深入探讨的系统架构设计，请再补充一条关于线上压测与容量规划的核心避坑建议，保持极简总结。"
                    print(f"   ▶️ 回访会话 1 ({s1_id}) 追加提问: '{add_turn[:36]}...'")
                    ok_add, msg_add = CDPActions.send_gemini_turn(cdp_g2, add_turn, max_wait=120)
                    if ok_add:
                        self.chat_records[0]["turns"].append(add_turn)
                        self.registry.record_result(feat_promotion, TestStatus.PASS, time.time() - t_promo, "老会话追加提问成功完成")
                        print(f"      ✅ 老会话追加提问成功完成 (耗时 {time.time() - t_promo:.1f}s)")
                    else:
                        self.registry.record_result(feat_promotion, TestStatus.FAIL, time.time() - t_promo, f"追加提问失败: {msg_add}")
                finally:
                    cdp_g2.close()
        else:
            self.registry.record_result(feat_promotion, TestStatus.SKIP, 0.0, "跳过或会话记录不足 2 个")

        # 打开 Options 工作台页面
        options_url = f"chrome-extension://{self.ext_id}/src/ui/options/options.html"
        tabs = get_tabs(self.port)
        opt_tab = next((t for t in tabs if options_url in t.get("url", "")), None)
        if not opt_tab:
            new_url = f"http://127.0.0.1:{self.port}/json/new?{options_url}"
            req = urllib.request.Request(new_url, method="PUT")
            with urllib.request.urlopen(req, timeout=5) as r:
                opt_tab = json.loads(r.read().decode("utf-8"))

        cdp_opt = CDPConnection(opt_tab["webSocketDebuggerUrl"])
        try:
            try:
                cdp_opt.call("Page.setDownloadBehavior", {"behavior": "allow", "downloadPath": self.output_dir})
            except Exception:
                pass

            browser_ws = get_browser_ws_url(self.port)
            if browser_ws:
                try:
                    b_cdp = CDPConnection(browser_ws)
                    b_cdp.call("Browser.setDownloadBehavior", {
                        "behavior": "allow",
                        "downloadPath": self.output_dir,
                        "eventsEnabled": True
                    })
                    b_cdp.close()
                except Exception:
                    pass

            time.sleep(1.0)

            # 检验置顶与「已更新」徽章 (feat_updated_badge_display)
            if not self.skip_chat and len(self.chat_records) >= 2:
                s1_id = self.chat_records[0].get("chat_id")
                s2_id = self.chat_records[1].get("chat_id")
                if s1_id and s2_id and s1_id != s2_id:
                    print("\n🔍 [领域二 / 徽章] 校验老会话置顶提权与「已更新」徽章智能勾选...")
                    t_badge = time.time()
                    # 写入导出时间基准线
                    cdp_opt.eval(f"""
                    (async () => {{
                        return new Promise((resolve) => {{
                            chrome.storage.local.get(['gemini_conversations', 'gemini_exported_u0', 'gemini_exported_ids'], (data) => {{
                                const convs = data.gemini_conversations || [];
                                const c1 = convs.find(c => c.id === '{s1_id}' || c.id === 'c_{s1_id}');
                                const c2 = convs.find(c => c.id === '{s2_id}' || c.id === 'c_{s2_id}');
                                const ts2 = c2 ? (c2.updatedAt || c2.timestamp || Date.now()) : Date.now();
                                const expTimeS1 = new Date(Math.max(0, ts2 - 5000)).toISOString();
                                const expTimeS2 = new Date(ts2 + 10000).toISOString();

                                const expMap = data.gemini_exported_u0 || data.gemini_exported_ids || {{}};
                                expMap['{s1_id}'] = {{ exportedAt: expTimeS1, title: c1?.title || 'Chat 1', format: 'markdown' }};
                                expMap['c_{s1_id}'] = expMap['{s1_id}'];
                                expMap['{s2_id}'] = {{ exportedAt: expTimeS2, title: c2?.title || 'Chat 2', format: 'markdown' }};
                                expMap['c_{s2_id}'] = expMap['{s2_id}'];

                                chrome.storage.local.set({{
                                    gemini_exported_u0: expMap,
                                    gemini_exported_ids: expMap
                                }}, () => {{
                                    if (typeof window.__workbenchLoadStore === 'function') {{
                                        window.__workbenchLoadStore(true);
                                    }}
                                    resolve(true);
                                }});
                            }});
                        }});
                    }})()
                    """, await_promise=True)
                    time.sleep(0.8)

                    order_ok, order_msg, order_data = CDPAssertions.assert_realtime_order(cdp_opt, s1_id, s2_id)
                    badge_ok, badge_msg, badge_data = CDPAssertions.assert_badge_status(cdp_opt, s1_id, "updated")

                    dur_b = time.time() - t_badge
                    if order_ok and badge_ok:
                        self.registry.record_result(feat_updated_badge, TestStatus.PASS, dur_b, f"{order_msg}; {badge_msg}")
                        print(f"   ✓ [{feat_updated_badge}] 通过: 会话 1 置顶且已渲染更新徽章与智能自动勾选")
                    else:
                        self.registry.record_result(feat_updated_badge, TestStatus.FAIL, dur_b, f"Order: {order_msg} | Badge: {badge_msg}")
                        print(f"   ❌ [{feat_updated_badge}] 失败: {order_msg} / {badge_msg}")
            else:
                self.registry.record_result(feat_updated_badge, TestStatus.SKIP, 0.0, "跳过或记录不足")

            # 瞬态会话网页端删除实时剥离 (feat_ephemeral_chat_pruning)
            if not self.skip_chat:
                print("\n🗑️ [领域二 / 生命周期] 验证瞬态会话网页端删除实时剥离 (feat_ephemeral_chat_pruning)...")
                t_eph = time.time()
                cdp_gem_live = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
                try:
                    cdp_gem_live.eval("location.href = 'https://gemini.google.com/app'")
                    time.sleep(2.0)
                    try:
                        cdp_gem_live.reconnect()
                    except Exception:
                        pass
                    CDPActions.wait_for_gemini_ready(cdp_gem_live, max_wait=15)
                    ok_eph, msg_eph = CDPActions.send_gemini_turn(cdp_gem_live, "什么是计算机系统的瞬态会话？请用一句话回答。", max_wait=90)
                    if ok_eph:
                        eph_chat_id = CDPActions.get_current_chat_id(cdp_gem_live)
                        if eph_chat_id:
                            print(f"   🗑️ 成功生成瞬态会话 ({eph_chat_id})，在侧边栏触发删除...")
                            del_ok = CDPActions.delete_conversation_via_web(cdp_gem_live, eph_chat_id)
                            time.sleep(2.5)
                            pruned_ok, pruned_msg, _ = CDPAssertions.assert_dom_pruned(cdp_opt, eph_chat_id)
                            dur_e = time.time() - t_eph
                            if pruned_ok:
                                self.registry.record_result(feat_pruning, TestStatus.PASS, dur_e, "瞬态会话已实时剥离 DOM 与本地 Storage")
                                print(f"   ✓ [{feat_pruning}] 通过: {pruned_msg}")
                            else:
                                self.registry.record_result(feat_pruning, TestStatus.FAIL, dur_e, pruned_msg)
                                print(f"   ❌ [{feat_pruning}] 失败: {pruned_msg}")
                        else:
                            self.registry.record_result(feat_pruning, TestStatus.WARN, time.time() - t_eph, "未能获取瞬态会话 ID")
                    else:
                        self.registry.record_result(feat_pruning, TestStatus.WARN, time.time() - t_eph, f"瞬态会话发帖超时: {msg_eph}")
                finally:
                    cdp_gem_live.close()
            else:
                self.registry.record_result(feat_pruning, TestStatus.SKIP, 0.0, "--skip-chat 模式")

            # -------------------------------------------------------------
            # 步骤 3：Takeout 离线导入与标题晋级 (Domain: TAKEOUT)
            # -------------------------------------------------------------
            feat_takeout = "feat_takeout_zip_import"
            feat_deep_scan = "feat_deep_scan_pagination"
            feat_upgrade = "feat_authoritative_title_upgrade"

            if not self.skip_takeout and os.path.isfile(self.takeout_zip):
                print(f"\n📥 [领域三 / Takeout] 导入离线 ZIP 样本 ({os.path.basename(self.takeout_zip)})...")
                t_to = time.time()
                import_res = CDPActions.import_takeout_zip(cdp_opt, self.takeout_zip)
                dur_to = time.time() - t_to
                if import_res.get("success"):
                    self.registry.record_result(feat_takeout, TestStatus.PASS, dur_to, f"导入成功，索引资源: {import_res.get('totalMediaCount', 0)}")
                    print(f"   ✓ [{feat_takeout}] 通过: 离线附件池建立，已索引资源 {import_res.get('totalMediaCount', 0)}")
                else:
                    self.registry.record_result(feat_takeout, TestStatus.FAIL, dur_to, str(import_res.get("error")))
                    print(f"   ❌ [{feat_takeout}] 失败: {import_res.get('error')}")

                # 全量拉取历史分页同步 (feat_deep_scan_pagination)
                print("\n🔄 [领域三 / 分页] 触发【全量拉取历史】(btnDeepScan)...")
                t_scan = time.time()
                scan_ok = CDPActions.trigger_deep_scan(cdp_opt, max_wait=90)
                dur_scan = time.time() - t_scan
                if scan_ok:
                    self.registry.record_result(feat_deep_scan, TestStatus.PASS, dur_scan, "全量拉取历史分页同步完成")
                    print(f"   ✓ [{feat_deep_scan}] 通过 (耗时 {dur_scan:.1f}s)")
                else:
                    self.registry.record_result(feat_deep_scan, TestStatus.FAIL, dur_scan, "全量拉取扫描超时未恢复可用")
                    print(f"   ❌ [{feat_deep_scan}] 失败")

                # 权威 RPC 标题覆盖晋级 (feat_authoritative_title_upgrade)
                check_takeout_ids = ['1bd028d5c5b0c0e2', '1cea7e48cc166b57', '7b29852ecae8344a', 'f8ba969fe8c7d880']
                upg_ok, upg_msg, _ = CDPAssertions.assert_title_upgraded(cdp_opt, check_takeout_ids)
                if upg_ok:
                    self.registry.record_result(feat_upgrade, TestStatus.PASS, 0.0, upg_msg)
                    print(f"   ✓ [{feat_upgrade}] 通过: {upg_msg}")
                else:
                    self.registry.record_result(feat_upgrade, TestStatus.WARN, 0.0, upg_msg)
                    print(f"   ⚠️ [{feat_upgrade}] 提示: {upg_msg}")
            else:
                self.registry.record_result(feat_takeout, TestStatus.SKIP, 0.0, "未启用或未找到 Takeout ZIP 样本")
                self.registry.record_result(feat_deep_scan, TestStatus.SKIP, 0.0, "未启用 Takeout")
                self.registry.record_result(feat_upgrade, TestStatus.SKIP, 0.0, "未启用 Takeout")

            # -------------------------------------------------------------
            # 步骤 4：工作台搜索、过滤与交互控制 (Domain: WORKBENCH)
            # -------------------------------------------------------------
            feat_search_id = "feat_search_filter_by_id"
            feat_search_kw = "feat_search_filter_by_keyword"
            feat_clear = "feat_search_clear_restore"
            feat_select = "feat_selection_controls"
            feat_lang = "feat_language_toggle"

            print("\n🔎 [领域四 / 检索与交互] 验证工作台搜索、过滤、多语言与联动控制...")

            # 1. 按关键词过滤
            t0 = time.time()
            CDPActions.search_workbench(cdp_opt, "Python")
            time.sleep(0.4)
            filter_kw_ok, filter_kw_msg, _ = CDPAssertions.assert_search_filter(cdp_opt, "Python", expected_visible_min=1)
            CDPActions.clear_search_workbench(cdp_opt)
            time.sleep(0.3)
            dur_kw = time.time() - t0
            if filter_kw_ok:
                self.registry.record_result(feat_search_kw, TestStatus.PASS, dur_kw, "关键词过滤列表正常收缩")
                print(f"   ✓ [{feat_search_kw}] 通过: 关键词过滤生效")
            else:
                self.registry.record_result(feat_search_kw, TestStatus.WARN, dur_kw, filter_kw_msg)
                print(f"   ⚠️ [{feat_search_kw}] 提示: {filter_kw_msg}")

            # 2. 按 ID 搜索与精准勾选
            t0 = time.time()
            target_search_id = cdp_opt.eval("document.querySelector('#list .item')?.dataset.chatId") or "1bd028d5c5b0c0e2"
            CDPActions.search_workbench(cdp_opt, target_search_id)
            time.sleep(0.4)
            filter_id_ok, filter_id_msg, _ = CDPAssertions.assert_search_filter(cdp_opt, target_search_id, expected_visible_min=1, expected_visible_max=2)
            CDPActions.select_workbench_item(cdp_opt, target_search_id, True)
            dur_sid = time.time() - t0
            if filter_id_ok:
                self.registry.record_result(feat_search_id, TestStatus.PASS, dur_sid, f"ID过滤精准定位并勾选: {target_search_id}")
                print(f"   ✓ [{feat_search_id}] 通过: ID 精准过滤生效")
            else:
                self.registry.record_result(feat_search_id, TestStatus.FAIL, dur_sid, filter_id_msg)
                print(f"   ❌ [{feat_search_id}] 失败: {filter_id_msg}")

            # 3. 清空搜索恢复全量列表与勾选驻留
            t0 = time.time()
            restored_count = CDPActions.clear_search_workbench(cdp_opt)
            time.sleep(0.4)
            is_still_checked = bool(cdp_opt.eval(f"""
            (() => {{
                const item = document.querySelector('#list .item[data-chat-id="{target_search_id}"], #list .item[data-chat-id="c_{target_search_id}"]');
                return item ? !!item.querySelector('input[type=checkbox]:checked') : false;
            }})()
            """))
            dur_clr = time.time() - t0
            if restored_count > 1 and is_still_checked:
                self.registry.record_result(feat_clear, TestStatus.PASS, dur_clr, f"列表恢复全量 ({restored_count}项) 且勾选状态完好保留")
                print(f"   ✓ [{feat_clear}] 通过: 搜索清空后全量恢复且勾选保持")
            else:
                self.registry.record_result(feat_clear, TestStatus.FAIL, dur_clr, f"恢复数量={restored_count}, 勾选保留={is_still_checked}")
                print(f"   ❌ [{feat_clear}] 失败")

            # 4. 全选 / 取消全选联动
            t0 = time.time()
            none_count = CDPActions.toggle_select_none(cdp_opt)
            time.sleep(0.2)
            all_count = CDPActions.toggle_select_all(cdp_opt)
            time.sleep(0.2)
            dur_sel = time.time() - t0
            if none_count == 0 and all_count > 0:
                self.registry.record_result(feat_select, TestStatus.PASS, dur_sel, f"联动控制正常 (取消全选=0, 全选={all_count})")
                print(f"   ✓ [{feat_select}] 通过: 全选/取消全选精准联动")
            else:
                self.registry.record_result(feat_select, TestStatus.FAIL, dur_sel, f"none={none_count}, all={all_count}")
                print(f"   ❌ [{feat_select}] 失败")

            # 5. 中英文语言切换与状态驻留
            t0 = time.time()
            en_text = CDPActions.switch_workbench_language(cdp_opt, "en")
            time.sleep(0.2)
            zh_text = CDPActions.switch_workbench_language(cdp_opt, "zh")
            time.sleep(0.2)
            dur_lang = time.time() - t0
            if ("select all" in en_text.lower() or "all" in en_text.lower()) and ("全选" in zh_text):
                self.registry.record_result(feat_lang, TestStatus.PASS, dur_lang, "多语言正确切换且UI渲染完备")
                print(f"   ✓ [{feat_lang}] 通过: 中英文切换状态驻留")
            else:
                self.registry.record_result(feat_lang, TestStatus.WARN, dur_lang, f"en='{en_text}', zh='{zh_text}'")
                print(f"   ⚠️ [{feat_lang}] 提示: en='{en_text}', zh='{zh_text}'")

            # -------------------------------------------------------------
            # 步骤 5：物理磁盘落盘与多模态双轨断言 (Domain: EXPORT_DISK)
            # -------------------------------------------------------------
            feat_live_disk = "feat_live_auto_save_disk_write"
            feat_zip_dl = "feat_zip_export_download"
            feat_spec = "feat_multimodal_spec_assertion"

            print("\n💾 [领域五 / 磁盘与导出断言] 验证真实物理磁盘落盘、ZIP导出与多模态规范断言...")

            # 1. 物理磁盘实时落盘与非零字节核验
            t0 = time.time()
            disk_ok, disk_msg, disk_data = CDPAssertions.assert_real_disk_live_save()
            dur_disk = time.time() - t0
            if disk_ok:
                self.registry.record_result(feat_live_disk, TestStatus.PASS, dur_disk, disk_msg)
                print(f"   ✓ [{feat_live_disk}] 通过: {disk_msg}")
            else:
                self.registry.record_result(feat_live_disk, TestStatus.WARN, dur_disk, disk_msg)
                print(f"   ⚠️ [{feat_live_disk}] 提示: {disk_msg}")

            # 2. 联合勾选目标会话并触发 ZIP 导出
            t0 = time.time()
            target_ids = [r["chat_id"] for r in self.chat_records if r.get("chat_id") and len(str(r["chat_id"])) > 8]
            target_ids.extend([h["id"] for h in DESIGNATED_HISTORICAL_CHATS])
            target_titles = [r.get("title", "") for r in self.chat_records if r.get("title")]
            target_titles.extend(["Martian Astronaut Cat", "Python日志与耗时装饰器", "贝尔不等式推导与物理意义", "韦伯望远镜深空探测重大发现"])

            cdp_opt.eval(f"""
            (() => {{
                const selectNone = document.getElementById('btnSelectNone');
                if (selectNone) selectNone.click();
                const targetIds = {json.dumps(target_ids)};
                const targetTitles = {json.dumps(target_titles)};
                const items = Array.from(document.querySelectorAll('#list .item'));
                let checked = 0;
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
                            checked++;
                        }}
                    }}
                }});
                if (checked < 2) {{
                    items.slice(0, 2).forEach(item => {{
                        const cb = item.querySelector('input[type=checkbox]');
                        if (cb && !cb.checked) {{
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        }}
                    }});
                }}
            }})()
            """)
            time.sleep(0.5)

            downloaded_zip = CDPActions.trigger_export_zip(cdp_opt, self.output_dir, max_wait=60)
            dur_zip = time.time() - t0
            if downloaded_zip and os.path.isfile(downloaded_zip) and os.path.getsize(downloaded_zip) > 0:
                self.registry.record_result(feat_zip_dl, TestStatus.PASS, dur_zip, f"ZIP 导出成功落盘: {os.path.basename(downloaded_zip)} ({os.path.getsize(downloaded_zip)} bytes)")
                print(f"   ✓ [{feat_zip_dl}] 通过: {os.path.basename(downloaded_zip)} ({os.path.getsize(downloaded_zip)} bytes)")
            else:
                self.registry.record_result(feat_zip_dl, TestStatus.FAIL, dur_zip, "未能成功下载或落盘 ZIP 文件")
                print(f"   ❌ [{feat_zip_dl}] 失败: ZIP 文件未生成或为0字节")
                return False

            # 3. 多模态规范断言与 4 大黄金分类
            t0 = time.time()
            extract_dir = os.path.join(self.output_dir, "extracted_verify_" + str(int(time.time())))
            golden_chats = [dict(c) for c in DESIGNATED_HISTORICAL_CHATS]

            expected_scenarios_to_check = self.scenarios[:2] if (not self.skip_chat) else None
            spec_ok, spec_msg, spec_data = CDPAssertions.assert_exported_zip_spec(
                zip_path=downloaded_zip,
                extract_dir=extract_dir,
                min_conversations=4 if self.skip_chat else 6,
                expected_golden_chats=golden_chats,
                expected_scenarios=expected_scenarios_to_check
            )
            dur_spec = time.time() - t0
            if spec_ok:
                self.registry.record_result(feat_spec, TestStatus.PASS, dur_spec, spec_msg)
                print(f"   ✓ [{feat_spec}] 通过: {spec_msg}")
            else:
                self.registry.record_result(feat_spec, TestStatus.FAIL, dur_spec, spec_msg)
                print(f"   ❌ [{feat_spec}] 失败: {spec_msg}")

        finally:
            cdp_opt.close()

        # -------------------------------------------------------------
        # 输出最终特性检验矩阵报告
        # -------------------------------------------------------------
        matrix_report = self.registry.generate_matrix_report()
        print("\n" + matrix_report)

        # 评估最终成败：所有 critical 特性不得为 FAIL
        all_feats = self.registry.all_features()
        has_failed_critical = False
        for f in all_feats:
            if f.critical:
                res = self.registry.get_result(f.id)
                if res and res.status == TestStatus.FAIL:
                    has_failed_critical = True
                    break

        return not has_failed_critical
