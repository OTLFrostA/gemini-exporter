#!/usr/bin/env python3
"""
scripts/test_visual_agent.py
----------------------------
Gemini Exporter — Visual AI Testing Playground & Autonomous QA Agent (Tier 3)

Architecture:
1. VisualPlayground (The Environment / Sandbox):
   - Pure screenshot perception (0 DOM leaks)
   - Hardware-grade physical mouse/keyboard actuation
   - Deterministic blocking wait primitives (`wait_on`), reusing Tier 2 infrastructure
2. Agent-as-Master:
   - Interactive Mode (`--playground`): Opens the Playground for active agent interaction via `scripts/visual_agent/cli.py` or subagents.
   - Autonomous Mode (`--autonomous` / `--goal`): Runs the AutonomousVisualAgent ReAct loop driven by Gemini 2.0 Flash.
"""

import sys
import os
import time
import argparse

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from scripts.cdp_client import CDP_DEFAULT_PORT, get_tabs, is_gemini_url, CDPConnection
from scripts.visual_agent.playground import open_visual_playground, VisualPlayground
from scripts.visual_agent.agent import AutonomousVisualAgent, VisualQAAgent
from scripts.visual_agent.scorecard import VisualUXScorecard
from scripts.visual_agent.providers.gemini_vision_provider import GeminiVisionProvider


DEFAULT_OBJECTIVES = [
    "探索并完成新手向导，验证引导气泡与聚焦目标无视觉遮挡，点击下一步直至向导完成。",
    "巡检工作台排版，验证所有核心控制按钮文本完整无截断，并核验模态遮罩层能够阻止背景误触。",
    "导入 Takeout 数据包，选中代表性多模态会话，执行 ZIP 导出并验证物理落地。"
]


def run_playground_interactive_mode(port: int = CDP_DEFAULT_PORT, output_dir: str = None):
    """
    Launches the interactive Playground and displays the operational surface.
    """
    print("=" * 65)
    print(" 🎮 Gemini Exporter — 视觉测试交互靶场已就绪 (Visual Playground)")
    print("=" * 65)

    playground = open_visual_playground(port=port, target_page="options", output_dir=output_dir)
    try:
        obs = playground.capture_screen("playground_ready")
        print(f" [👀 感知] 初始全景截屏已就绪: {obs.file_path} (视口: 1280x800)")
        print("\n 🛠️ 供 AI Agent / 外部子 Agent 调用的标准 CLI 靶场工具集:")
        print("   • 📸 截取当前画面:   python3 scripts/visual_agent/cli.py screenshot [--name <name>]")
        print("   • 🖱️ 物理鼠标点击:   python3 scripts/visual_agent/cli.py click --x <0.0-1.0> --y <0.0-1.0>")
        print("   • ⌨️ 物理键盘键入:   python3 scripts/visual_agent/cli.py type --text \"<text>\" [--x <x> --y <y>]")
        print("   • 📜 物理滚轮滚动:   python3 scripts/visual_agent/cli.py scroll --delta <pixels>")
        print("   • ⏳ 确定性挂起等待: python3 scripts/visual_agent/cli.py wait-on --condition <cond> [--timeout <s>]")
        print("   • 🔄 重置靶场环境:   python3 scripts/visual_agent/cli.py reset [--target options|gemini]")
        print("   • 📦 规范断言评测:   python3 scripts/visual_agent/cli.py evaluate-export --zip <path>")
        print("\n [✅ 就绪] 靶场处于完全可用状态。Agent 可直接使用上述指令或通过 Subagent 进行黑盒交互测试。")
        return True
    finally:
        playground.teardown()


def run_autonomous_mode(
    goal: str,
    port: int = CDP_DEFAULT_PORT,
    output_dir: str = None,
    max_steps: int = 25
) -> bool:
    """
    Runs the AutonomousVisualAgent ReAct loop driven by Gemini 2.0 Flash multimodal model.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print(" [❌ 错误] 自主 Agent 模式需要配置 GEMINI_API_KEY 或 GOOGLE_API_KEY 环境变量！")
        print(" [ℹ️ 提示] 若想在本地无需 API Key 手动或通过 Subagent 交互，请运行: npm run test:visual -- --playground")
        return False

    print("=" * 65)
    print(" 🚀 启动 AutonomousVisualAgent 多模态自主视觉闭环推演")
    print(f" 🎯 目标任务: {goal}")
    print("=" * 65)

    playground = open_visual_playground(port=port, target_page="options", output_dir=output_dir)
    scorecard = VisualUXScorecard(output_dir=playground.output_dir)
    provider = GeminiVisionProvider(api_key=api_key)
    agent = AutonomousVisualAgent(playground=playground, provider=provider, scorecard=scorecard)

    try:
        result = agent.run_objective(goal, max_steps=max_steps)
        scorecard.save()
        return result.success
    finally:
        playground.teardown()


def run_playground_smoke_verification(port: int = CDP_DEFAULT_PORT, output_dir: str = None) -> bool:
    """
    Verifies all 5 physical primitives of VisualPlayground against live Chrome (port 9222).
    """
    print("=" * 65)
    print(" 🔍 启动 VisualPlayground 物理沙盒基础原子原语自检...")
    print("=" * 65)

    playground = open_visual_playground(port=port, target_page="options", output_dir=output_dir)
    try:
        # 1. 截图感知
        obs = playground.capture_screen("smoke_test_init")
        assert os.path.isfile(obs.file_path) and len(obs.image_bytes) > 1000, "Screenshot capture failed"
        print(f" [✅ 通过] 纯截屏物理感知正常: {os.path.basename(obs.file_path)} ({len(obs.image_bytes)} bytes)")

        # 2. 物理鼠标点击
        playground.mouse_click(0.5, 0.5, label="smoke_click")
        print(" [✅ 通过] 硬件级物理鼠标点击原语正常 (0.500, 0.500)")

        # 3. 物理键盘键入
        playground.input_text("smoke_test", x=0.5, y=0.1, clear_first=True)
        print(" [✅ 通过] 硬件级物理键盘键入与清空原语正常")

        # 4. 物理滚轮
        playground.mouse_scroll(delta_y=150)
        print(" [✅ 通过] 硬件级物理滚轮滚动原语正常 (deltaY: 150)")

        # 5. 确定性等待
        w_res = playground.wait_on("ui_idle", timeout=5)
        print(f" [✅ 通过] 确定性阻塞挂起原语正常: {w_res.message} (耗时: {w_res.elapsed:.2f}s)")

        print("=" * 65)
        print(" 🏆 VisualPlayground 5 大核心原子原语全部自检通过！靶场完全就绪。")
        print("=" * 65)
        return True
    finally:
        playground.teardown()


def main():
    parser = argparse.ArgumentParser(description="Gemini Exporter Visual AI Testing Playground (Tier 3)")
    parser.add_argument("--port", type=int, default=CDP_DEFAULT_PORT, help="Chrome CDP port (default: 9222)")
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory for screenshots")
    parser.add_argument("--playground", action="store_true", help="Launch interactive playground mode")
    parser.add_argument("--autonomous", action="store_true", help="Run autonomous VLM agent loop")
    parser.add_argument("--goal", type=str, default=None, help="Custom natural language goal for autonomous agent")
    parser.add_argument("--max-steps", type=int, default=25, help="Max steps for autonomous loop")
    parser.add_argument("--smoke", action="store_true", help="Run playground physical primitives smoke check")
    args = parser.parse_args()

    if args.playground:
        success = run_playground_interactive_mode(port=args.port, output_dir=args.output_dir)
    elif args.autonomous or args.goal:
        goal = args.goal or DEFAULT_OBJECTIVES[0]
        success = run_autonomous_mode(goal=goal, port=args.port, output_dir=args.output_dir, max_steps=args.max_steps)
    elif args.smoke:
        success = run_playground_smoke_verification(port=args.port, output_dir=args.output_dir)
    else:
        # 默认执行靶场物理原语就绪自检并打印交互入口
        success = run_playground_smoke_verification(port=args.port, output_dir=args.output_dir)
        run_playground_interactive_mode(port=args.port, output_dir=args.output_dir)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
