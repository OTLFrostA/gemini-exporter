# scripts/framework/actions.py
"""
Reusable CDP Action Primitives for Gemini Exporter Test Automation.
Encapsulates real web interactions (typing, clicking, waiting for streams, searching, importing, deleting).
"""

import os
import re
import time
import json
import base64
import urllib.request
from typing import Tuple, Optional, Dict, Any, List

import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
try:
    from scripts.cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url
except ImportError:
    from cdp_client import CDPConnection, get_tabs, get_extension_id, get_browser_ws_url

from scripts.framework.pipeline import (
    SerialActionExecutor,
    AssertIdleAction,
    StagePromptAction,
    SingleClickSendAction,
    AwaitStreamSettledAction,
    HumanCooldownAction
)
from scripts.framework.selectors import GeminiSelectors, WorkbenchSelectors
from scripts.framework.gateway import get_gateway
from scripts.framework.v2_probe import install_probe, snapshot

SCAN_OBSERVER = r"""(() => {
    const btn = document.getElementById('btnSyncAll');
    if (!btn || btn.disabled || document.body.dataset.busy !== 'false') return {error:'Scan button missing/disabled'};
    window.__tier2ScanObserver?.disconnect();
    const evidence = {started:false, finished:false};
    window.__tier2ScanEvidence = evidence;
    const inspect = (records = []) => {
        if (records.some(record => record.type === 'attributes' && record.attributeName === 'data-busy' && record.oldValue === 'true')) evidence.started = true;
        const busy = document.body.dataset.busy === 'true';
        if (busy) evidence.started = true;
        const account = document.getElementById('accountIdSelect')?.value;
        const currentText = document.getElementById('status')?.textContent || '';
        if (busy && /^(Committed \d+ pages|已接纳 \d+ 页)/.test(currentText)) {
            if (evidence.accountId && evidence.accountId !== account) evidence.error = 'Scan account changed';
            evidence.accountId = account;
        }
        if (!evidence.started || busy || evidence.finished) return;
        const text = document.getElementById('status')?.textContent || '';
        evidence.uiStatus = text;
        if (evidence.accountId && account !== evidence.accountId) { evidence.error = 'Scan account changed'; evidence.finished = true; return; }
        evidence.accountId = account;
        const matched = text.match(/^(.*?) · (\d+) \/ (\d+)$/);
        const statuses = {
            'Connected to trusted history coverage':'up_to_date', '已衔接可信历史范围':'up_to_date',
            'Reached the end of this Recent source':'complete', '已达到本次 Recent 来源尽头':'complete',
            'Source online access limit':'provider_limit', '来源在线访问范围限制':'provider_limit',
            'Local page budget reached':'max_pages', '已达到本地页数预算':'max_pages',
            'Scan cancelled':'aborted', '扫描已取消':'aborted', 'Scan failed':'error', '扫描失败':'error'
        };
        if (matched && statuses[matched[1]]) evidence.response = {
            status:statuses[matched[1]], pagesFetched:Number(matched[2]), conversationsFetched:Number(matched[3])
        };
        else evidence.error = text || 'No v2 Scan result';
        evidence.finished = true;
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, {attributes:true,attributeOldValue:true,attributeFilter:['data-busy'],subtree:true,childList:true,characterData:true});
    window.__tier2ScanObserver = observer;
    btn.click(); inspect();
    return {clicked:true};
})()"""


_SHARED_PIPELINE_EXECUTOR = SerialActionExecutor()



class ExtensionActions:
    """
    Universal Chrome Extension Options Page & Management Automation Primitives.
    Independent of underlying AI platform; operates strictly on the extension UI.
    """
    @staticmethod
    def reinstall_extension(port: int = 9222, repo_path: Optional[str] = None) -> Optional[str]:
        """通过 CDP Extensions 域指令彻底卸载并纯净重新安装插件"""
        repo_path = os.path.abspath(repo_path or os.path.join(os.path.dirname(__file__), "..", ".."))
        try:
            import subprocess
            subprocess.run(["node", "build.js"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception as e:
            print(f"   ⚠️ 自动构建提示: {e}")

        browser_ws = get_browser_ws_url(port)
        if not browser_ws:
            print(f"❌ 无法获取 Chrome Browser WebSocket (端口 {port})")
            return None

        old_ext_id = get_extension_id(port)
        cdp = CDPConnection(browser_ws)
        try:
            if old_ext_id:
                print(f"   🗑️ 正在通过 CDP Extensions.uninstall 卸载旧扩展 ({old_ext_id})...")
                try:
                    cdp.call("Extensions.uninstall", {"id": old_ext_id})
                except Exception as e:
                    print(f"   ⚠️ 卸载旧扩展提示: {e}")
                time.sleep(0.5)

            print(f"   📦 正在通过 CDP Extensions.loadUnpacked 安装扩展: {repo_path}...")
            res = cdp.call("Extensions.loadUnpacked", {"path": repo_path})
            new_ext_id = res.get("result", {}).get("id")
            if not new_ext_id:
                print(f"❌ 扩展安装失败，CDP 返回: {res}")
                return None
            print(f"   ✅ 扩展安装成功！新 Extension ID: {new_ext_id}")
            return new_ext_id
        finally:
            cdp.close()

    @staticmethod
    def verify_onboarding_tour(port: int = 9222, ext_id: Optional[str] = None, timeout: int = 15) -> bool:
        """Drive the real installation Tour and verify URL consumption, without stored flags."""
        base = f"chrome-extension://{ext_id}/src/ui/options/options.html"
        deadline = time.monotonic() + timeout
        options_tab = None
        while time.monotonic() < deadline:
            options_tab = next((t for t in get_tabs(port) if base in t.get('url', '')), None)
            if options_tab: break
            time.sleep(0.25)
        if not options_tab:
            return False
        cdp = CDPConnection(options_tab['webSocketDebuggerUrl'])
        try:
            shown = False
            for _ in range(60):
                state = cdp.eval("""(() => {
                    const popover = document.querySelector('.tour-popover');
                    if (!popover) return {active:false, url:location.href};
                    const button = [...popover.querySelectorAll('button')].find(btn => /^(Next|下一步|Start using|开始使用)$/.test(btn.textContent));
                    if (button) button.click();
                    return {active:true};
                })()""") or {}
                if state.get('active'): shown = True
                elif shown:
                    return 'startTour' not in state.get('url', '')
                time.sleep(0.25)
            return False
        finally:
            cdp.close()

    @staticmethod
    def search_workbench(cdp_opt, query: str, timeout: float = 3.0) -> int:
        """在 Options 工作台搜索框输入检索内容并等待过滤生效，返回过滤后可见条目数"""
        cdp_opt.eval(f"""
        (() => {{
            const input = document.querySelector('{WorkbenchSelectors.SEARCH_INPUT}');
            if (!input) return -1;
            input.focus();
            input.value = {json.dumps(query)};
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
            input.blur();
        }})()
        """)
        # 轮询等待列表过滤生效（optionsInit 包含 100ms 防抖及重绘周期）
        start = time.time()
        total_items = len((snapshot(cdp_opt) or {}).get('rows', []))

        while time.time() - start < timeout:
            visible_count = cdp_opt.eval(f"document.querySelectorAll('{WorkbenchSelectors.ITEM}').length") or 0
            if total_items > 1:
                if query and visible_count < total_items:
                    return visible_count
                elif not query and visible_count >= total_items:
                    return visible_count
            else:
                return visible_count
            time.sleep(0.05)

        return cdp_opt.eval(f"document.querySelectorAll('{WorkbenchSelectors.ITEM}').length") or 0

    @staticmethod
    def clear_search_workbench(cdp_opt, timeout: float = 3.0) -> int:
        """清空 Options 工作台搜索框并等待完整列表恢复，返回恢复后的列表总数"""
        cdp_opt.eval(f"""
        (() => {{
            const input = document.querySelector('{WorkbenchSelectors.SEARCH_INPUT}');
            if (!input) return -1;
            input.value = '';
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
            input.blur();
        }})()
        """)
        # 轮询等待搜索防抖及全量列表恢复
        start = time.time()
        target_total = len((snapshot(cdp_opt) or {}).get('rows', []))

        while time.time() - start < timeout:
            visible_count = cdp_opt.eval(f"document.querySelectorAll('{WorkbenchSelectors.ITEM}').length") or 0
            if target_total > 0 and visible_count >= target_total:
                return visible_count
            time.sleep(0.05)

        return cdp_opt.eval(f"document.querySelectorAll('{WorkbenchSelectors.ITEM}').length") or 0

    @staticmethod
    def select_workbench_item(cdp_opt, chat_id: str, checked: bool = True) -> bool:
        """精准操作指定 chatId 卡片的复选框勾选状态"""
        item_sel = WorkbenchSelectors.item_by_chat_id(chat_id)
        return bool(cdp_opt.eval(f"""
        (() => {{
            const item = document.querySelector('{item_sel}');
            if (!item) return false;
            const cb = item.querySelector('{WorkbenchSelectors.CHECKBOX}');
            if (!cb) return false;
            if (cb.checked !== {str(checked).lower()}) {{
                cb.checked = {str(checked).lower()};
                cb.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            return true;
        }})()
        """))

    @staticmethod
    def toggle_select_all(cdp_opt) -> int:
        """点击全选按钮，返回勾选后的复选框总数"""
        return cdp_opt.eval(f"""
        (() => {{
            const btn = document.querySelector('{WorkbenchSelectors.BTN_SELECT_ALL}');
            if (btn) btn.click();
            return document.querySelectorAll('{WorkbenchSelectors.CHECKED_CHECKBOX}').length;
        }})()
        """) or 0

    @staticmethod
    def toggle_select_none(cdp_opt) -> int:
        """点击取消全选按钮，返回勾选后的复选框总数"""
        return cdp_opt.eval(f"""
        (() => {{
            const btn = document.querySelector('{WorkbenchSelectors.BTN_SELECT_NONE}');
            if (btn) btn.click();
            return document.querySelectorAll('{WorkbenchSelectors.CHECKED_CHECKBOX}').length;
        }})()
        """) or 0

    @staticmethod
    def switch_workbench_language(cdp_opt, lang: str = "en") -> str:
        """Use the shipped v2 language toggle and wait for durable Settings."""
        if lang not in ("en", "zh"):
            raise ValueError("Tier 2 workbench language must be en or zh")
        install_probe(cdp_opt)
        return cdp_opt.eval(f"""
        (async () => {{
            const toggle = document.getElementById('langToggle');
            if (!(toggle instanceof HTMLInputElement)) throw new Error('v2 language toggle missing');
            const language = {json.dumps(lang)};
            const enabled = language === 'en';
            const current = await globalThis.__tier2V2.getSettings();
            if (toggle.checked !== enabled || current.language !== language) {{
                toggle.checked = enabled;
                toggle.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            for (let i = 0; i < 100; i++) {{
                const saved = await globalThis.__tier2V2.getSettings();
                const button = document.getElementById('btnSelectAll');
                const value = button?.textContent?.trim() || '';
                const expected = language === 'en' ? value.toLowerCase().includes('all') : value.includes('全选');
                if (document.body.dataset.busy === 'false' && saved.language === language && expected) return value;
                await new Promise(resolve => setTimeout(resolve, 50));
            }}
            throw new Error('v2 language change was not committed or reflected by UI');
        }})()
        """, await_promise=True)

    @staticmethod
    def configure_export_controls(cdp_opt, format_type=None, skip_exported=None) -> Dict[str, Any]:
        """Drive v2 UI controls, not a silent external write to Application Settings.

        The Options controller owns its in-memory Settings mirror. Updating
        IndexedDB directly leaves that mirror stale until the next refresh.
        """
        install_probe(cdp_opt)
        return cdp_opt.eval(f"""
        (async () => {{
            const expectedFormat = {json.dumps(format_type)};
            const expectedSkip = {json.dumps(skip_exported)};
            const waitIdle = async () => {{
                for (let i = 0; i < 100; i++) {{
                    if (document.body.dataset.busy === 'false') return true;
                    await new Promise(resolve => setTimeout(resolve, 50));
                }}
                return false;
            }};
            if (!await waitIdle()) return {{ error: 'v2 Options workbench is busy' }};
            for (const [id, field, value] of [
                ['format', 'defaultFormat', expectedFormat],
                ['skipExported', 'skipExported', expectedSkip]
            ]) {{
                if (value === null) continue;
                const element = document.getElementById(id);
                if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement))
                    return {{ error: 'Missing v2 export control: ' + id }};
                const actual = () => element.type === 'checkbox' ? element.checked : element.value;
                const before = await globalThis.__tier2V2.getSettings();
                if (actual() !== value || before[field] !== value) {{
                    if (element.type === 'checkbox') element.checked = value;
                    else element.value = value;
                    element.dispatchEvent(new Event('change', {{ bubbles: true }}));
                }}
                let settled = false;
                for (let i = 0; i < 100; i++) {{
                    const settings = await globalThis.__tier2V2.getSettings();
                    if (document.body.dataset.busy === 'false' && actual() === value && settings[field] === value) {{
                        settled = true; break;
                    }}
                    await new Promise(resolve => setTimeout(resolve, 50));
                }}
                if (!settled) return {{ error: 'v2 Settings did not commit ' + field }};
            }}
            const delivery = document.querySelector('input[name="delivery"][value="browserDownload"]');
            if (!(delivery instanceof HTMLInputElement))
                return {{ error: 'Missing browser download radio' }};
            const beforeDelivery = await globalThis.__tier2V2.getSettings();
            if (!delivery.checked || beforeDelivery.exportDelivery !== 'browserDownload') {{
                delivery.checked = true;
                delivery.dispatchEvent(new Event('change', {{ bubbles: true }}));
            }}
            let deliverySettled = false;
            for (let i = 0; i < 100; i++) {{
                const settings = await globalThis.__tier2V2.getSettings();
                if (document.body.dataset.busy === 'false' && delivery.checked && settings.exportDelivery === 'browserDownload') {{
                    deliverySettled = true; break;
                }}
                await new Promise(resolve => setTimeout(resolve, 50));
            }}
            if (!deliverySettled) return {{ error: 'v2 Settings did not commit exportDelivery' }};
            return {{ ok: true, format:document.getElementById('format')?.value,
                skipExported:document.getElementById('skipExported')?.checked }};
        }})()
        """, await_promise=True) or {}

    @staticmethod
    def import_takeout_zip(cdp_opt, zip_path: str, media_paths: Optional[List[str]] = None) -> Dict[str, Any]:
        """向工作台导入预置 Takeout ZIP 样本"""
        if not os.path.isfile(zip_path):
            return {"success": False, "error": f"File not found: {zip_path}"}

        with open(zip_path, "rb") as tf:
            zip_b64 = base64.b64encode(tf.read()).decode("ascii")

        install_probe(cdp_opt)
        started = cdp_opt.eval(f"""(() => {{
            const input = document.getElementById('takeoutFileInput');
            if (!input || document.body.dataset.busy !== 'false') return false;
            const bytes = Uint8Array.from(atob({json.dumps(zip_b64)}), c => c.charCodeAt(0));
            const transfer = new DataTransfer();
            transfer.items.add(new File([bytes], {json.dumps(os.path.basename(zip_path))}, {{type:'application/zip'}}));
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', {{bubbles:true}}));
            return true;
        }})()""")
        if started is not True:
            return {'success': False, 'error': 'Takeout file input missing or workbench busy'}
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            result = cdp_opt.eval("""(() => ({ busy:document.body.dataset.busy !== 'false',
                status:document.getElementById('status')?.textContent || '' }))()""") or {}
            if result.get('busy') is False:
                match = re.fullmatch(r'(?:Imported (\d+) conversations|已提交 (\d+) 条对话)（?\s*\((ok|partial)\)）?', result.get('status', ''))
                # Chinese and English use different parentheses.
                match = match or re.fullmatch(r'已提交 (\d+) 条对话（(ok|partial)）', result.get('status', ''))
                if not match:
                    return {'success': False, 'error': result.get('status') or 'No import result'}
                source = cdp_opt.eval(f'globalThis.__tier2V2.inspectTakeout({json.dumps(zip_b64)}, {json.dumps(media_paths or [])})', await_promise=True)
                return {'success': True, 'status': 'partial' if 'partial' in result['status'] else 'ok',
                        'imported': int(next(v for v in match.groups() if v and v.isdigit())),
                        'importedIds': source['ids'], 'mediaDigests': source['mediaDigests'], 'sourceResources': source['resources'],
                        'sourceFacts': source['sourceFacts'],
                        'uiStatus': result['status']}
            time.sleep(0.1)
        return {'success': False, 'error': 'Takeout import timed out'}

    @staticmethod
    def trigger_deep_scan(cdp_opt, max_wait: int = 330) -> Dict[str, Any]:
        """Observe the real v2 UI result, including a scan completing in one turn."""
        prep = cdp_opt.eval(SCAN_OBSERVER) or {}
        if not prep.get('clicked'):
            return {'started': False, 'finished': False, 'error': prep.get('error', 'Button not clicked')}
        start = time.monotonic()
        evidence = {}
        try:
            while time.monotonic() - start < max_wait:
                evidence = cdp_opt.eval('window.__tier2ScanEvidence') or {}
                if evidence.get('finished'):
                    return evidence
                time.sleep(0.25)
            return {**evidence, 'error': 'Full scan response timed out'}
        finally:
            cdp_opt.eval('window.__tier2ScanObserver?.disconnect(); delete window.__tier2ScanObserver;')

    @staticmethod
    def wait_for_export_idle(cdp_opt, max_wait: float = 30) -> bool:
        """Wait for the full export session, including post-download storage refresh."""
        deadline = time.monotonic() + max_wait
        while time.monotonic() < deadline:
            ready = cdp_opt.eval("""(() => {
                const btn = document.getElementById('btnExport');
                return !!btn && document.body.dataset.busy === 'false';
            })()""")
            if ready is True:
                return True
            time.sleep(0.1)
        return False

    @staticmethod
    def trigger_export_zip(
        cdp_opt,
        output_dir: str,
        max_wait: int = 60,
        skip_exported: Optional[bool] = False,
        format_type: Optional[str] = None,
        allow_standalone: bool = False
    ) -> Optional[str]:
        """Drive v2 Export and inspect its physical ZIP or optional standalone Markdown."""
        # Another CDP client can reset Chrome's download behavior after setup.
        # Bind it again on the connection kept alive until this ZIP is on disk.
        os.makedirs(output_dir, exist_ok=True)
        try:
            routed = cdp_opt.call('Browser.setDownloadBehavior', {
                'behavior': 'allow', 'downloadPath': os.path.abspath(output_dir),
                'eventsEnabled': True,
            })
            if not isinstance(routed, dict) or 'error' in routed or 'result' not in routed:
                print(f"❌ ZIP 测试下载目录设置失败: {routed}")
                return None
        except Exception as exc:
            print(f"❌ ZIP 测试下载目录设置失败: {exc}")
            return None
        if not ExtensionActions.wait_for_export_idle(cdp_opt, max_wait=max_wait):
            print("❌ Export not started: previous export did not become idle")
            return None
        settings = ExtensionActions.configure_export_controls(cdp_opt, format_type, skip_exported)
        if not settings.get('ok'):
            print(f"❌ Export v2 controls did not settle: {settings}")
            return None
        # TestEnvironment routes downloads to output_dir. Avoid scanning the user's
        # Downloads folder, where cloud-backed entries can block directory reads.
        # 记录导出触发前已存在的 ZIP 文件与修改时间戳，杜绝旧文件误命中。
        baseline_files = {}
        for check_d in [output_dir]:
            if os.path.isdir(check_d):
                for f in os.listdir(check_d):
                    if f.lower().endswith('.zip') or (allow_standalone and f.lower().endswith('.md')):
                        fp = os.path.abspath(os.path.join(check_d, f))
                        try:
                            baseline_files[fp] = os.path.getmtime(fp)
                        except OSError:
                            pass

        trigger = cdp_opt.eval(f"""
        (() => {{
            const btn = document.querySelector('{WorkbenchSelectors.BTN_EXPORT}');
            if (!btn || btn.disabled || btn.getAttribute('aria-busy') === 'true'
                || document.body.dataset.busy !== 'false') return {{ clicked: false }};
            btn.click();
            return {{ clicked: true }};
        }})()
        """, user_gesture=True)
        if not isinstance(trigger, dict) or not trigger.get('clicked'):
            print("❌ ZIP export not started: export button was unavailable at click time")
            return None
        start_time = time.time()
        downloaded_file = None

        while time.time() - start_time < max_wait:
            time.sleep(1.5)
            if os.path.isdir(output_dir):
                candidates = []
                for f in os.listdir(output_dir):
                    if f.lower().endswith('.zip') or allow_standalone and f.lower().endswith('.md'):
                        fp = os.path.abspath(os.path.join(output_dir, f))
                        try:
                            mtime = os.path.getmtime(fp)
                            if (fp not in baseline_files or mtime > baseline_files[fp]) and os.path.getsize(fp) > 0:
                                candidates.append((mtime, fp))
                        except OSError:
                            pass
                if candidates:
                    candidates.sort(key=lambda x: x[0], reverse=True)
                    downloaded_file = candidates[0][1]
                    break

        if downloaded_file and not ExtensionActions.wait_for_export_idle(cdp_opt, max_wait=max_wait):
            print("❌ ZIP downloaded, but export UI/storage cleanup did not finish")
            return None
        return downloaded_file


class CDPActions(ExtensionActions):
    """
    Combined Actions Facade for Test Automation.
    Inherits all ExtensionActions (workbench, tour, options, export)
    and contains Gemini-specific web automation primitives.
    """
    @staticmethod
    def wait_for_gemini_ready(cdp, max_wait: int = 30) -> bool:
        """等待 Gemini 页面输入框及核心 DOM 就绪"""
        start = time.time()
        while time.time() - start < max_wait:
            ready = cdp.eval(f"""
            (() => {{
                const editor = document.querySelector('{GeminiSelectors.EDITOR}');
                return !!(editor && document.body);
            }})()
            """)
            if ready:
                return True
            time.sleep(0.5)
        return False

    @staticmethod
    def get_current_chat_id(cdp) -> Optional[str]:
        """从当前页面 URL 或 DOM 提取正在进行的对话 ID"""
        raw_id = cdp.eval(f"""
        (() => {{
            // 1. 从 URL pathname 提取
            const path = window.location.pathname || "";
            const parts = path.split("/app/");
            if (parts.length > 1) {{
                const cid = parts[1].split("?")[0].trim();
                if (cid && cid.length >= 8) return cid;
            }}
            // 2. 从 DOM 显式属性提取
            const el = document.querySelector('[data-conversation-id], [data-chat-id]');
            if (el) {{
                const attrId = el.getAttribute('data-conversation-id') || el.getAttribute('data-chat-id');
                if (attrId && attrId.length >= 8) return attrId.trim();
            }}
            // 4. 若页面上已存在对话气泡，则侧边栏首项即为当次会话
            const hasBubbles = document.querySelectorAll('{GeminiSelectors.USER_QUERY}, {GeminiSelectors.MODEL_RESPONSE}').length > 0;
            if (hasBubbles) {{
                const activeA = document.querySelector('{GeminiSelectors.NAV_ITEM_ACTIVE}');
                if (activeA) {{
                    const ap = (activeA.getAttribute('href') || '').split('/app/');
                    if (ap.length > 1 && ap[1].length >= 8) return ap[1].split('?')[0].trim();
                }}
                const firstA = document.querySelector('{GeminiSelectors.NAV_ITEM} a[href^="/app/"], nav a[href^="/app/"], a[href^="/app/"]');
                if (firstA) {{
                    const fp = (firstA.getAttribute('href') || '').split('/app/');
                    if (fp.length > 1 && fp[1].length >= 8) return fp[1].split('?')[0].trim();
                }}
            }}
            return null;
        }})()
        """)
        return str(raw_id).strip() if raw_id else None


    @staticmethod
    def get_current_chat_title(cdp) -> Optional[str]:
        """从当前 Gemini 页面提取权威对话标题"""
        title = cdp.eval(f"""
        (() => {{
            const explicit = document.querySelector('{GeminiSelectors.CONVERSATION_TITLE}');
            if (explicit && explicit.textContent.trim()) return explicit.textContent.trim();
            const heading = document.querySelector('h1');
            if (heading && heading.textContent.trim() && !heading.textContent.includes('Gemini')) return heading.textContent.trim();
            const docTitle = document.title || "";
            const cleaned = docTitle.replace(/ - Gemini$| - Google Gemini$|^Gemini - /i, '').trim();
            if (cleaned && cleaned !== 'Gemini') return cleaned;
            return null;
        }})()
        """)
        return str(title).strip() if title else None

    @staticmethod
    def ensure_model_and_thinking(cdp, target_model: str = "3.8 Flash", target_thinking: bool = True, force_menu_check: bool = False) -> bool:
        """严格校验并锁定 Gemini 模型与思考模式 (委托至 GeminiPlatformDriver 权威实现)"""
        from scripts.framework.driver.gemini_driver import GeminiPlatformDriver
        driver = GeminiPlatformDriver(cdp)
        return driver.ensure_model(
            target_model=target_model,
            target_thinking=target_thinking,
            force_menu_check=force_menu_check
        )

    @staticmethod
    def send_gemini_turn(cdp, turn_input: Any, max_wait: int = 300) -> Tuple[bool, str]:
        """向 Gemini 聚焦输入框、粘贴 Prompt、单次物理点击并以单飞串行流水线权威等待流式生成落地 (受网关监控)"""
        if isinstance(turn_input, dict):
            prompt_text = turn_input.get("prompt", "")
        else:
            prompt_text = str(turn_input)

        from scripts.framework.driver.gemini_driver import GeminiPlatformDriver
        driver = GeminiPlatformDriver(cdp)
        return driver.execute_turn_pipeline(prompt_text, max_wait=max_wait)

    @staticmethod
    def upload_gemini_file(cdp, file_path: str, timeout: float = 15.0) -> bool:
        """向当前 Gemini 输入框上传本地文件附件 (委托至 GeminiPlatformDriver 权威实现)"""
        from scripts.framework.driver.gemini_driver import GeminiPlatformDriver
        driver = GeminiPlatformDriver(cdp)
        return driver.upload_file(file_path=file_path, timeout=timeout)

    @staticmethod
    def click_new_chat(cdp) -> bool:
        """开启新对话 (优先通过安全网关导航至 /app，保障物理清空残留气泡)"""
        try:
            if get_gateway().safe_navigate(cdp, "https://gemini.google.com/app"):
                time.sleep(2.0)
                return True
        except Exception:
            pass
        res = cdp.eval(f"""
        (() => {{
            const newBtn = document.querySelector('{GeminiSelectors.NEW_CHAT_BTN}');
            if (newBtn) {{
                newBtn.click();
                return true;
            }}
            window.location.href = 'https://gemini.google.com/app';
            return true;
        }})()
        """)
        time.sleep(2.0)
        return bool(res)


    @staticmethod
    def delete_conversation_via_web(cdp_gemini, chat_id: str) -> bool:
        """在 Gemini 网页端侧边栏执行真实会话删除链路"""
        # 0. 确保侧边栏处于展开状态 (若处于折叠状态则主动点击展开按钮)
        cdp_gemini.eval(f"""
        (() => {{
            const openBtn = document.querySelector('{GeminiSelectors.OPEN_SIDEBAR_BTN}');
            if (openBtn) {{
                openBtn.click();
                return true;
            }}
            return false;
        }})()
        """)
        time.sleep(0.6)

        nav_sel = GeminiSelectors.nav_item_by_chat_id(chat_id)
        # 触发悬停使三点菜单显示
        rect = cdp_gemini.eval(f"""
        (() => {{
            const a = document.querySelector('{nav_sel}');
            if (!a) return null;
            const item = a.closest('{GeminiSelectors.NAV_ITEM}') || a.parentElement;
            item.dispatchEvent(new MouseEvent('mouseenter', {{ bubbles: true }}));
            item.dispatchEvent(new MouseEvent('mouseover', {{ bubbles: true }}));
            const r = item.getBoundingClientRect();
            return {{ x: r.left + r.width / 2, y: r.top + r.height / 2 }};
        }})()
        """)
        if rect:
            try:
                cdp_gemini.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": rect["x"], "y": rect["y"]})
            except Exception:
                pass
            time.sleep(0.3)

        click_opts = cdp_gemini.eval(f"""
        (() => {{
            const a = document.querySelector('{nav_sel}');
            if (!a) return 'link_not_found';
            const item = a.closest('{GeminiSelectors.NAV_ITEM}') || a.parentElement;
            let btn = item.querySelector('{GeminiSelectors.MORE_OPTIONS_BTN}');
            if (!btn) {{
                const allBtns = Array.from(item.querySelectorAll('button'));
                btn = allBtns.find(b => {{
                    const l = (b.getAttribute('aria-label') || '').toLowerCase();
                    return l.includes('more') || l.includes('option') || l.includes('更多');
                }});
            }}
            if (!btn) return 'btn_not_found';
            btn.click();
            return 'options_clicked';
        }})()
        """)
        if click_opts != 'options_clicked':
            return False
        time.sleep(0.6)

        del_click = cdp_gemini.eval(f"""
        (() => {{
            const delBtn = document.querySelector('{GeminiSelectors.DELETE_ITEM_BTN}');
            if (delBtn) {{
                delBtn.click();
                return true;
            }}
            const items = Array.from(document.querySelectorAll('[role="menuitem"], button'));
            const match = items.find(b => {{
                const t = b.textContent.trim().toLowerCase();
                return t.includes('delete') || t.includes('删除');
            }});
            if (match) {{
                match.click();
                return true;
            }}
            return false;
        }})()
        """)
        if not del_click:
            return False
        time.sleep(0.8)

        confirm_click = cdp_gemini.eval(f"""
        (() => {{
            const dialog = document.querySelector('{GeminiSelectors.DIALOG}');
            if (!dialog) return false;
            const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(b => {{
                const txt = b.innerText.trim().toLowerCase();
                return txt === 'delete' || txt === '删除';
            }});
            if (confirmBtn) {{
                confirmBtn.click();
                return true;
            }}
            return false;
        }})()
        """)
        time.sleep(2.0)
        return bool(confirm_click)

    @staticmethod
    def setup_live_save(cdp_opt, enabled: bool = True) -> bool:
        """Configure a real OPFS handle through public v2 Storage/Settings owners."""
        install_probe(cdp_opt)
        res = cdp_opt.eval(f"""(async () => {{
            const api = globalThis.__tier2V2;
            if ({json.dumps(enabled)}) {{
                const root = await navigator.storage.getDirectory();
                const dir = await root.getDirectoryHandle('gemini_export', {{create:true}});
                await api.setDirectoryHandle(dir);
                await api.updateSettings({{enabledDisk:true, defaultFormat:'markdown',includeAssets:true}});
            }} else await api.updateSettings({{enabledDisk:false}});
            const settings = await api.getSettings();
            return settings.enabledDisk === {json.dumps(enabled)};
        }})()""", await_promise=True)
        return res is True

    @staticmethod
    def flush_live_save_to_disk(cdp_opt, target_disk_dir: str) -> Dict[str, Any]:
        """
        从 OPFS 遍历 gemini_export 目录下的所有 Markdown 文件与 assets/ 图片，
        并将其物理回写到 target_disk_dir/gemini_export/ 目录中，确保磁盘存在物理落地实体。
        返回写入的文件统计清单。
        """
        res = cdp_opt.eval("""
        (async () => {
            try {
                const root = await navigator.storage.getDirectory();
                let exportDir;
                try {
                    exportDir = await root.getDirectoryHandle('gemini_export');
                } catch {
                    return { ok: true, files: [] };
                }

                const files = [];
                const visit = async (directory, prefix = '') => {
                    for await (const [name, handle] of directory.entries()) {
                        const path = prefix + name;
                        if (handle.kind === 'directory') { await visit(handle, path + '/'); continue; }
                        const file = await handle.getFile();
                        if (name.endsWith('.md')) files.push({path,text:await file.text(),isBinary:false,mtime:file.lastModified});
                        else {
                            const bytes = new Uint8Array(await file.arrayBuffer());
                            let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
                            files.push({path,base64:btoa(binary),isBinary:true,mtime:file.lastModified});
                        }
                    }
                };
                await visit(exportDir);
                return { ok: true, files };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        })()
        """, await_promise=True) or {}

        if not res.get("ok"):
            return {"ok": False, "error": res.get("error"), "files": []}

        files = res.get("files", [])
        sub_export = os.path.join(target_disk_dir, "gemini_export")
        os.makedirs(sub_export, exist_ok=True)

        written_paths = []
        for item in files:
            fpath = os.path.join(sub_export, item["path"])
            os.makedirs(os.path.dirname(fpath), exist_ok=True)
            if item.get("isBinary"):
                import base64
                data = base64.b64decode(item["base64"])
                with open(fpath, "wb") as f:
                    f.write(data)
            else:
                with open(fpath, "w", encoding="utf-8") as f:
                    f.write(item["text"])
            if isinstance(item.get('mtime'), (int, float)):
                os.utime(fpath, (item['mtime'] / 1000, item['mtime'] / 1000))
            written_paths.append(fpath)

        return {"ok": True, "count": len(written_paths), "files": written_paths}
