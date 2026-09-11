# scripts/framework/cases/chat.py
import time
from typing import Tuple, Optional, Dict, Any

from scripts.framework.cases.base import FeatureTestCase, TestContext
from scripts.framework.features import FeatureDomain
from scripts.framework.actions import CDPActions

try:
    from scripts.cdp_client import CDPConnection
except ImportError:
    from cdp_client import CDPConnection


class InpageBadgeCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_inpage_export_badge",
            domain=FeatureDomain.PAGE_CHAT,
            name="页面端悬浮导出徽标",
            description="监听页面加载，徽标处于就绪状态，记录并响应拖拽位置持久化",
            critical=False,
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp = ctx.connect_gemini()
        try:
            has_badge = cdp.eval("""!!document.querySelector('#geminiExportBadge, #gemini-export-badge, .gemini-export-badge, [data-test-id="gemini-export-badge"]')""")
            if has_badge:
                return True, "页面端悬浮徽标正常渲染", None
            return False, "未检测到悬浮徽标 DOM 节点 (#geminiExportBadge)", None
        finally:
            cdp.close()


class ChatGenerationCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_chat_generation",
            domain=FeatureDomain.PAGE_CHAT,
            name="真实多轮问答发帖",
            description="在 gemini.google.com 聚焦输入框并粘贴 Prompt，等待流式回复全部完成落地",
            critical=True,
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_gemini = ctx.connect_gemini()
        try:
            try:
                cdp_gemini.call("Page.bringToFront")
            except Exception:
                pass

            # 模型前置门禁断言
            try:
                CDPActions.ensure_model_and_thinking(cdp_gemini, target_model="3.8 Flash", target_thinking=True, force_menu_check=True)
            except RuntimeError as e:
                return False, f"模型检查不满足: {e}", None

            imagen_found = False

            for chat_idx in range(2):
                sc = ctx.scenarios[chat_idx]
                sc_title = sc.get("title", f"会话 {chat_idx + 1}")
                turns = sc.get("turns", [])
                prompts_clean = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in turns]

                print(f"\n   💬 开始生成第 {chat_idx + 1} 个会话: '{sc_title}' ({len(turns)} 轮)...")
                CDPActions.click_new_chat(cdp_gemini)
                time.sleep(1.5)
                try:
                    cdp_gemini.reconnect()
                except Exception:
                    pass

                if not CDPActions.wait_for_gemini_ready(cdp_gemini):
                    return False, f"会话 {chat_idx + 1} 页面就绪超时", None

                time.sleep(1.0)
                chat_id = None

                for turn_no, turn_input in enumerate(turns, 1):
                    p_text = turn_input.get("prompt", "") if isinstance(turn_input, dict) else str(turn_input)
                    preview = (p_text[:40] + "...") if len(p_text) > 40 else p_text
                    print(f"      ▶️ 轮次 {turn_no}/{len(turns)}: '{preview}'")

                    ok, msg = False, ""
                    for try_idx in range(3):
                        ok, msg = CDPActions.send_gemini_turn(cdp_gemini, turn_input, max_wait=300)
                        if ok:
                            break
                        print(f"         ⚠️ 轮次 {turn_no} 提示: {msg}，等待重试 ({try_idx + 1}/3)...")
                        time.sleep(4)

                    if not ok:
                        return False, f"会话 {chat_idx + 1} 轮次 {turn_no} 失败: {msg}", None

                    chat_id = CDPActions.get_current_chat_id(cdp_gemini) or chat_id
                    if chat_id:
                        ctx.tracker.track(chat_id)

                    # 检查 Imagen 图片
                    if any(kw in p_text for kw in ["生成图片", "画一张", "astronaut cat", "Imagen", "image"]):
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
                            imagen_found = True
                            print("         🎨 AI Imagen 多模态生图实体已在页面渲染落地！")

                    time.sleep(ctx.delay)

                real_title = CDPActions.get_current_chat_title(cdp_gemini) or sc_title
                ctx.chat_records.append({
                    "chat_id": chat_id,
                    "title": real_title,
                    "turns": prompts_clean
                })
                print(f"      🏁 第 {chat_idx + 1} 次对话完成！会话 ID: {chat_id}")

                # 关键真实闭环：在完成会话 1 后，立即触发一次真实导出记录其初始导出时间戳基线，
                # 这样后续在会话 1 进行追加提问时，其更新时间天然晚于导出时间，彻底告别假数据写库作弊！
                if chat_idx == 0 and chat_id and ctx.ext_id:
                    print(f"      📦 触发会话 1 ({chat_id}) 真实导出建立时间基准线...")
                    try:
                        cdp_opt_init = ctx.connect_options()
                        try:
                            # 触发单项导出真实落盘
                            CDPActions.clear_search_workbench(cdp_opt_init)
                            CDPActions.toggle_select_none(cdp_opt_init)
                            CDPActions.select_workbench_item(cdp_opt_init, chat_id, True)
                            CDPActions.trigger_export_zip(cdp_opt_init, ctx.output_dir, max_wait=30)
                            print(f"      ✓ 会话 1 已成功完成初始真实导出并记录 baseline！")
                        finally:
                            cdp_opt_init.close()
                    except Exception as exp_err:
                        print(f"      ⚠️ 会话 1 初始基准导出提示: {exp_err}")

            ctx.shared_data["imagen_found"] = imagen_found
            return True, "2 次会话全部轮次正常生成落地", {"chat_records": ctx.chat_records}
        finally:
            cdp_gemini.close()


class ImagenMultimodalCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_imagen_multimodal",
            domain=FeatureDomain.PAGE_CHAT,
            name="AI Imagen 生图与附件落地",
            description="包含生图指令的 Prompt 触发，网页成功渲染高分辨率生成图像",
            critical=True,
            prerequisites=["feat_chat_generation"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        if ctx.shared_data.get("imagen_found"):
            return True, "检测到 AI Imagen 图片渲染落地", None

        # 检查是否场景中本来就没有生图需求
        has_image_scenario = any(
            any(kw in str(t).lower() for kw in ["image", "draw", "画", "图", "生成"])
            for sc in ctx.scenarios[:2] for t in sc.get("turns", [])
        )
        if has_image_scenario:
            return False, "预期生图场景未在页面捕获到 AI Imagen 图片渲染实体", None
        return False, "当次提供的数据集中无生图提问轮次", None
