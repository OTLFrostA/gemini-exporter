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
from scripts.framework.scenario_provider import OnlineScenarioProvider
from scripts.framework.lifecycle_tracker import SessionLifecycleTracker

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
            "请为这套秒杀系统生成一张架构概念图片：赛博朋克科技感风格的分布式高并发服务器机群与微服务数据流全景图。"
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
        takeout_zip: Optional[str] = None,
        keep_chats: bool = False
    ):
        self.port = port
        self.output_dir = os.path.abspath(output_dir or os.path.join(os.path.dirname(__file__), "..", "..", "tests", "output", "live_export"))
        self.delay = delay
        self.takeout_zip = takeout_zip or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "gemini_takeout_clean.zip"))
        self.keep_chats = keep_chats

        self.provider = OnlineScenarioProvider()
        self.tracker = SessionLifecycleTracker()

        if isinstance(dataset, dict) and "scenarios" in dataset:
            self.scenarios = dataset["scenarios"]
        elif isinstance(dataset, list) and dataset:
            self.scenarios = dataset
        else:
            # 架构强制保证：任何未指定外挂数据集的实跑测试，唯一事实来源为统一在线对话池 (OnlineScenarioProvider)
            print("🏊 [场景池调度] 从在线对话池中提取 2 个最新多模态场景 (1个Imagen生图 + 1个深度推演)...")
            sc_img = self.provider.pop_scenario(required_features=["imagen"], min_turns=2)
            sc_text = self.provider.pop_scenario(min_turns=2)
            self.scenarios = [sc_img, sc_text]

        self.registry = FeatureRegistry()
        self.ext_id = None
        self.chat_records = []
        os.makedirs(self.output_dir, exist_ok=True)

    def run(self) -> bool:
        """执行完整特性生命周期测试，并在 finally 阶段自动执行生命周期回收 (Teardown Cleanup)"""
        try:
            return self._execute_lifecycle()
        finally:
            try:
                tabs = get_tabs(self.port)
                gemini_tab = next((t for t in tabs if "gemini.google.com" in t.get("url", "")), None)
                if gemini_tab:
                    cdp_clean = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
                    try:
                        self.tracker.teardown(cdp_clean, keep_chats=self.keep_chats)
                    finally:
                        cdp_clean.close()
            except Exception as e:
                print(f"⚠️ [生命周期回收] Teardown 清理阶段异常: {e}")

    def _execute_lifecycle(self) -> bool:
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
        print("\n🔄 [步骤 0] 通过 CDP 原生卸载并纯净安装当前工作区代码...")
        self.ext_id = CDPActions.reinstall_extension(self.port, repo_path=worktree_root)
        if not self.ext_id:
            print("❌ 扩展安装失败，终止运行！")
            return False
        time.sleep(1.0)

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

        if not gemini_tab:
            print("❌ 未在 Chrome 中找到打开的 gemini.google.com 页面，请先启动测试浏览器！")
            return False

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

        # -------------------------------------------------------------
        # 步骤 1：Gemini 网页端与多轮问答发帖 (Domain: PAGE_CHAT)
        # -------------------------------------------------------------
        feat_chat = "feat_chat_generation"
        feat_imagen = "feat_imagen_multimodal"
        feat_inpage = "feat_inpage_export_badge"

        cdp_gemini = CDPConnection(gemini_tab["webSocketDebuggerUrl"])
        try:
            try:
                cdp_gemini.call("Page.bringToFront")
            except Exception:
                pass

            # 严格前置门禁断言：校验 3.8 Flash + Extended thinking 是否存在，缺失则立即主动熔断终止测试
            try:
                CDPActions.ensure_model_and_thinking(cdp_gemini, target_model="3.8 Flash", target_thinking=True, force_menu_check=True)
            except RuntimeError as e:
                self.registry.record_result(feat_chat, TestStatus.FAIL, 0.0, str(e))
                print(f"\n🛑 {e}\n")
                return False

            # 检查页面端导出悬浮徽标
            t0 = time.time()
            has_badge = cdp_gemini.eval("""!!document.querySelector('#gemini-export-badge, .gemini-export-badge, [data-test-id="gemini-export-badge"]')""")
            dur_badge = time.time() - t0
            if has_badge:
                self.registry.record_result(feat_inpage, TestStatus.PASS, dur_badge, "页面端悬浮徽标正常渲染")
            else:
                self.registry.record_result(feat_inpage, TestStatus.FAIL, dur_badge, "未检测到悬浮徽标 DOM 节点 (#gemini-export-badge)")

            # 执行 2 次会话
            t_chat_start = time.time()
            imagen_verified = False

            for chat_idx in range(2):
                sc = self.scenarios[chat_idx]
                sc_title = sc.get("title", f"会话 {chat_idx + 1}")
                turns = sc.get("turns", [])
                prompts_clean = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in turns]

                # 严格开启全新干净会话，物理隔离杜绝任何旧会话串话与交叉重叠
                CDPActions.click_new_chat(cdp_gemini)
                time.sleep(1.5)
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
                    if chat_id:
                        self.tracker.track(chat_id)
                    print(f"      ✅ 轮次完成 (会话 ID: {chat_id})")

                    # Imagen 生图断言
                    if any(kw in p_text for kw in ["生成图片", "画一张", "astronaut cat", "Imagen", "image"]) and not imagen_verified:
                        has_img = cdp_gemini.eval("""
                        (() => {
                            const models = Array.from(document.querySelectorAll('model-response'));
                            const lastModel = models.length > 0 ? models[models.length - 1] : null;
                            if (!lastModel) return false;
                            const imgs = lastModel.querySelectorAll('img.image, img[src*="blob:"], img[src*="googleusercontent"], .image-button, .image-container');
                            return imgs.length > 0;
                        })()
                        """)
                        if has_img:
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
                has_image_scenario = any(
                    any(kw in str(t).lower() for kw in ["image", "draw", "画", "图", "生成"])
                    for sc in self.scenarios[:2] for t in sc.get("turns", [])
                )
                if has_image_scenario:
                    self.registry.record_result(feat_imagen, TestStatus.FAIL, 0.0, "预期生图场景未在页面捕获到 AI Imagen 图片渲染实体")
                    print("   ❌ [feat_imagen_multimodal] 失败: 预期生图场景未捕获到图片实体")
                else:
                    self.registry.record_result(feat_imagen, TestStatus.FAIL, 0.0, "当次提供的数据集中无生图提问轮次，多模态检验要求必须包含生图轮次")
                    print("   ❌ [feat_imagen_multimodal] 失败: 当次数据集缺少生图需求")

        finally:
            cdp_gemini.close()

        # -------------------------------------------------------------
        # 步骤 2：会话生命周期与实时同步 (Domain: LIFECYCLE)
        # -------------------------------------------------------------
        feat_promotion = "feat_continued_chat_promotion"
        feat_updated_badge = "feat_updated_badge_display"
        feat_pruning = "feat_ephemeral_chat_pruning"

        if len(self.chat_records) >= 2:
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
                self.registry.record_result(feat_promotion, TestStatus.FAIL, 0.0, "会话 1 与会话 2 ID 无效或重复")
        else:
            self.registry.record_result(feat_promotion, TestStatus.FAIL, 0.0, "会话记录不足 2 个")

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
            if len(self.chat_records) >= 2:
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
                self.registry.record_result(feat_updated_badge, TestStatus.FAIL, 0.0, "会话 1 与会话 2 ID 无效或重复")

            # 瞬态会话网页端删除实时剥离 (feat_ephemeral_chat_pruning)
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
                eph_query = self.provider.pop_ephemeral_query()
                ok_eph, msg_eph = CDPActions.send_gemini_turn(cdp_gem_live, eph_query, max_wait=90)
                if ok_eph:
                    eph_chat_id = CDPActions.get_current_chat_id(cdp_gem_live)
                    if eph_chat_id:
                        self.tracker.track(eph_chat_id)
                        print(f"   🗑️ 成功生成瞬态会话 ({eph_chat_id})，在侧边栏触发删除...")
                        del_ok = CDPActions.delete_conversation_via_web(cdp_gem_live, eph_chat_id)
                        if del_ok:
                            self.tracker.mark_deleted(eph_chat_id)
                        pruned_ok, pruned_msg, _ = CDPAssertions.assert_dom_pruned(cdp_opt, eph_chat_id, timeout=5.0)
                        dur_e = time.time() - t_eph
                        if pruned_ok:
                            self.registry.record_result(feat_pruning, TestStatus.PASS, dur_e, "瞬态会话已实时剥离 DOM 与本地 Storage")
                            print(f"   ✓ [{feat_pruning}] 通过: {pruned_msg}")
                        else:
                            self.registry.record_result(feat_pruning, TestStatus.FAIL, dur_e, pruned_msg)
                            print(f"   ❌ [{feat_pruning}] 失败: {pruned_msg}")
                    else:
                        self.registry.record_result(feat_pruning, TestStatus.FAIL, time.time() - t_eph, "未能获取瞬态会话 ID")
                        print(f"   ❌ [{feat_pruning}] 失败: 未能获取瞬态会话 ID")
                else:
                    self.registry.record_result(feat_pruning, TestStatus.FAIL, time.time() - t_eph, f"瞬态会话发帖超时: {msg_eph}")
                    print(f"   ❌ [{feat_pruning}] 失败: 瞬态会话发帖超时")
            finally:
                cdp_gem_live.close()

            # -------------------------------------------------------------
            # 步骤 3：Takeout 离线导入与标题晋级 (Domain: TAKEOUT)
            # -------------------------------------------------------------
            feat_takeout = "feat_takeout_zip_import"
            feat_deep_scan = "feat_deep_scan_pagination"
            feat_upgrade = "feat_authoritative_title_upgrade"

            if not os.path.isfile(self.takeout_zip):
                err_to = f"Takeout ZIP 样本文件不存在: {self.takeout_zip}"
                self.registry.record_result(feat_takeout, TestStatus.FAIL, 0.0, err_to)
                self.registry.record_result(feat_deep_scan, TestStatus.FAIL, 0.0, err_to)
                self.registry.record_result(feat_upgrade, TestStatus.FAIL, 0.0, err_to)
                print(f"   ❌ [{feat_takeout}] 失败: {err_to}")
                return False

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
                self.registry.record_result(feat_upgrade, TestStatus.FAIL, 0.0, upg_msg)
                print(f"   ❌ [{feat_upgrade}] 失败: {upg_msg}")

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
                self.registry.record_result(feat_search_kw, TestStatus.FAIL, dur_kw, filter_kw_msg)
                print(f"   ❌ [{feat_search_kw}] 失败: {filter_kw_msg}")

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
                self.registry.record_result(feat_lang, TestStatus.FAIL, dur_lang, f"en='{en_text}', zh='{zh_text}'")
                print(f"   ❌ [{feat_lang}] 失败: en='{en_text}', zh='{zh_text}'")

            # -------------------------------------------------------------
            # 步骤 5：物理磁盘落盘与多模态双轨断言 (Domain: EXPORT_DISK)
            # -------------------------------------------------------------
            feat_live_disk = "feat_live_auto_save_disk_write"
            feat_zip_dl = "feat_zip_export_download"
            feat_spec = "feat_multimodal_spec_assertion"

            print("\n💾 [领域五 / 磁盘与导出断言] 验证真实物理磁盘落盘、ZIP导出与多模态规范断言...")

            # 1. 物理磁盘实时落盘真实性核验 (严禁扫描历史静态旧目录)
            t0 = time.time()
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
                self.registry.record_result(feat_live_disk, TestStatus.WARN, 0.0, "扩展未启用或未授权本地目录实时落盘 (live_save_config.enabledDisk != true)")
                print(f"   ℹ️ [{feat_live_disk}] 提示: 扩展未启用实时磁盘保存，绝不扫描历史静态目录")
            else:
                target_cids = [r["chat_id"] for r in self.chat_records if r.get("chat_id")]
                candidate_dirs = [
                    os.path.join(os.path.expanduser("~"), "Downloads", live_dir_name),
                    os.path.join(os.path.expanduser("~"), "Downloads", "gemini"),
                    os.path.join(os.path.expanduser("~"), "Downloads")
                ]
                valid_live_dir = next((d for d in candidate_dirs if os.path.isdir(d)), None)
                if not valid_live_dir:
                    self.registry.record_result(feat_live_disk, TestStatus.FAIL, time.time() - t0, f"已配置实时落盘但本地目录不存在 (dirName: '{live_dir_name}')")
                    print(f"   ❌ [{feat_live_disk}] 失败: 未找到对应本地目录")
                else:
                    disk_ok, disk_msg, disk_data = CDPAssertions.assert_real_disk_live_save(
                        target_dir=valid_live_dir,
                        target_chat_ids=target_cids,
                        min_mtime=self.start_time
                    )
                    dur_disk = time.time() - t0
                    if disk_ok:
                        self.registry.record_result(feat_live_disk, TestStatus.PASS, dur_disk, disk_msg)
                        print(f"   ✓ [{feat_live_disk}] 通过: {disk_msg}")
                    else:
                        self.registry.record_result(feat_live_disk, TestStatus.FAIL, dur_disk, disk_msg)
                        print(f"   ❌ [{feat_live_disk}] 失败: {disk_msg}")

            # 2. 联合勾选目标会话并触发 ZIP 导出 (彻底移除静默兜底)
            t0 = time.time()
            target_ids = []
            target_titles = []
            target_ids.extend([r["chat_id"] for r in self.chat_records if r.get("chat_id") and len(str(r["chat_id"])) > 8])
            target_titles.extend([r.get("title", "") for r in self.chat_records if r.get("title")])

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
                err_msg = f"未能在工作台勾选到足够的预期会话: 实际勾选 {checked_count} < 预期最小 {expected_min_checked} (总卡片数: {check_res.get('totalItems')})"
                self.registry.record_result(feat_zip_dl, TestStatus.FAIL, time.time() - t0, err_msg)
                print(f"   ❌ [{feat_zip_dl}] 失败: {err_msg}")
                return False

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

            expected_scenarios_to_check = self.scenarios[:2]
            spec_ok, spec_msg, spec_data = CDPAssertions.assert_exported_zip_spec(
                zip_path=downloaded_zip,
                extract_dir=extract_dir,
                min_conversations=6,
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

        # 评估最终成败：所有 critical 特性必须全部为 PASS
        all_feats = self.registry.all_features()
        has_failed_critical = False
        for f in all_feats:
            if f.critical:
                res = self.registry.get_result(f.id)
                if not res or res.status != TestStatus.PASS:
                    has_failed_critical = True
                    status_str = res.status.value if res else "未执行"
                    print(f"❌ 关键特性 [{f.id}] ({f.name}) 未通过验证 (状态: {status_str})！")
                    break

        return not has_failed_critical
