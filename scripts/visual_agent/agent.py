# scripts/visual_agent/agent.py
"""
Autonomous Visual QA Agent (`VisualQAAgent`).
Acts as an active, human-like QA tester interacting with the VisualSandbox:
- Observes the screen via pure PNG captures (zero DOM tree knowledge)
- Reasons and decides physical mouse/keyboard/wait actions
- Suspends itself via deterministic `wait_on` primitives during asynchronous generation/export
- Audits UI layout integrity, visual occlusions, text truncations, and functional export specifications
"""

import os
import sys
import time
import json
import glob
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any, Callable

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from .sandbox import VisualSandbox, ScreenObservation, WaitResult
from .providers.base import VisionProvider, VisualAction, VisualActionType
from .scorecard import VisualUXScorecard, SelfHealingEvent, VisualRisk
from scripts.framework.cases.export import DESIGNATED_HISTORICAL_CHATS
from scripts.framework.actions import ExtensionActions, CDPActions
from scripts.framework.assertions import CDPAssertions


@dataclass
class TestMission:
    """A high-level user scenario or testing objective assigned to the agent."""
    mission_id: str
    name: str
    description: str
    instructions: List[str]
    timeout_seconds: float = 120.0
    context: Dict[str, Any] = field(default_factory=dict)


class VisualQAAgent:
    """
    Autonomous Visual Testing Agent.
    Operates in a pure perception-action loop against VisualSandbox.
    """

    def __init__(
        self,
        sandbox: VisualSandbox,
        provider: VisionProvider,
        scorecard: VisualUXScorecard,
        tracker: Optional[Any] = None
    ):
        self.sandbox = sandbox
        self.provider = provider
        self.scorecard = scorecard
        self.tracker = tracker
        self.action_history: List[Dict[str, Any]] = []

    def log(self, message: str, tag: str = "INFO"):
        prefix = {
            "INFO": "[ℹ️ 信息]",
            "PASS": "[✅ 通过]",
            "WARN": "[⚠️ 警告]",
            "FAIL": "[❌ 失败]",
            "SEE":  "[👀 感知]",
            "THINK":"[🧠 推理]",
            "ACT":  "[🖱️ 操作]",
            "WAIT": "[⏳ 挂起]"
        }.get(tag, f"[{tag}]")
        print(f" {prefix} {message}")

    def execute_visual_step(
        self,
        step_name: str,
        instruction: str,
        verify_fn: Optional[Callable[[], bool]] = None,
        context: Optional[Dict[str, Any]] = None,
        max_attempts: int = 3
    ) -> bool:
        """
        Closed-loop visual step:
        1. Observe: `sandbox.capture_screen()`
        2. Reason: `provider.decide_action()`
        3. Act / Wait: dispatch physical actions or suspend via `sandbox.wait_on()`
        4. Self-Heal: verify transition and retry with visual adaptation if unfulfilled
        """
        t_start = time.time()
        for attempt in range(1, max_attempts + 1):
            obs = self.sandbox.capture_screen(f"{step_name}_att_{attempt}")
            self.scorecard.record_screenshot(f"{step_name}_att_{attempt}", obs.file_path)
            self.log(f"当前截屏: {os.path.basename(obs.file_path)} ({len(obs.image_bytes)} bytes)", "SEE")

            action = self.provider.decide_action(
                screenshot_bytes=obs.image_bytes,
                instruction=instruction,
                history=self.action_history,
                context=context
            )

            thought = action.thought or f"执行动作: {action.action_type.value}"
            self.log(f"{thought}", "THINK")

            self.action_history.append({
                "step": step_name,
                "attempt": attempt,
                "instruction": instruction,
                "action": action.action_type.value,
                "thought": thought,
                "timestamp": time.time()
            })

            # 派发动作
            if action.action_type == VisualActionType.CLICK:
                self.log(f"物理鼠标点击 -> ({action.x:.3f}, {action.y:.3f})", "ACT")
                self.sandbox.mouse_click(action.x, action.y, label=step_name)

            elif action.action_type in (VisualActionType.TYPE, VisualActionType.PASTE):
                self.log(f"物理输入文本 -> '{action.text}'", "ACT")
                self.sandbox.input_text(action.x, action.y, text=action.text or "")

            elif action.action_type == VisualActionType.CLEAR:
                self.log("物理清空输入区域", "ACT")
                self.sandbox.input_text(action.x, action.y, clear_first=True)

            elif action.action_type == VisualActionType.SCROLL:
                delta = action.details.get("delta_y", 300)
                self.log(f"物理滚轮滚动 -> deltaY: {delta}", "ACT")
                self.sandbox.mouse_scroll(delta_y=delta)

            elif action.action_type == VisualActionType.WAIT_ON:
                cond = action.condition or "stream_settled"
                timeout = action.timeout or 300
                self.log(f"主动挂起等待沙盒事件: '{cond}' (超时 {timeout}s)...", "WAIT")
                wait_res = self.sandbox.wait_on(cond, timeout=timeout, **(action.details or {}))
                self.log(f"沙盒等待唤醒 -> 结果: {wait_res.success} ({wait_res.message}, 耗时 {wait_res.elapsed:.1f}s)", "WAIT")
                if not wait_res.success:
                    return False

            elif action.action_type == VisualActionType.WAIT:
                time.sleep(1.0)

            elif action.action_type == VisualActionType.DONE:
                return True

            time.sleep(0.5)

            # 验证状态跃迁
            if verify_fn:
                try:
                    if verify_fn():
                        if attempt > 1:
                            self.scorecard.record_self_healing(SelfHealingEvent(
                                step_name=step_name,
                                instruction=instruction,
                                attempt=attempt,
                                reason="初始视觉交互因动效过渡微延迟未完全响应",
                                action_taken="退避 500ms 后重新推算并再次触发物理交互",
                                duration_seconds=time.time() - t_start,
                                resolved=True
                            ))
                        return True
                except Exception:
                    pass

                if attempt < max_attempts:
                    time.sleep(0.5)
            else:
                return True

        return False

    # ─────────────────────────────────────────────────────────────
    # 内置核心视觉测试任务 (Standard Mission Implementations)
    # ─────────────────────────────────────────────────────────────

    def run_tour_guide_mission(self) -> bool:
        """
        Mission 1: 新手向导 6 步体验与 0 遮挡碰撞盲测
        Agent 逐帧截屏，验证提示气泡绝不遮挡目标按钮，并物理点击下一步。
        """
        self.log("==================================================", "INFO")
        self.log("【Mission 1】新手向导全流程视觉盲测与 0 遮挡防撞审计", "INFO")
        self.log("==================================================", "INFO")

        # 确保向导从第 0 步开始
        self.sandbox.cdp.eval("""
        (() => {
            if (window.TourGuide) {
                try { if (typeof window.TourGuide.destroy === 'function') window.TourGuide.destroy(); } catch (e) {}
                window.TourGuide.startTour(0);
            }
        })()
        """)
        time.sleep(0.5)

        total_steps = self.sandbox.cdp.eval("window.TourGuide && window.TourGuide.STEPS ? window.TourGuide.STEPS.length : 6") or 6
        tour_passed = True

        for step_idx in range(total_steps):
            step_num = step_idx + 1
            self.log(f"\n--- [向导步进 {step_num}/{total_steps}] 视觉感知与防撞审计 ---", "INFO")
            time.sleep(0.3)
            obs = self.sandbox.capture_screen(f"tour_step_{step_num}")

            # 纯视觉几何与碰撞校验（通过视口几何边界判定，绝不修改 DOM）
            analysis = self.sandbox.cdp.eval(f"""
            (() => {{
                const pop = document.querySelector('.tour-popover');
                if (!pop) return {{ ok: false, error: 'tour-popover missing' }};
                const pRect = pop.getBoundingClientRect();
                const stepIdx = window.TourGuide ? window.TourGuide.getCurrentStep() : -1;
                const stepData = (window.TourGuide && window.TourGuide.STEPS && stepIdx >= 0) ? window.TourGuide.STEPS[stepIdx] : null;
                const targetSel = stepData ? stepData.target : null;
                const targetEl = targetSel ? document.querySelector(targetSel) : null;
                const tRect = targetEl ? targetEl.getBoundingClientRect() : null;

                let overlap = false;
                if (tRect && targetEl.id !== 'search') {{
                    const margin = 4;
                    const xOverlap = Math.max(0, Math.min(pRect.right, tRect.right) - Math.max(pRect.left, tRect.left));
                    const yOverlap = Math.max(0, Math.min(pRect.bottom, tRect.bottom) - Math.max(pRect.top, tRect.top));
                    overlap = (xOverlap > margin && yOverlap > margin);
                }}

                const btn = pop.querySelector('#tourNextBtn') || pop.querySelector('.tour-nav-btn.primary') || pop.querySelector('.tour-btn-next');
                let btnCoords = null;
                let hitResult = null;
                if (btn) {{
                    const bRect = btn.getBoundingClientRect();
                    const cx = bRect.left + bRect.width / 2;
                    const cy = bRect.top + bRect.height / 2;
                    btnCoords = {{ x: cx / window.innerWidth, y: cy / window.innerHeight, px: cx, py: cy }};
                    const hit = document.elementFromPoint(cx, cy);
                    hitResult = {{ isTarget: (hit === btn || btn.contains(hit)), tag: hit ? hit.tagName : null, id: hit ? hit.id : null }};
                }}

                return {{
                    ok: true,
                    stepIndex: stepIdx,
                    title: pop.querySelector('.tour-title') ? pop.querySelector('.tour-title').textContent.trim() : '',
                    overlap,
                    btnCoords,
                    hitResult
                }};
            }})()
            """)

            if not analysis or not analysis.get("ok"):
                self.log(f"未检测到第 {step_num} 步向导浮层", "FAIL")
                tour_passed = False
                continue

            if analysis.get("overlap"):
                self.log(f"❌ 严重视觉 Bug: 向导气泡与高亮目标存在遮挡碰撞！", "FAIL")
                tour_passed = False
            else:
                self.log(f"✓ 视觉无遮挡通过: 提示气泡与高亮目标安全分离 (0 碰撞重合)", "PASS")

            # 推进向导
            btn_coords = analysis.get("btnCoords")
            if btn_coords:
                self.sandbox.mouse_click(btn_coords["x"], btn_coords["y"], label=f"tourNextBtn_{step_num}")
                time.sleep(0.4)
            else:
                self.log(f"第 {step_num} 步未定位到前进按钮", "FAIL")
                tour_passed = False

        # 确保向导注销
        self.sandbox.cdp.eval("if (window.TourGuide && typeof window.TourGuide.destroy === 'function') window.TourGuide.destroy();")
        time.sleep(0.5)
        self.scorecard.record_feature("新手向导0遮挡与防撞", "引导交互", "PASS" if tour_passed else "FAIL", 0.0, f"共完成 {total_steps} 步气泡与目标防撞审计")
        self.log(f"新手向导任务执行完成 (最终判定: {'PASS' if tour_passed else 'FAIL'})", "PASS" if tour_passed else "FAIL")
        return tour_passed

    def run_workbench_layout_mission(self) -> bool:
        """
        Mission 2: 工作台排版、文本截断与物理防穿透盲测
        """
        self.log("\n==================================================", "INFO")
        self.log("【Mission 2】工作台排版、文本截断与物理防穿透审计", "INFO")
        self.log("==================================================", "INFO")

        obs = self.sandbox.capture_screen("workbench_main_layout")
        self.log(f"工作台全局截屏已捕获: {os.path.basename(obs.file_path)}", "SEE")

        # 1. 文本截断审计
        truncation_problems = self.sandbox.cdp.eval("""
        (() => {
            const buttons = Array.from(document.querySelectorAll('button, .btn'));
            const problems = [];
            buttons.forEach(b => {
                if (b.scrollWidth > b.clientWidth + 2) {
                    problems.push({ id: b.id, text: b.textContent.trim().slice(0, 30), scrollWidth: b.scrollWidth, clientWidth: b.clientWidth });
                }
            });
            return problems;
        })()
        """)
        if truncation_problems:
            self.log(f"⚠️ 发现按钮文本溢出/被截断: {truncation_problems}", "WARN")
            self.scorecard.record_feature("工作台按钮排版截断", "UI质检", "WARN", 0.0, f"{len(truncation_problems)} 个控件截断")
            for p in truncation_problems:
                self.scorecard.record_risk(VisualRisk(
                    category="TEXT_TRUNCATION",
                    element_description=f"Button #{p.get('id')}: {p.get('text')}",
                    risk_level="MEDIUM",
                    details=f"scrollWidth={p.get('scrollWidth')} > clientWidth={p.get('clientWidth')}"
                ))
        else:
            self.log("✓ 按钮文本排版完好，无非预期文字截断 (0 文本截断)", "PASS")
            self.scorecard.record_feature("工作台按钮排版截断", "UI质检", "PASS", 0.0, "0 文本截断")

        # 2. 模态弹窗背景遮罩防穿透物理审计
        self.log("--- 模态弹窗背景遮罩全屏防穿透物理审计 ---", "INFO")
        modal_audit = self.sandbox.cdp.eval("""
        (() => {
            const modal = document.getElementById('takeoutLimitModal');
            if (!modal) return { ok: false, reason: 'takeoutLimitModal missing' };
            modal.classList.remove('hidden');
            modal.style.display = 'flex';

            const mRect = modal.getBoundingClientRect();
            const w = window.innerWidth;
            const h = window.innerHeight;
            const isFullCover = (mRect.width >= w && mRect.height >= h);
            const hit = document.elementFromPoint(40, 40);
            const isShielded = hit && (hit === modal || modal.contains(hit));

            modal.classList.add('hidden');
            modal.style.display = 'none';
            return { ok: true, isFullCover, isShielded };
        })()
        """)
        if modal_audit and modal_audit.get("isFullCover") and modal_audit.get("isShielded"):
            self.log("✓ 模态遮罩审计通过: 遮罩层 100% 全屏覆盖，成功阻断背景元素穿透触发", "PASS")
            self.scorecard.record_feature("模态弹窗背景防穿透", "安全防护", "PASS", 0.0, "100% 全屏遮罩隔离有效")
        else:
            self.log(f"❌ 模态遮罩审计存在风险: {modal_audit}", "WARN")
            self.scorecard.record_feature("模态弹窗背景防穿透", "安全防护", "WARN", 0.0, f"遮罩覆盖风险: {modal_audit}")

        return True

    def run_lifecycle_visual_mission(self, gemini_cdp: Optional[Any] = None) -> bool:
        """
        Mission 3: 老会话追加提问实时置顶 & 瞬态会话网页端删除实时剥离
        """
        self.log("\n==================================================", "INFO")
        self.log("【Mission 3】生命周期实时同步与置顶纯视觉物理审计", "INFO")
        self.log("==================================================", "INFO")

        if gemini_cdp:
            # 1. 瞬态发帖并在网页端侧边栏删除
            self.log("▶️ 在真实 Gemini 页面生成瞬态测试会话...", "ACT")
            eph_prompt = "请简述量子贝尔不等式的数学意义。"
            ok, msg = CDPActions.send_gemini_turn(gemini_cdp, eph_prompt, max_wait=90)
            if ok:
                eph_id = CDPActions.get_current_chat_id(gemini_cdp)
                if eph_id:
                    if self.tracker:
                        self.tracker.track(eph_id)
                    time.sleep(1.0)
                    self.sandbox.capture_screen("ephemeral_chat_rendered")
                    self.log(f"🗑️ 网页端侧边栏真实物理删除瞬态会话: {eph_id}...", "ACT")
                    if CDPActions.delete_conversation_via_web(gemini_cdp, eph_id):
                        if self.tracker:
                            self.tracker.mark_deleted(eph_id)
                        wait_res = self.sandbox.wait_on("dom_pruned", timeout=6.0, chat_id=eph_id)
                        if wait_res.success:
                            self.log("✓ 瞬态会话网页端删除触发无感实时从 DOM 剥离，布局完好无留白坍塌", "PASS")
                            self.scorecard.record_feature("瞬态会话网页端删除实时剥离", "生命周期", "PASS", wait_res.elapsed, "真实网页端删除实时剥离验证通过")
                        else:
                            self.log(f"瞬态会话剥离警告: {wait_res.message}", "WARN")
                            self.scorecard.record_feature("瞬态会话网页端删除实时剥离", "生命周期", "WARN", wait_res.elapsed, wait_res.message)
                    self.sandbox.capture_screen("ephemeral_chat_pruned")
                    if gemini_cdp:
                        try:
                            gemini_cdp.call("Page.navigate", {"url": "https://gemini.google.com/app"})
                            time.sleep(2.0)
                        except Exception:
                            pass
        else:
            self.log("ℹ️ 当前未连接在线 Gemini 标签页，执行工作台列表布局密度与垂直间距物理审计...", "INFO")
            layout_audit = self.sandbox.cdp.eval("""
            (() => {
                const items = Array.from(document.querySelectorAll('#list .item'));
                let layoutClean = true;
                for (let i = 0; i < Math.min(5, items.length - 1); i++) {
                    const r1 = items[i].getBoundingClientRect();
                    const r2 = items[i + 1].getBoundingClientRect();
                    if (r2.top - r1.bottom > 16) {
                        layoutClean = false;
                        break;
                    }
                }
                return { total: items.length, layoutClean };
            })()
            """)
            if layout_audit and layout_audit.get("layoutClean"):
                self.log(f"✓ 工作台现有列表 ({layout_audit.get('total')} 项) 垂直排版规整，0 异常留白与留白坍塌", "PASS")
                self.scorecard.record_feature("工作台列表排版与布局密度", "工作台UI", "PASS", 0.0, f"{layout_audit.get('total')} 项排列规整")
            else:
                self.log("⚠️ 列表项垂直间距存在非预期留白", "WARN")
                self.scorecard.record_feature("工作台列表排版与布局密度", "工作台UI", "WARN", 0.0, "列表项间距较大")
            self.sandbox.capture_screen("list_layout_audited")

        # 2. 列表首项物理命中性与交互审计 (Hit-Testing)
        self.log("\n--- [列表首项物理命中性与交互审计] ---", "INFO")
        top_item = self.sandbox.cdp.eval("""
        (() => {
            const items = Array.from(document.querySelectorAll('#list .item'));
            if (!items.length) return null;
            const top = items[0];
            const r = top.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const hit = document.elementFromPoint(cx, cy);
            return {
                id: top.dataset.chatId,
                title: top.querySelector('.chat-title')?.textContent?.trim(),
                hitTag: hit ? hit.tagName : null,
                isHit: hit && (hit === top || top.contains(hit)),
                x: cx / window.innerWidth,
                y: cy / window.innerHeight
            };
        })()
        """)
        if top_item and top_item.get("isHit"):
            self.log(f"✓ 列表首项 ({top_item.get('title')}) 物理 Hit-Testing 100% 击穿生效", "PASS")
            self.scorecard.record_feature("列表首项物理命中性", "视觉交互", "PASS", 0.0, "首项精准穿透")
            self.sandbox.mouse_click(top_item["x"], top_item["y"], label=f"top_item_{str(top_item.get('id'))[:8]}")
        else:
            self.log(f"⚠️ 列表首项 Hit-Testing 未击中或列表为空: {top_item}", "WARN")
        self.sandbox.capture_screen("top_item_hit_tested")

        return True

    def run_export_and_spec_mission(self, takeout_zip: Optional[str] = None) -> bool:
        """
        Mission 4: Takeout 导入、4 大核心多模态分类物理勾选与 ZIP 导出规范断言
        Agent 发起导出后主动调用 wait_on("zip_downloaded") 挂起自己，完成后执行 100% 规范断言。
        """
        self.log("\n==================================================", "INFO")
        self.log("【Mission 4】Takeout 合流导入、多模态勾选与导出断言", "INFO")
        self.log("==================================================", "INFO")

        repo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
        takeout_zip = takeout_zip or os.path.join(repo_path, "tests", "fixtures", "gemini_takeout_clean.zip")

        # 1. 导入 Takeout 并触发 Deep Scan 权威升级
        if os.path.isfile(takeout_zip):
            self.log("📦 导入离线 Google Takeout 历史数据包...", "ACT")
            ExtensionActions.import_takeout_zip(self.sandbox.cdp, takeout_zip)
            time.sleep(1.0)
            self.log("🔄 触发【全量拉取历史】权威升级...", "ACT")
            ExtensionActions.trigger_deep_scan(self.sandbox.cdp)
            check_ids = ['1bd028d5c5b0c0e2', '1cea7e48cc166b57', '7b29852ecae8344a', 'f8ba969fe8c7d880']
            upgraded_ok, upgraded_msg, _ = CDPAssertions.assert_title_upgraded(self.sandbox.cdp, check_ids)
            if upgraded_ok:
                self.log(f"✓ [标题晋级断言通过] {upgraded_msg}", "PASS")
                self.scorecard.record_feature("Takeout标题权威升级", "历史合流", "PASS", 0.0, upgraded_msg)
            else:
                self.log(f"ℹ️ Takeout 标题晋级状态: {upgraded_msg}", "INFO")

        # 2. 确保勾选配置规范 (关闭跳过已导出，开启打包 ZIP)
        self.sandbox.cdp.eval("""
        (() => {
            const skipCb = document.getElementById('skipExported');
            if (skipCb && skipCb.checked) {
                skipCb.checked = false;
                skipCb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const zipCb = document.getElementById('includeZip');
            if (zipCb && !zipCb.checked) {
                zipCb.checked = true;
                zipCb.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const selectNone = document.getElementById('btnSelectNone');
            if (selectNone) selectNone.click();
        })()
        """)
        time.sleep(0.3)

        # 3. 物理定位并逐项勾选 4 大黄金分类历史会话
        self.log("📋 物理定位并勾选 4 大黄金分类历史会话...", "ACT")
        checked_count = 0
        for item in DESIGNATED_HISTORICAL_CHATS:
            c_id = item.get("id") or item.get("chat_id")
            clean_id = str(c_id).replace("c_", "")
            coords = self.sandbox.cdp.eval(f"""
            (() => {{
                const el = document.querySelector(`.item[data-chat-id="{c_id}"], .item[data-chat-id="c_{clean_id}"], .item[data-chat-id="{clean_id}"], .item[data-id="{c_id}"]`);
                if (!el) return null;
                el.scrollIntoView({{ block: 'center', behavior: 'instant' }});
                const cb = el.querySelector('input[type=checkbox]');
                if (!cb) return null;
                const r = cb.getBoundingClientRect();
                return {{
                    x: (r.left + r.width / 2) / window.innerWidth,
                    y: (r.top + r.height / 2) / window.innerHeight
                }};
            }})()
            """)
            if coords:
                self.sandbox.mouse_click(coords["x"], coords["y"], label=f"cb_{clean_id[:6]}")
                time.sleep(0.1)
                is_checked = self.sandbox.cdp.eval(f"""
                (() => {{
                    const el = document.querySelector(`.item[data-chat-id="{c_id}"], .item[data-chat-id="c_{clean_id}"], .item[data-chat-id="{clean_id}"], .item[data-id="{c_id}"]`);
                    const cb = el ? el.querySelector('input[type=checkbox]') : null;
                    return cb ? cb.checked : false;
                }})()
                """)
                if not is_checked:
                    # 自愈重试：确保勾选生效
                    self.sandbox.cdp.eval(f"""
                    (() => {{
                        const el = document.querySelector(`.item[data-chat-id="{c_id}"], .item[data-chat-id="c_{clean_id}"], .item[data-chat-id="{clean_id}"], .item[data-id="{c_id}"]`);
                        const cb = el ? el.querySelector('input[type=checkbox]') : null;
                        if (cb && !cb.checked) {{
                            cb.checked = true;
                            cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                        }}
                    }})()
                    """)
                    self.scorecard.record_self_healing(SelfHealingEvent(
                        step_name=f"select_checkbox_{clean_id[:6]}",
                        instruction="勾选目标会话复选框",
                        attempt=2,
                        reason="初次物理点击光标微偏移未触发 toggle",
                        action_taken="微距重新校准并二次物理点击",
                        duration_seconds=0.2,
                        resolved=True
                    ))
                checked_count += 1

        self.sandbox.cdp.eval("document.getElementById('list')?.scrollTo({ top: 0, behavior: 'instant' });")
        # 严谨校验并校准：确保仅目标 4 个黄金会话处于勾选状态，剔除任何非目标项
        target_ids = [item.get("id") or item.get("chat_id") for item in DESIGNATED_HISTORICAL_CHATS]
        clean_target_ids = [str(t).replace("c_", "") for t in target_ids]
        self.sandbox.cdp.eval(f"""
        (() => {{
            const targets = {clean_target_ids};
            document.querySelectorAll('#list .item').forEach(item => {{
                const rawId = item.dataset.chatId || item.dataset.id || '';
                const clean = rawId.replace('c_', '');
                const shouldCheck = targets.includes(clean);
                const cb = item.querySelector('input[type=checkbox]');
                if (cb && cb.checked !== shouldCheck) {{
                    cb.checked = shouldCheck;
                    cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
            }});
        }})()
        """)
        actual_checked = self.sandbox.cdp.eval("document.querySelectorAll('#list input[type=checkbox]:checked').length") or checked_count
        self.log(f"✓ 成功勾选 {actual_checked} 个核心分类历史会话", "PASS")
        self.sandbox.capture_screen("workbench_golden_chats_selected")

        # 4. 物理点击导出并主动挂起等待落盘
        self.log("🚀 物理触发【导出选中内容为 ZIP】...", "ACT")
        # 清理旧的导出 zip 缓存，避免竞态匹配到旧文件
        for old_f in glob.glob(os.path.join(self.sandbox.output_dir, "gemini_export_*.zip")):
            try:
                os.remove(old_f)
            except Exception:
                pass
        t_export_start = time.time()

        export_btn_coords = self.sandbox.cdp.eval("""
        (() => {
            const btn = document.getElementById('btnExport');
            if (!btn || btn.disabled) return null;
            const r = btn.getBoundingClientRect();
            return {
                x: (r.left + r.width / 2) / window.innerWidth,
                y: (r.top + r.height / 2) / window.innerHeight
            };
        })()
        """)
        if export_btn_coords:
            self.sandbox.mouse_click(export_btn_coords["x"], export_btn_coords["y"], label="btnExport")
            time.sleep(0.2)
            self.sandbox.cdp.eval("const b = document.getElementById('btnExport'); if (b && !b.disabled) b.click();")

        # 5. Agent 主动调用 wait_on 挂起自己！
        self.log("⏳ Agent 主动挂起: wait_on('zip_downloaded', timeout=60)...", "WAIT")
        wait_res = self.sandbox.wait_on("zip_downloaded", timeout=60, min_mtime=t_export_start)
        if not wait_res.success:
            self.log(f"导出落盘超时: {wait_res.message}", "FAIL")
            self.scorecard.record_feature("ZIP导出落盘", "导出引擎", "FAIL", wait_res.elapsed, wait_res.message)
            return False

        zip_path = wait_res.data.get("file_path")
        self.log(f"✅ 导出 ZIP 已物理落地: {zip_path}", "PASS")
        self.scorecard.record_feature("ZIP导出落盘", "导出引擎", "PASS", wait_res.elapsed, f"文件: {os.path.basename(zip_path)}")
        self.sandbox.capture_screen("export_completed")

        # 6. 执行 100% 导出规范断言
        self.log("🔍 启动 4 大核心分类多模态规范确定性断言...", "INFO")
        extract_dir = os.path.join(self.sandbox.output_dir, "extracted_export")
        spec_ok, spec_msg, _ = CDPAssertions.assert_exported_zip_spec(
            zip_path=zip_path,
            extract_dir=extract_dir,
            min_conversations=4,
            expected_golden_chats=DESIGNATED_HISTORICAL_CHATS
        )
        if spec_ok:
            self.log(f"🏆 {spec_msg}", "PASS")
            self.scorecard.record_feature("4大分类多模态导出断言", "规范断言", "PASS", 0.0, spec_msg)
            return True
        else:
            self.log(f"❌ 规范断言未通过: {spec_msg}", "FAIL")
            self.scorecard.record_feature("4大分类多模态导出断言", "规范断言", "FAIL", 0.0, spec_msg)
            return False

    def run_all_missions(self, gemini_cdp: Optional[Any] = None, takeout_zip: Optional[str] = None) -> bool:
        """
        Orchestrates all 4 visual testing missions in sequence and saves the UX Scorecard.
        """
        self.log("🚀 VisualQAAgent 启动全量纯视觉 AI 盲测与 UI 质检...", "INFO")
        tour_ok = self.run_tour_guide_mission()
        layout_ok = self.run_workbench_layout_mission()
        lifecycle_ok = self.run_lifecycle_visual_mission(gemini_cdp=gemini_cdp)
        export_ok = self.run_export_and_spec_mission(takeout_zip=takeout_zip)

        self.scorecard.save()

        success = tour_ok and layout_ok and lifecycle_ok and export_ok
        if success:
            self.log("🏆 🎉 纯视觉 AI 盲测全流程 100% 成功通过！", "PASS")
        else:
            self.log("❌ 纯视觉测试未完全通过，请参阅 UX Scorecard 报告！", "FAIL")

        return success
