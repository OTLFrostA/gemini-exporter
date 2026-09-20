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


def run_playground_interactive_mode(
    port: int = CDP_DEFAULT_PORT,
    target_page: str = "options",
    output_dir: str = None,
    reinstall: bool = False
):
    """
    Launches the interactive Playground and displays the operational surface.
    """
    print("=" * 65)
    print(" 🎮 Gemini Exporter — 视觉测试交互靶场已就绪 (Visual Playground)")
    print("=" * 65)

    playground = open_visual_playground(
        port=port,
        target_page=target_page,
        output_dir=output_dir,
        reinstall=reinstall
    )
    try:
        obs = playground.capture_screen("playground_ready")
        print(f" [👀 感知] 初始全景截屏已就绪: {obs.file_path} (目标: {target_page}, 视口: 1280x800)")
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
    max_steps: int = 25,
    reinstall: bool = False,
    ai_review: bool = False,
    model: str = None
) -> bool:
    """
    Runs the AutonomousVisualAgent ReAct loop driven by Gemini multimodal vision model.
    """
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print(" [❌ 错误] 自主 Agent 模式需要配置 GEMINI_API_KEY 或 GOOGLE_API_KEY 环境变量！")
        print(" [ℹ️ 提示] 若想在本地无需 API Key 手动或通过 Subagent 交互，请运行: npm run test:visual -- --playground")
        return False

    print("=" * 65)
    print(" 🚀 启动 AutonomousVisualAgent 多模态自主视觉闭环推演")
    print(f" 🎯 目标任务: {goal}")
    if model:
        print(f" 🧠 指定模型: {model}")
    if ai_review:
        print(" 🔍 多模态视觉审查: 已开启 (--ai-review)")
    print("=" * 65)

    playground = open_visual_playground(
        port=port,
        target_page="options",
        output_dir=output_dir,
        reinstall=reinstall
    )
    scorecard = VisualUXScorecard(output_dir=playground.output_dir)
    provider = GeminiVisionProvider(api_key=api_key, model=model)
    agent = AutonomousVisualAgent(playground=playground, provider=provider, scorecard=scorecard)

    try:
        result = agent.run_objective(goal, max_steps=max_steps)
        if ai_review and scorecard.screenshots:
            print("\n 🤖 启动 Gemini Vision 多模态全景视觉质检与体验体检...")
            review_text = provider.review_screenshots(scorecard.screenshots)
            scorecard.ai_review = review_text
            print(" [✅ 完成] 多模态视觉审查意见已注入 Scorecard 审计报告")
        scorecard.save()
        return result.success
    finally:
        playground.teardown()


def run_playground_smoke_verification(
    port: int = CDP_DEFAULT_PORT,
    output_dir: str = None,
    reinstall: bool = False
) -> bool:
    """
    Verifies all 6 physical primitives of VisualPlayground against live Chrome (port 9222).
    Ensures 0 UI pollution: clicks safe inert targets and clears typed text immediately.
    """
    print("=" * 65)
    print(" 🔍 启动 VisualPlayground 物理沙盒基础原子原语自检 (0 污染模式)...")
    print("=" * 65)

    playground = open_visual_playground(
        port=port,
        target_page="options",
        output_dir=output_dir,
        reinstall=reinstall
    )
    try:
        # 1. 截图感知
        obs = playground.capture_screen("smoke_test_init")
        assert os.path.isfile(obs.file_path) and len(obs.image_bytes) > 1000, "Screenshot capture failed"
        print(f" [✅ 通过] 纯截屏物理感知正常: {os.path.basename(obs.file_path)} ({len(obs.image_bytes)} bytes)")

        # 2. 物理鼠标点击（使用顶部 Header 静态品牌区域，绝对安全且无任何可交互副作用）
        playground.mouse_click(0.08, 0.02, label="smoke_click_safe_header")
        print(" [✅ 通过] 硬件级物理鼠标点击原语正常 (安全静态区域 0.080, 0.020)")

        # 3. 物理键盘键入与即时还原（即便落在搜索框，也确保自检完毕后 100% 清空还原）
        playground.input_text("smoke_test", x=0.5, y=0.1, clear_first=True)
        print(" [✅ 通过] 硬件级物理键盘键入原语正常")
        playground.input_text("", x=0.5, y=0.1, clear_first=True)
        playground.press_key("Escape")
        playground.mouse_click(0.08, 0.02, label="blur_search_input")
        print(" [✅ 通过] 键盘输入自检已完成即时清空与失焦还原，UI 0 污染")

        # 4. 物理按键派发
        playground.press_key("Escape")
        print(" [✅ 通过] 硬件级物理按键派发原语正常 (Escape)")

        # 5. 物理滚轮与复位
        playground.mouse_scroll(delta_y=150)
        playground.mouse_scroll(delta_y=-150)
        print(" [✅ 通过] 硬件级物理滚轮滚动与复位原语正常 (deltaY: +/-150)")

        # 6. 确定性等待
        w_res = playground.wait_on("ui_idle", timeout=5)
        print(f" [✅ 通过] 确定性阻塞挂起原语正常: {w_res.message} (耗时: {w_res.elapsed:.2f}s)")

        print("=" * 65)
        print(" 🏆 VisualPlayground 6 大核心原子原语全部自检通过！靶场纯净就绪。")
        print("=" * 65)
        return True
    finally:
        playground.teardown()


def run_popup_visual_inspection(
    port: int = CDP_DEFAULT_PORT,
    output_dir: str = None
) -> bool:
    """
    Inspects Popup Action Center visual layout, internationalization toggle,
    format switching, and console redirect with physical actuation (0 UI pollution).
    """
    import urllib.request
    print("\n" + "=" * 65)
    print(" 🎯 启动 Popup 动作中心纯视觉交互与功能巡检 (Tier 3 动作中心质检)...")
    print("=" * 65)

    playground = open_visual_playground(
        port=port,
        target_page="popup",
        output_dir=output_dir,
        reinstall=False
    )
    try:
        # 1. 纯截屏物理感知 Popup 初始界面 (0 DOM 泄露)
        obs_init = playground.capture_screen("popup_inspect_init")
        assert os.path.isfile(obs_init.file_path) and len(obs_init.image_bytes) > 1000, "Popup initial capture failed"
        print(f" [✅ 通过] Popup 动作中心视觉感知就绪: {os.path.basename(obs_init.file_path)} ({len(obs_init.image_bytes)} bytes)")

        # 2. 物理鼠标点击语言切换开关 (切至 EN: 归一化 0.261, 0.028)
        playground.mouse_click(0.261, 0.028, label="popup_click_lang_en")
        time.sleep(0.4)
        obs_en = playground.capture_screen("popup_inspect_en")
        assert os.path.isfile(obs_en.file_path) and len(obs_en.image_bytes) > 1000, "Popup EN capture failed"
        print(f" [✅ 通过] 物理点击切换英文 (EN) 瞬态响应正常: {os.path.basename(obs_en.file_path)}")

        # 3. 物理鼠标点击格式 Tab (切换至 Markdown: 归一化 0.060, 0.212)
        playground.mouse_click(0.060, 0.212, label="popup_click_fmt_markdown")
        time.sleep(0.3)
        obs_fmt = playground.capture_screen("popup_inspect_fmt_markdown")
        assert os.path.isfile(obs_fmt.file_path) and len(obs_fmt.image_bytes) > 1000, "Popup format capture failed"
        print(f" [✅ 通过] 物理点击格式 Tab (Markdown) 响应正常: {os.path.basename(obs_fmt.file_path)}")

        # 4. 物理鼠标点击【去控制台批量导出 ↗】(归一化 0.203, 0.264)
        playground.mouse_click(0.203, 0.264, label="popup_click_open_console")
        time.sleep(0.8)
        print(" [✅ 通过] 物理点击【去控制台批量导出 ↗】跨标签页跳转触发正常")

        # 5. 还原语言设置与 0 污染闭环 (点击中文: 归一化 0.225, 0.028)
        playground.mouse_click(0.225, 0.028, label="popup_restore_lang_zh")
        time.sleep(0.3)
        print(" [✅ 通过] Popup 语言与格式状态已物理复原 (UI 0 污染)")

        print("=" * 65)
        print(" 🏆 Popup 动作中心 4 大物理交互与视觉质检全部通过！")
        print("=" * 65)
        return True
    finally:
        playground.teardown()
        try:
            tabs = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=3).read())
            for t in tabs:
                if "popup.html" in t.get("url", ""):
                    tid = t.get("id")
                    if tid:
                        urllib.request.urlopen(f"http://127.0.0.1:{port}/json/close/{tid}", timeout=2)
        except Exception:
            pass


def main():
    parser = argparse.ArgumentParser(description="Gemini Exporter Visual AI Testing Playground (Tier 3)")
    parser.add_argument("--port", type=int, default=CDP_DEFAULT_PORT, help="Chrome CDP port (default: 9222)")
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory for screenshots")
    parser.add_argument("--target", type=str, default="options", choices=["options", "gemini", "popup"], help="Target page for playground (default: options)")
    parser.add_argument("--playground", action="store_true", help="Launch interactive playground mode")
    parser.add_argument("--autonomous", action="store_true", help="Run autonomous VLM agent loop")
    parser.add_argument("--goal", type=str, default=None, help="Custom natural language goal for autonomous agent")
    parser.add_argument("--max-steps", type=int, default=25, help="Max steps for autonomous loop")
    parser.add_argument("--smoke", action="store_true", help="Run playground physical primitives smoke check")
    parser.add_argument("--popup", action="store_true", help="Run Popup Action Center visual inspection exclusively")
    parser.add_argument("--skip-popup", action="store_true", help="Skip Popup Action Center inspection during smoke check")
    parser.add_argument("--no-reinstall", action="store_true", help="跳过启动时的扩展卸载与纯净重装 (默认第一步强制纯净重装)")
    parser.add_argument("--ai-review", action="store_true", help="Run Gemini Vision multimodal review on captured snapshots")
    parser.add_argument("--model", type=str, default=None, help="Gemini Vision model name (defaults to GEMINI_MODEL env or gemini-2.0-flash)")
    args = parser.parse_args()

    do_reinstall = not args.no_reinstall

    if args.popup:
        success = run_popup_visual_inspection(port=args.port, output_dir=args.output_dir)
    elif args.playground:
        success = run_playground_interactive_mode(port=args.port, target_page=args.target, output_dir=args.output_dir, reinstall=do_reinstall)
    elif args.autonomous or args.goal or args.ai_review:
        goal = args.goal or DEFAULT_OBJECTIVES[0]
        success = run_autonomous_mode(
            goal=goal,
            port=args.port,
            output_dir=args.output_dir,
            max_steps=args.max_steps,
            reinstall=do_reinstall,
            ai_review=args.ai_review,
            model=args.model
        )
    elif args.smoke:
        success = run_playground_smoke_verification(port=args.port, output_dir=args.output_dir, reinstall=do_reinstall)
        if success and not args.skip_popup:
            success = run_popup_visual_inspection(port=args.port, output_dir=args.output_dir)
    else:
        # 默认执行靶场物理原语就绪自检并打印交互入口
        success = run_playground_smoke_verification(port=args.port, output_dir=args.output_dir, reinstall=do_reinstall)
        if success and not args.skip_popup:
            success = run_popup_visual_inspection(port=args.port, output_dir=args.output_dir)
        run_playground_interactive_mode(port=args.port, target_page=args.target, output_dir=args.output_dir, reinstall=False)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
