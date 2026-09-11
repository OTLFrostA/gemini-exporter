# scripts/framework/runner.py
"""
Feature-Driven Test Runner Orchestrator.
Uses DAGRunner to resolve dependencies across FeatureTestCases,
executing features across 5 lifecycle domains and generating the verification matrix.
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
from scripts.framework.cases import (
    TestContext,
    DAGRunner,
    TourGuideCase,
    InpageBadgeCase,
    ChatGenerationCase,
    ImagenMultimodalCase,
    ContinuedChatPromotionCase,
    UpdatedBadgeDisplayCase,
    EphemeralChatPruningCase,
    UninstallLifecycleCase,
    TakeoutZipImportCase,
    DeepScanPaginationCase,
    AuthoritativeTitleUpgradeCase,
    SearchKeywordCase,
    SearchIdCase,
    SearchClearCase,
    SelectionControlsCase,
    LanguageToggleCase,
    LiveDiskAutoSaveCase,
    ZipExportDownloadCase,
    MultimodalSpecCase,
    DESIGNATED_HISTORICAL_CHATS
)

try:
    from scripts.cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url, is_gemini_url
except ImportError:
    from cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url, is_gemini_url


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
        self.dataset = dataset
        self.delay = delay
        self.takeout_zip = takeout_zip or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tests", "fixtures", "gemini_takeout_clean.zip"))
        self.keep_chats = keep_chats

        self.ctx = TestContext(
            port=self.port,
            output_dir=self.output_dir,
            dataset=self.dataset,
            delay=self.delay,
            takeout_zip=self.takeout_zip,
            keep_chats=self.keep_chats
        )

        # 向上兼容字段映射
        self.provider = self.ctx.provider
        self.tracker = self.ctx.tracker
        self.scenarios = self.ctx.scenarios
        self.registry = self.ctx.registry

    @property
    def ext_id(self):
        return self.ctx.ext_id

    @ext_id.setter
    def ext_id(self, val):
        self.ctx.ext_id = val

    @property
    def chat_records(self):
        return self.ctx.chat_records

    def run(self) -> bool:
        """执行 DAG 特性依赖驱动测试，并在 finally 阶段自动执行生命周期回收"""
        try:
            return self._execute_lifecycle()
        finally:
            try:
                tabs = get_tabs(self.port)
                gemini_tab = next((t for t in tabs if is_gemini_url(t.get("url", ""))), None)
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
        print("🚀 启动 Gemini Exporter DAG 特性驱动测试执行器 (DAG Feature Runner)")
        print(f"📁 导出落盘目录: {self.output_dir}")
        print(f"🌐 Chrome 调试端口: 127.0.0.1:{self.port}")
        print("=" * 80)

        # 步骤 0：扩展卸载与纯净重装
        print("\n🔄 [步骤 0] 通过 CDP 原生卸载并纯净安装当前工作区代码...")
        self.ext_id = CDPActions.reinstall_extension(self.port, repo_path=self.ctx.worktree_root)
        if not self.ext_id:
            print("❌ 扩展安装失败，终止运行！")
            return False
        time.sleep(1.0)
        print(f"🧩 当前活跃扩展 ID: {self.ext_id}")

        # 准备 Gemini 标签页
        gemini_tab = self.ctx.ensure_gemini_tab()
        if not gemini_tab:
            print("❌ 未在 Chrome 中找到或创建 gemini.google.com 页面，请先启动测试浏览器！")
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

        # 允许全局下载落盘行为
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

        # 组装 DAG 调度器
        dag = DAGRunner()
        dag.register(TourGuideCase())
        dag.register(InpageBadgeCase())
        dag.register(ChatGenerationCase())
        dag.register(ImagenMultimodalCase())
        dag.register(ContinuedChatPromotionCase())
        dag.register(UpdatedBadgeDisplayCase())
        dag.register(EphemeralChatPruningCase())
        dag.register(TakeoutZipImportCase())
        dag.register(DeepScanPaginationCase())
        dag.register(AuthoritativeTitleUpgradeCase())
        dag.register(SearchKeywordCase())
        dag.register(SearchIdCase())
        dag.register(SearchClearCase())
        dag.register(SelectionControlsCase())
        dag.register(LanguageToggleCase())
        dag.register(LiveDiskAutoSaveCase())
        dag.register(ZipExportDownloadCase())
        dag.register(MultimodalSpecCase())
        dag.register(UninstallLifecycleCase())

        # 执行调度
        return dag.run(self.ctx)
