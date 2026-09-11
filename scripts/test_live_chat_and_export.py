#!/usr/bin/env python3
"""
scripts/test_live_chat_and_export.py
------------------------------------
Gemini Exporter 全流程特性驱动测试入口 (Feature-Driven Live Chat & Export Test).
基于 scripts/framework 模块化测试框架：
- 声明式 18 大功能特性 (FeatureRegistry) 跨 5 大生命周期领域
- CDP 操作原语 (CDPActions) 与 规范级严格断言 (CDPAssertions)
- 自动化执行编排器 (FrameworkRunner)
- 磁盘实时保存严格核验 (严禁 0 字节图片与对话)
- 4 大黄金分类多模态规范断言 (ExportSpecificationAsserter)
"""

import sys
import os
import json
import time
import argparse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True, encoding="utf-8")
except Exception:
    pass

from scripts.framework.features import FeatureRegistry, FeatureDomain, TestStatus
from scripts.framework.actions import CDPActions
from scripts.framework.assertions import CDPAssertions
from scripts.framework.runner import FrameworkRunner, DEFAULT_SCENARIOS, DESIGNATED_HISTORICAL_CHATS

try:
    from scripts.cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url
except ImportError:
    from cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url

CDP_DEFAULT_PORT = 9222
DATASET_MAX_AGE_SECONDS = 120  # 2 分钟新鲜度时效限制


# -------------------------------------------------------------
# 向上兼容辅助函数 (Backward Compatibility Delegates)
# -------------------------------------------------------------
def reinstall_extension_via_cdp(port=CDP_DEFAULT_PORT, repo_path=None):
    return CDPActions.reinstall_extension(port=port, repo_path=repo_path)


def verify_onboarding_tour(port=CDP_DEFAULT_PORT, ext_id=None, timeout=15):
    return CDPActions.verify_onboarding_tour(port=port, ext_id=ext_id, timeout=timeout)


def wait_for_gemini_ready(cdp, max_wait=30):
    return CDPActions.wait_for_gemini_ready(cdp, max_wait=max_wait)


def get_current_chat_id(cdp):
    return CDPActions.get_current_chat_id(cdp)


def get_current_chat_title(cdp):
    return CDPActions.get_current_chat_title(cdp)


def send_turn(cdp, turn_input, max_wait=240):
    return CDPActions.send_gemini_turn(cdp, turn_input, max_wait=max_wait)


def run_live_chat_and_export(
    dataset=None,
    port=CDP_DEFAULT_PORT,
    output_dir=None,
    delay=2,
    takeout_zip=None,
    keep_chats=False
):
    """
    执行全流程特性驱动测试。
    实例化 FrameworkRunner 并执行 5 大领域 18 项功能特性全闭环验证。
    """
    runner = FrameworkRunner(
        port=port,
        output_dir=output_dir,
        dataset=dataset,
        delay=delay,
        takeout_zip=takeout_zip,
        keep_chats=keep_chats
    )
    return runner.run()


def validate_dataset_freshness(dataset_path, allow_stale=False, max_age_seconds=DATASET_MAX_AGE_SECONDS):
    """
    门禁检查：
    在非 allow_stale 模式下，强制要求必须传入 2 分钟之内新鲜生成的数据集文件。
    若未传入或文件超过 max_age_seconds 秒，拦截并返回详细的错误指导说明。
    """
    if allow_stale:
        if dataset_path:
            if not os.path.isfile(dataset_path):
                return False, f"❌ 指定的数据集文件不存在: {dataset_path}"
            try:
                with open(dataset_path, "r", encoding="utf-8") as f:
                    return True, json.load(f)
            except Exception as e:
                return False, f"❌ 读取数据集 JSON 失败: {e}"
        return True, None

    sep = "=" * 70
    if not dataset_path:
        msg = f"""
{sep}
❌ [AI 执行门禁拦截] 未指定测试数据集（--dataset <path>）！
{sep}
💡 场景池标准模式：推荐不传入 `--dataset`，执行器将自动通过统一场景池调度出队最新场景：
   npm run test:live:pool
   (或 python3 scripts/test_live_chat_and_export.py --pool)

💡 规则说明：若手动传入 `--dataset`，由 AI Agent 驱动的测试与验收必须现场动态构思全新的测试场景并在 {max_age_seconds} 秒（2 分钟）之内生成 JSON 数据集文件，严禁直接复用静态数据集。
💡 人工调试提示：若本次运行并非由 AI Agent 驱动（例如人工本地调试或离线复现），请添加 `--allow-stale-dataset` 参数以绕过此时效限制并允许使用内置默认数据集：
   python3 scripts/test_live_chat_and_export.py --allow-stale-dataset
{sep}"""
        return False, msg

    if not os.path.isfile(dataset_path):
        return False, f"❌ 指定的数据集文件不存在: {dataset_path}"

    try:
        mtime = os.path.getmtime(dataset_path)
        file_age = time.time() - mtime
    except Exception as e:
        return False, f"❌ 获取数据集文件修改时间失败: {e}"

    if file_age > max_age_seconds:
        msg = f"""
{sep}
❌ [AI 执行门禁拦截] 数据集文件 `{dataset_path}` 生成/修改于 {int(file_age)} 秒前（已超过 2 分钟 / {max_age_seconds} 秒时效限制）！
{sep}
💡 场景池标准模式：推荐不传入 `--dataset`，执行器将自动通过统一场景池调度出队最新场景：
   npm run test:live:pool
{sep}"""
        return False, msg

    try:
        with open(dataset_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return True, data
    except Exception as e:
        return False, f"❌ 读取数据集 JSON 失败: {e}"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Gemini 特性驱动全流程实跑测试 (Feature-Driven Live Chat & Export Test)")
    parser.add_argument("--pool", action="store_true", help="从动态场景池中自动消费最新多模态场景（默认行为）")
    parser.add_argument("--dataset", default=None, help="自定义测试数据集 JSON 文件路径 (AI 协同模式下必须在 2 分钟之内新鲜生成)")
    parser.add_argument("--allow-stale-dataset", action="store_true", help="允许使用超过 2 分钟时效限制的历史数据集（供非 AI Agent 的人工本地调试使用）")
    parser.add_argument("--keep-chats", action="store_true", help="测试完成后豁免物理删除、保留线上生成的会话（默认 False，跑完即自动彻底删除清理）")
    parser.add_argument("--output-dir", default=None, help="测试导出落地目录")
    parser.add_argument("--port", type=int, default=CDP_DEFAULT_PORT, help="Chrome CDP 远程调试端口")
    parser.add_argument("--delay", type=int, default=2, help="轮次之间的间隔秒数")
    parser.add_argument("--takeout-zip", default=None, help="自定义预置 Takeout ZIP 样本路径")
    args = parser.parse_args()

    custom_dataset = None
    if args.dataset:
        valid, result_or_err = validate_dataset_freshness(
            args.dataset,
            allow_stale=args.allow_stale_dataset
        )
        if not valid:
            print(result_or_err)
            sys.exit(1)
        custom_dataset = result_or_err

    success = run_live_chat_and_export(
        dataset=custom_dataset,
        port=args.port,
        output_dir=args.output_dir,
        delay=args.delay,
        takeout_zip=args.takeout_zip,
        keep_chats=args.keep_chats
    )
    sys.exit(0 if success else 1)
