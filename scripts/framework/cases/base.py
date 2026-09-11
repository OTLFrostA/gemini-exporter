# scripts/framework/cases/base.py
"""
Base abstractions for Feature-Driven E2E test cases and DAG execution.
Defines TestContext, FeatureTestCase, and DAGRunner.
"""

import os
import sys
import time
import json
import traceback
import urllib.request
from abc import ABC, abstractmethod
from typing import Dict, List, Optional, Any, Tuple

from scripts.framework.features import Feature, FeatureDomain, FeatureRegistry, TestStatus, TestResult
from scripts.framework.scenario_provider import OnlineScenarioProvider
from scripts.framework.lifecycle_tracker import SessionLifecycleTracker

try:
    from scripts.cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url, is_gemini_url
except ImportError:
    from cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url, is_gemini_url


class TestContext:
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
        self.worktree_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        self.output_dir = os.path.abspath(output_dir or os.path.join(self.worktree_root, "tests", "output", "live_export"))
        self.delay = delay
        self.takeout_zip = takeout_zip or os.path.abspath(os.path.join(self.worktree_root, "tests", "fixtures", "gemini_takeout_clean.zip"))
        self.keep_chats = keep_chats
        self.start_time = time.time()

        self.provider = OnlineScenarioProvider()
        self.tracker = SessionLifecycleTracker()
        self.registry = FeatureRegistry()

        if isinstance(dataset, dict) and "scenarios" in dataset:
            self.scenarios = dataset["scenarios"]
        elif isinstance(dataset, list) and dataset:
            self.scenarios = dataset
        else:
            print("🏊 [场景池调度] 从在线对话池中提取 2 个最新多模态场景 (1个Imagen生图 + 1个深度推演)...")
            sc_img = self.provider.pop_scenario(required_features=["imagen"], min_turns=2)
            sc_text = self.provider.pop_scenario(min_turns=2)
            self.scenarios = [sc_img, sc_text]

        self.ext_id: Optional[str] = None
        self.chat_records: List[Dict[str, Any]] = []
        self.shared_data: Dict[str, Any] = {}
        os.makedirs(self.output_dir, exist_ok=True)

    def get_gemini_tab(self) -> Optional[Dict[str, Any]]:
        tabs = get_tabs(self.port)
        return next((t for t in tabs if is_gemini_url(t.get("url", ""))), None)

    def ensure_gemini_tab(self) -> Optional[Dict[str, Any]]:
        tab = self.get_gemini_tab()
        if not tab:
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{self.port}/json/new?https://gemini.google.com/app", method="PUT")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    tab = json.loads(resp.read().decode())
                    time.sleep(3.0)
            except Exception as e:
                print(f"   ⚠️ 自动创建 Gemini 标签页异常: {e}")
        return tab or self.get_gemini_tab()

    def get_options_tab(self) -> Optional[Dict[str, Any]]:
        if not self.ext_id:
            return None
        options_url = f"chrome-extension://{self.ext_id}/src/ui/options/options.html"
        tabs = get_tabs(self.port)
        return next((t for t in tabs if options_url in t.get("url", "")), None)

    def ensure_options_tab(self) -> Optional[Dict[str, Any]]:
        if not self.ext_id:
            return None
        tab = self.get_options_tab()
        if not tab:
            options_url = f"chrome-extension://{self.ext_id}/src/ui/options/options.html"
            new_url = f"http://127.0.0.1:{self.port}/json/new?{options_url}"
            try:
                req = urllib.request.Request(new_url, method="PUT")
                with urllib.request.urlopen(req, timeout=5) as r:
                    tab = json.loads(r.read().decode("utf-8"))
                    time.sleep(1.0)
            except Exception as e:
                print(f"   ⚠️ 自动打开 Options 标签页异常: {e}")
        return tab or self.get_options_tab()

    def connect_gemini(self) -> CDPConnection:
        tab = self.ensure_gemini_tab()
        if not tab:
            raise RuntimeError("Gemini 标签页不存在且无法创建")
        return CDPConnection(tab["webSocketDebuggerUrl"])

    def connect_options(self) -> CDPConnection:
        tab = self.ensure_options_tab()
        if not tab:
            raise RuntimeError("Options 标签页不存在且无法创建")
        return CDPConnection(tab["webSocketDebuggerUrl"])


class FeatureTestCase(ABC):
    def __init__(
        self,
        feature_id: str,
        domain: FeatureDomain,
        name: str,
        description: str,
        critical: bool = True,
        prerequisites: Optional[List[str]] = None
    ):
        self.feature_id = feature_id
        self.domain = domain
        self.name = name
        self.description = description
        self.critical = critical
        self.prerequisites = prerequisites or []

    def to_feature(self) -> Feature:
        return Feature(
            id=self.feature_id,
            domain=self.domain,
            name=self.name,
            description=self.description,
            critical=self.critical,
            prerequisites=self.prerequisites
        )

    @abstractmethod
    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """
        执行特性测试逻辑。
        返回 (success: bool, message: str, details: Optional[Dict])
        """
        pass

    def teardown(self, ctx: TestContext):
        """测试后清理（可选）"""
        pass


class DAGRunner:
    def __init__(self):
        self.cases: Dict[str, FeatureTestCase] = {}

    def register(self, case: FeatureTestCase):
        self.cases[case.feature_id] = case

    def get_execution_order(self) -> List[FeatureTestCase]:
        """拓扑排序解析执行顺序"""
        in_degree: Dict[str, int] = {fid: 0 for fid in self.cases}
        graph: Dict[str, List[str]] = {fid: [] for fid in self.cases}

        for fid, case in self.cases.items():
            for prereq in case.prerequisites:
                if prereq in self.cases:
                    graph[prereq].append(fid)
                    in_degree[fid] += 1

        queue = [fid for fid, deg in in_degree.items() if deg == 0]
        order = []

        while queue:
            curr = queue.pop(0)
            order.append(self.cases[curr])
            for neighbor in graph[curr]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        # 处理可能存在的环路或孤立项
        if len(order) < len(self.cases):
            remaining = [self.cases[fid] for fid in self.cases if self.cases[fid] not in order]
            order.extend(remaining)

        return order

    def run(self, ctx: TestContext) -> bool:
        """按拓扑顺序调度执行用例"""
        # 同步特性至 registry
        for case in self.cases.values():
            ctx.registry.register(case.to_feature())

        ordered_cases = self.get_execution_order()
        print(f"📋 [DAG 调度器] 解析拓扑依赖完成，执行序列包含 {len(ordered_cases)} 个用例。")

        for idx, case in enumerate(ordered_cases, 1):
            fid = case.feature_id
            print(f"\n[{idx}/{len(ordered_cases)}] ▶️ 调度特性: [{fid}] ({case.name})...")

            # 检查前置依赖
            failed_prereq = None
            for prereq in case.prerequisites:
                res = ctx.registry.get_result(prereq)
                if not res or res.status != TestStatus.PASS:
                    failed_prereq = prereq
                    break

            if failed_prereq:
                reason = f"前置依赖 [{failed_prereq}] 未通过，自动安全跳过"
                print(f"   ⏭️ [{fid}] SKIP: {reason}")
                ctx.registry.record_result(fid, TestStatus.SKIP, 0.0, reason)
                continue

            t0 = time.time()
            success = False
            message = ""
            details = None
            try:
                success, message, details = case.execute(ctx)
            except Exception as e:
                success = False
                message = f"执行异常: {e}"
                details = {"traceback": traceback.format_exc()}
                print(f"   ❌ [{fid}] 异常: {e}")
            finally:
                try:
                    case.teardown(ctx)
                except Exception as te:
                    print(f"   ⚠️ [{fid}] Teardown 异常: {te}")

            duration = time.time() - t0
            status = TestStatus.PASS if success else TestStatus.FAIL
            ctx.registry.record_result(fid, status, duration, message, details)

            if success:
                print(f"   ✅ [{fid}] PASS (耗时 {duration:.1f}s): {message}")
            else:
                print(f"   ❌ [{fid}] FAIL (耗时 {duration:.1f}s): {message}")

        # 生成最终检验矩阵
        print("\n" + ctx.registry.generate_matrix_report())

        # 校验关键特性
        has_failed_critical = False
        for case in self.cases.values():
            if case.critical:
                res = ctx.registry.get_result(case.feature_id)
                if not res or res.status != TestStatus.PASS:
                    has_failed_critical = True
                    status_str = res.status.value if res else "未执行"
                    print(f"❌ 关键特性 [{case.feature_id}] ({case.name}) 未通过 (状态: {status_str})！")
                    break

        return not has_failed_critical
