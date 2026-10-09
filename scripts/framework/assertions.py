# scripts/framework/assertions.py
"""
Declarative Assertion Primitives for Gemini Exporter Test Automation.
Verifies CDP DOM states, storage invariants, disk file structure, 0-byte guards, and specification rules.
"""

import os
import re
import json
import zipfile
import time
import hashlib
import html
import unicodedata
from pathlib import Path
from typing import Tuple, Optional, Dict, Any, List

import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))
try:
    from tests.helpers.export_spec_asserter import ExportSpecificationAsserter
except ImportError:
    ExportSpecificationAsserter = None

from scripts.framework.selectors import GeminiSelectors, WorkbenchSelectors
from scripts.framework.archive_resources import validate_archive_resources, resource_references, find_archive_resource


def normalized_text(text: str) -> str:
    """Compare prose/code across DOM and Markdown without formatting/space noise."""
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    text = re.sub(r'\\([\\`*_{}\[\]()#+.!|>-])', r'\1', text)
    return ''.join(c for c in unicodedata.normalize('NFKC', html.unescape(text)) if c.isalnum())


def markdown_messages(text: str) -> List[Dict[str, str]]:
    # Ignore headings inside fenced code, which can contain literal role examples.
    messages = []
    fence = None
    for line in text.splitlines(keepends=True):
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            token = marker.group(1)
            if fence is None:
                fence = token
            elif token[0] == fence[0] and len(token) >= len(fence):
                fence = None
        role = re.match(r'^## (?:👤 (You|用户)|🤖 (Assistant|助手))\s*$', line) if fence is None else None
        if role:
            messages.append({'role': 'user' if role.group(1) else 'model', 'content': ''})
        elif messages:
            messages[-1]['content'] += line
    return messages


def assert_turn_content(text: str, evidence: List[Dict[str, Any]]) -> Tuple[bool, str]:
    """Check the exact ordered roles, including the last actual model response."""
    messages = markdown_messages(text)
    if not evidence or len(messages) != 2 * len(evidence):
        return False, f"轮次不完整: 实际消息={len(messages)}, 预期={2 * len(evidence)}"
    for idx, turn in enumerate(evidence):
        user, model = messages[2 * idx:2 * idx + 2]
        if (user['role'], model['role']) != ('user', 'model'):
            return False, f"第 {idx + 1} 轮角色次序错误"
        prompt = normalized_text(turn.get('prompt', ''))
        if not prompt or prompt not in normalized_text(user['content']):
            return False, f"第 {idx + 1} 轮真实用户 Prompt 缺失"
        response = normalized_text(turn.get('response', ''))
        actual = normalized_text(model['content'])
        if len(response) >= 24:
            # Two substantial fragments, or the whole short answer. Only search
            # this model turn; a matching user prompt/older response cannot pass.
            width = min(64, len(response))
            anchors = list(dict.fromkeys(response[i:i + width] for i in range(0, len(response) - width + 1, width)))
            found = sum(anchor in actual for anchor in anchors)
            if found < min(2, len(anchors)):
                return False, f"第 {idx + 1} 轮真实 AI 回复实质片段缺失 ({found}/{min(2, len(anchors))})"
        elif response:
            # A legitimately concise answer has no long fragment. Compare its
            # entire body instead of rejecting a model asked for one sentence.
            if not turn.get('has_images') and response != actual:
                return False, f"第 {idx + 1} 轮简短 AI 回复不完整或不匹配"
            if turn.get('has_images') and response not in actual:
                return False, f"第 {idx + 1} 轮图片说明缺失"
        elif not turn.get('has_images'):
            return False, f"第 {idx + 1} 轮缺少实际回复文本或图片证据"
        if turn.get('has_images') and not re.search(r'!\[[^\]]*\]\([^)]+\)', model['content']):
            return False, f"第 {idx + 1} 轮模型图片引用缺失"
    return True, f"完整 {len(evidence)} 轮真实提问/回复按角色匹配"


def assert_archive_targets(names: List[str], target_ids: List[str], extension: str,
                           excluded_ids: Optional[List[str]] = None) -> Tuple[bool, str]:
    entries = [n for n in names if n.endswith(extension) and not os.path.basename(n).startswith('.')]
    missing = [cid for cid in target_ids if not any(os.path.basename(n).endswith(f"_{cid.removeprefix('c_')[-6:]}{extension}") for n in entries)]
    forbidden = [cid for cid in (excluded_ids or []) if any(os.path.basename(n).endswith(f"_{cid.removeprefix('c_')[-6:]}{extension}") for n in entries)]
    if not target_ids or missing or forbidden:
        return False, f"ZIP 目标覆盖错误: 缺失={missing}, 禁止出现={forbidden}"
    if excluded_ids is not None and len(entries) != len(target_ids):
        return False, f"部分跳过 ZIP 含额外会话: 实际={len(entries)}, 预期={len(target_ids)}"
    return True, f"ZIP 指定目标 {len(target_ids)} 个均存在"


def assert_scan_result(evidence: Dict[str, Any]) -> Tuple[bool, str]:
    response = evidence.get('response') or {}
    diag = response.get('diagnostics') or {}
    if not evidence.get('started') or not evidence.get('finished') or evidence.get('error'):
        return False, f"扫描未启动/未完成/失败: {evidence}"
    if response.get('success') is not True or response.get('error'):
        return False, f"扫描返回失败: {response}"
    reason = diag.get('stopReason', '')
    # Existing producer explicitly distinguishes natural exhaustion from limits,
    # token loops, cancellation, parse errors, and network errors in diagnostics.
    natural = 'Google 服务端已无更早历史' in reason or 'Google 服务端游标已到底' in reason
    history = diag.get('pageHistory') or []
    if (not natural or diag.get('incremental') is not False or not diag.get('endTime')
            or not history or diag.get('totalPagesFetched', 0) < 1
            or diag.get('hitGoogleLimit') or response.get('hitGoogleLimit')):
        return False, f"全量扫描缺少完整耗尽证据（可能部分完成/限流）: {diag}"
    return True, f"全量扫描自然耗尽: {diag.get('totalPagesFetched')} 页, {diag.get('totalConversations')} 会话"


class CDPAssertions:
    @staticmethod
    def assert_pdf_math_compiled(text: str) -> Tuple[bool, str]:
        """Detect the renderer's fallback label, not ordinary LaTeX prose.

        Typst always emits mathFallback before preserved raw source. Whitespace
        can vary when text is extracted across glyphs, lines, and page breaks.
        """
        match = re.search(
            r"Could\s*not\s*typeset\s*this\s*formula|"
            r"\u65e0\s*\u6cd5\s*\u6392\s*\u7248\s*\u8be5\s*\u516c\s*\u5f0f",
            text,
        )
        if match:
            return False, text[max(0, match.start() - 80):match.end() + 300]
        return True, ""

    @staticmethod
    def assert_stream_completed(cdp_gemini, min_turns: int = 1) -> Tuple[bool, str, Dict[str, Any]]:
        """断言 Gemini 页面流式回复已彻底完成且 DOM 稳定"""
        state = cdp_gemini.eval(f"""
        (() => {{
            const userQueries = document.querySelectorAll('{GeminiSelectors.USER_QUERY_ALL}');
            const modelResponses = document.querySelectorAll('{GeminiSelectors.MODEL_RESPONSE_ALL}');
            const isStreaming = !!document.querySelector('{GeminiSelectors.STREAMING_INDICATORS}');
            const lastResp = modelResponses.length > 0 ? modelResponses[modelResponses.length - 1] : null;
            const textLen = lastResp ? (lastResp.textContent || '').length : 0;
            const hasImages = lastResp ? !!lastResp.querySelector('{GeminiSelectors.IMAGES}') : false;
            return {{
                userCount: userQueries.length,
                modelCount: modelResponses.length,
                isStreaming: isStreaming,
                lastTextLength: textLen,
                hasImages: hasImages
            }};
        }})()
        """) or {}

        user_count = state.get("userCount", 0)
        model_count = state.get("modelCount", 0)
        is_streaming = state.get("isStreaming", True)
        last_len = state.get("lastTextLength", 0)

        if user_count < min_turns:
            return False, f"提问轮次不足: 当前 {user_count} < 预期 {min_turns}", state
        if model_count < user_count:
            return False, f"模型回复数量不足: 模型 {model_count} < 提问 {user_count}", state
        if is_streaming:
            return False, "页面仍处于流式生成状态 (streaming flag active)", state
        if last_len == 0 and not state.get("hasImages"):
            return False, "末尾模型回复内容为空 (0 字符且无图片实体)", state

        return True, f"流式完成已断言 (轮次: {user_count}, 字符数: {last_len}, 包含图片: {state.get('hasImages')})", state

    @staticmethod
    def assert_realtime_order(cdp_opt, promoted_chat_id: str, older_chat_id: str) -> Tuple[bool, str, Dict[str, Any]]:
        """断言老会话追加提问后在 Options 列表中已实时置顶于对比会话之前"""
        order_info = cdp_opt.eval(f"""
        (() => {{
            return new Promise((resolve) => {{
                chrome.storage.local.get(['gemini_conversations'], (data) => {{
                    const convs = data.gemini_conversations || [];
                    const c1 = convs.find(c => c.id === '{promoted_chat_id}' || c.id === 'c_{promoted_chat_id}');
                    const c2 = convs.find(c => c.id === '{older_chat_id}' || c.id === 'c_{older_chat_id}');
                    const domItems = Array.from(document.querySelectorAll('{WorkbenchSelectors.ITEM}'));
                    const el1 = domItems.find(el => el.dataset.chatId === '{promoted_chat_id}' || el.dataset.chatId === 'c_{promoted_chat_id}');
                    const el2 = domItems.find(el => el.dataset.chatId === '{older_chat_id}' || el.dataset.chatId === 'c_{older_chat_id}');
                    const idx1 = domItems.indexOf(el1);
                    const idx2 = domItems.indexOf(el2);

                    resolve({{
                        ts1: c1 ? (c1.updatedAt || c1.timestamp || 0) : 0,
                        ts2: c2 ? (c2.updatedAt || c2.timestamp || 0) : 0,
                        idx1: idx1,
                        idx2: idx2,
                        totalDom: domItems.length,
                        el1Found: !!el1,
                        el2Found: !!el2
                    }});
                }});
            }});
        }})()
        """, await_promise=True) or {}

        idx1 = order_info.get("idx1", -1)
        idx2 = order_info.get("idx2", -1)
        ts1 = order_info.get("ts1", 0)
        ts2 = order_info.get("ts2", 0)

        if idx1 == -1 or idx2 == -1:
            return False, f"未在 DOM 列表中找到两会话节点 (idx1={idx1}, idx2={idx2})", order_info

        if idx1 > idx2:
            return False, f"实时置顶顺序违背: 被置顶会话索引 {idx1} > 对比会话索引 {idx2}", order_info

        if ts1 < ts2:
            return False, f"时间戳更新异常: 置顶会话时间戳 {ts1} < 对比会话时间戳 {ts2}", order_info

        return True, f"实时置顶顺序正确 (置顶会话 #{idx1} 排在 #{idx2} 之前, ts1={ts1} >= ts2={ts2})", order_info

    @staticmethod
    def assert_badge_status(cdp_opt, chat_id: str, expected_type: str = "updated", timeout: float = 6.0) -> Tuple[bool, str, Dict[str, Any]]:
        """断言指定会话卡片的徽章类型 (updated / exported) 及自动勾选状态 (带确定性异步轮询)"""
        item_sel = WorkbenchSelectors.item_by_chat_id(chat_id)
        start_time = time.time()
        badge_info: Dict[str, Any] = {}

        while time.time() - start_time < timeout:
            badge_info = cdp_opt.eval(f"""
            (() => {{
                const el = document.querySelector('{item_sel}');
                if (!el) return {{ found: false }};
                const bUpdated = el.querySelector('{WorkbenchSelectors.BADGE_UPDATED}');
                const bExported = el.querySelector('{WorkbenchSelectors.BADGE_EXPORTED}');
                const cb = el.querySelector('{WorkbenchSelectors.CHECKBOX}');
                return {{
                    found: true,
                    hasUpdated: !!bUpdated,
                    updatedText: bUpdated ? bUpdated.textContent.trim() : '',
                    hasExported: !!bExported,
                    exportedText: bExported ? bExported.textContent.trim() : '',
                    checked: cb ? cb.checked : false
                }};
            }})()
            """) or {}

            if badge_info.get("found"):
                if expected_type == "updated" and badge_info.get("hasUpdated") and badge_info.get("checked"):
                    return True, f"「已更新」徽章渲染正常且已被自动勾选 ({badge_info.get('updatedText')})", badge_info
                elif expected_type == "exported" and badge_info.get("hasExported"):
                    return True, f"「已导出」徽章渲染正常 ({badge_info.get('exportedText')})", badge_info

            time.sleep(0.5)
            # 若尚未就绪，尝试触发一次 Options 列表视图同步重载
            try:
                cdp_opt.eval("if (window.__workbenchLoadStore) window.__workbenchLoadStore(null, true);")
            except Exception:
                pass

        if not badge_info.get("found"):
            return False, f"未找到会话 ID 为 {chat_id} 的 DOM 节点", badge_info

        if expected_type == "updated":
            if not badge_info.get("hasUpdated"):
                return False, f"缺少「已更新」徽章 (.badge-updated)", badge_info
            if not badge_info.get("checked"):
                return False, f"「已更新」会话未被智能自动勾选", badge_info
            return True, f"「已更新」徽章渲染正常且已被自动勾选 ({badge_info.get('updatedText')})", badge_info
        elif expected_type == "exported":
            if not badge_info.get("hasExported"):
                return False, f"缺少「已导出」徽章 (.badge-exported)", badge_info
            return True, f"「已导出」徽章渲染正常 ({badge_info.get('exportedText')})", badge_info
        else:
            return True, "徽章状态检查通过", badge_info

    @staticmethod
    def assert_dom_pruned(cdp_opt, deleted_chat_id: str, timeout: float = 5.0) -> Tuple[bool, str, Dict[str, Any]]:
        """断言已删除的会话在 Storage 与 DOM 列表中均已被彻底剥离 (动态轮询等待保证异步确定性)"""
        t_start = time.time()
        last_check: Dict[str, Any] = {}
        clean_id = str(deleted_chat_id).replace('c_', '')
        pruned_sel = WorkbenchSelectors.item_by_chat_id(deleted_chat_id)

        while time.time() - t_start < timeout:
            check = cdp_opt.eval(f"""
            (() => {{
                return new Promise((resolve) => {{
                    chrome.storage.local.get(['gemini_conversations'], (data) => {{
                        const convs = data.gemini_conversations || [];
                        const inStorage = convs.some(c => c.id === '{deleted_chat_id}' || c.id === 'c_{clean_id}' || c.id === '{clean_id}');
                        const inDom = !!document.querySelector('{pruned_sel}');
                        resolve({{
                            inStorage: inStorage,
                            inDom: inDom,
                            totalConvs: convs.length
                        }});
                    }});
                }});
            }})()
            """, await_promise=True) or {}
            last_check = check

            if not check.get("inStorage", True) and not check.get("inDom", True):
                return True, f"会话已成功剥离 DOM 与本地 Storage (剩余有效会话数: {check.get('totalConvs')})", check

            time.sleep(0.3)

        in_storage = last_check.get("inStorage", True)
        in_dom = last_check.get("inDom", True)
        return False, f"会话在 {timeout}s 内未完全剥离: Storage残留={in_storage}, DOM残留={in_dom}", last_check

    @staticmethod
    def assert_title_upgraded(cdp_opt, check_ids: List[str]) -> Tuple[bool, str, Dict[str, Any]]:
        """断言 Takeout 导入的会话标题在全量拉取历史后被在线 RPC 权威晋级"""
        status = cdp_opt.eval(f"""
        (() => {{
            return new Promise((resolve) => {{
                chrome.storage.local.get(['gemini_conversations'], (data) => {{
                    const convs = data.gemini_conversations || [];
                    const checkList = {json.dumps(check_ids)};
                    const matched = convs.filter(c => checkList.some(cid => c.id === cid || c.id === 'c_' + cid));
                    resolve({{
                        total: convs.length,
                        matched: matched.map(c => ({{
                            id: c.id,
                            title: c.title,
                            source: c.titleSource,
                            titles: c.titles || {{}}
                        }}))
                    }});
                }});
            }});
        }})()
        """, await_promise=True) or {}

        matched = status.get("matched", [])
        missing = [cid for cid in check_ids if not any(m.get('id', '').removeprefix('c_') == cid.removeprefix('c_') for m in matched)]
        if not check_ids or missing:
            return False, f"预期需要 RPC 晋级的会话缺失: {missing}", status
        if not matched:
            return False, "未找到任何匹配的 Takeout 导入会话", status

        upgraded_count = 0
        for m in matched:
            titles = m.get("titles", {})
            source = m.get("source", "")
            has_takeout = "takeout" in titles
            is_rpc = source == "rpc" and bool(titles.get("rpc")) and m.get("title") == titles.get("rpc")
            if has_takeout and is_rpc:
                upgraded_count += 1

        if upgraded_count != len(check_ids):
            return False, f"预期 RPC 晋级未全部完成: {upgraded_count}/{len(check_ids)} (sources: {[m.get('source') for m in matched]})", status

        return True, f"Takeout 临时标题成功升级为 RPC 权威标题 (升级数: {upgraded_count}/{len(matched)})", status

    @staticmethod
    def assert_search_filter(cdp_opt, query: str, expected_visible_min: int = 1, expected_visible_max: Optional[int] = None, timeout: float = 3.0) -> Tuple[bool, str, Dict[str, Any]]:
        """断言搜索过滤后工作台列表可见项数量在预期区间内（带轮询等待渲染稳定）"""
        start = time.time()
        last_vis_info = {}
        last_msg = ""

        while time.time() - start < timeout:
            vis_info = cdp_opt.eval(f"""
            (() => {{
                const input = document.querySelector('{WorkbenchSelectors.SEARCH_INPUT}');
                const items = Array.from(document.querySelectorAll('{WorkbenchSelectors.ITEM}'));
                const visible = items.filter(el => el.style.display !== 'none');
                const store = typeof ConversationsStore !== 'undefined' ? ConversationsStore : (window.ConversationsStore || null);
                const defaultStore = typeof DefaultConversationsStore !== 'undefined' ? DefaultConversationsStore : (window.DefaultConversationsStore || null);
                const s = store || defaultStore;
                const totalStore = s ? s.getConversations().length : items.length;
                return {{
                    query: input ? input.value : '',
                    totalCount: totalStore,
                    visibleCount: visible.length,
                    firstVisibleId: visible.length > 0 ? visible[0].dataset.chatId : null,
                    firstVisibleTitle: visible.length > 0 ? (visible[0].querySelector('{WorkbenchSelectors.ITEM_TITLE}')?.textContent || '') : ''
                }};
            }})()
            """) or {}

            total = vis_info.get("totalCount", 0)
            vis = vis_info.get("visibleCount", 0)
            last_vis_info = vis_info

            if vis < expected_visible_min:
                last_msg = f"搜索过滤后可见项不足: {vis} < 预期最小 {expected_visible_min} (Query: '{query}')"
            elif expected_visible_max is not None and vis > expected_visible_max:
                last_msg = f"搜索过滤后可见项超出: {vis} > 预期最大 {expected_visible_max} (Query: '{query}')"
            elif total > 1 and vis >= total:
                last_msg = f"搜索过滤未生效: 总数 {total} 与 可见数 {vis} 相同，未发生过滤收缩 (Query: '{query}')"
            else:
                return True, f"搜索过滤断言通过 (Query: '{query}', 可见: {vis}/{total}, 首项: {vis_info.get('firstVisibleTitle')[:20]})", vis_info

            time.sleep(0.05)

        return False, last_msg, last_vis_info

    @staticmethod
    def assert_real_disk_live_save(
        target_dir: Optional[str] = None,
        target_chat_ids: Optional[List[str]] = None,
        min_mtime: Optional[float] = None,
        turn_evidence: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        baselines: Optional[Dict[str, str]] = None
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        断言真实磁盘的自动实时导出目录。
        必须指定明确的 target_dir 目录，严禁随意读取未授权的历史静态旧目录。
        若指定了 target_chat_ids，必须验证当次会话对应的 .md 文件真实存在、体积 > 0 且 mtime >= min_mtime。
        """
        if not target_dir or not os.path.isdir(target_dir):
            return False, f"未指定或未找到有效的实时落盘目录 (target_dir: {target_dir})", {}

        # 检查 target_dir 或其下的 gemini_export 子目录
        check_dir = target_dir
        sub_export = os.path.join(target_dir, "gemini_export")
        if os.path.isdir(sub_export):
            check_dir = sub_export

        zero_byte_files = []
        valid_md_files = []
        valid_img_files = []
        img_exts = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg")

        for root, _, files in os.walk(check_dir):
            for fname in files:
                fpath = os.path.join(root, fname)
                try:
                    fsize = os.path.getsize(fpath)
                    fmtime = os.path.getmtime(fpath)
                except OSError:
                    continue

                if fsize == 0:
                    zero_byte_files.append((fname, fpath))

                if fname.endswith(".md"):
                    if fsize > 0:
                        valid_md_files.append((fname, fsize, fmtime, fpath))
                elif fname.lower().endswith(img_exts):
                    if fsize > 0:
                        valid_img_files.append((fname, fsize, fmtime, fpath))

        summary = {
            "export_dir": check_dir,
            "total_md_valid": len(valid_md_files),
            "total_img_valid": len(valid_img_files),
            "zero_byte_files": [f[0] for f in zero_byte_files],
            "zero_byte_paths": [f[1] for f in zero_byte_files]
        }

        if zero_byte_files:
            return False, f"发现 {len(zero_byte_files)} 个 0 字节非法落盘文件！严重违背落盘完备性规范: {[f[0] for f in zero_byte_files]}", summary

        if len(valid_md_files) == 0:
            return False, f"落盘目录 {check_dir} 中未找到任何有效 .md 对话文件", summary

        # 若指定了目标会话 ID，执行严格的 ID 匹配与修改时间门禁核验
        if target_chat_ids:
            missing_ids = []
            stale_files = []
            matched_targets = []
            for cid in target_chat_ids:
                if not cid:
                    continue
                clean_cid = str(cid).removeprefix("c_")
                short_cid = clean_cid[-6:]
                matched = [
                    f for f in valid_md_files 
                    if f[0].endswith(f"_{short_cid}.md") or clean_cid in f[0]
                ]
                if not matched:
                    missing_ids.append(cid)
                else:
                    if len(matched) != 1:
                        return False, f"会话 {cid} 对应多个 MD，身份不唯一", summary
                    for mf in matched:
                        if min_mtime and mf[2] < (min_mtime - 5.0):
                            stale_files.append((mf[0], mf[2], min_mtime))
                        else:
                            matched_targets.append(mf[0])
                        text = Path(mf[3]).read_text(encoding='utf-8')
                        identity = re.search(r'^id:\s*["\']?([^"\'\s]+)', text, re.MULTILINE)
                        if not identity or identity.group(1).removeprefix('c_') != clean_cid:
                            return False, f"文件 {mf[0]} 的完整会话 ID 不匹配 {cid}", summary
                        if turn_evidence is not None:
                            ok, msg = assert_turn_content(text, turn_evidence.get(cid, []))
                            if not ok:
                                return False, f"{cid}: {msg}", summary
                        resource_errors = validate_archive_resources(check_dir, os.path.relpath(mf[3], check_dir), text)
                        if resource_errors:
                            return False, f"{cid} 资源引用无效: {resource_errors}", summary
                        for turn, message in zip((turn_evidence or {}).get(cid, []), markdown_messages(text)[1::2]):
                            if turn.get('has_images'):
                                refs = resource_references(message['content'])
                                entities = [find_archive_resource(check_dir, os.path.relpath(mf[3], check_dir), ref) for ref in refs]
                                if not any(entities):
                                    return False, f"{cid} 图片回复没有有效的归档实体", summary
                        before = (baselines or {}).get(cid)
                        if before is not None:
                            old_messages, new_messages = markdown_messages(before), markdown_messages(text)
                            if hashlib.sha256(before.encode()).digest() == hashlib.sha256(text.encode()).digest() or len(new_messages) <= len(old_messages):
                                return False, f"{cid} 内容未增量更新，仍为旧文件", summary
                            for old, new in zip(old_messages, new_messages):
                                if old['role'] != new['role'] or normalized_text(old['content']) != normalized_text(new['content']):
                                    return False, f"{cid} 追加后原有轮次内容被改变或丢失", summary
                        summary.setdefault('documents', {})[cid] = {'path': mf[3], 'text': text, 'sha256': hashlib.sha256(text.encode()).hexdigest()}

            summary["matched_targets"] = matched_targets
            summary["missing_targets"] = missing_ids
            summary["stale_targets"] = stale_files

            if missing_ids:
                return False, f"当次生成的会话未在落盘目录中找到对应的物理文件: {missing_ids}", summary

            if stale_files:
                return False, f"落盘文件修改时间早于当次测试启动时间 (疑似读取旧缓存文件): {[s[0] for s in stale_files]}", summary

        return True, f"物理磁盘实时落盘断言通过 (目录: {os.path.basename(check_dir)}, 有效MD: {len(valid_md_files)}, 有效图片: {len(valid_img_files)}, 0字节文件: 0)", summary

    @staticmethod
    def assert_exported_zip_spec(
        zip_path: str,
        extract_dir: str,
        min_conversations: int = 1,
        expected_golden_chats: Optional[List[Dict[str, Any]]] = None,
        expected_scenarios: Optional[List[Dict[str, Any]]] = None,
        chat_id: Optional[str] = None,
        uploaded_files: Optional[List[Dict[str, Any]]] = None
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """解压 ZIP 归档包，核实 100% 对话轮次物理落盘，严禁 0 字节附件，并运行 ExportSpecificationAsserter 规范断言"""
        if not os.path.isfile(zip_path):
            return False, f"ZIP 文件不存在: {zip_path}", {}

        if os.path.getsize(zip_path) == 0:
            return False, f"导出的 ZIP 文件为 0 字节非法文件: {zip_path}", {}

        if os.path.exists(extract_dir):
            import shutil
            shutil.rmtree(extract_dir, ignore_errors=True)
        os.makedirs(extract_dir, exist_ok=True)
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(extract_dir)

        # 检查 0 字节文件
        zero_byte_files = []
        all_files = []
        for root, _, files in os.walk(extract_dir):
            for f in files:
                fp = os.path.join(root, f)
                all_files.append(fp)
                if os.path.getsize(fp) == 0:
                    zero_byte_files.append(f)

        if zero_byte_files:
            return False, f"导出的 ZIP 解压后发现 {len(zero_byte_files)} 个 0 字节文件: {zero_byte_files}", {"zero_byte": zero_byte_files}

        # 严禁出现 URL 畸变或长 URL 命名的附件文件 (files/*_https___... 或包含 URL 参数特征)
        malformed_files = [
            os.path.basename(f) for f in all_files 
            if "_https___" in f or "http___" in f or "download_c=" in f or "usercontent.google" in f
        ]
        if malformed_files:
            return False, f"导出的 ZIP 解压后发现因 URL 伪装文件名导致的严重畸变文件: {malformed_files}", {"malformed_files": malformed_files}

        # 校验文件名 cid6 统一命名
        all_mds = [
            f for f in all_files 
            if f.endswith(".md") 
            and not os.path.basename(f).startswith(("00_INDEX", "_index"))
            and not any(sub in os.path.relpath(f, extract_dir).split(os.sep) for sub in ("assets", "files", "images"))
        ]
        cid6_pat = re.compile(r"_[a-zA-Z0-9_-]{6}\.md$")
        invalid_naming = [os.path.basename(f) for f in all_mds if not cid6_pat.search(f)]
        if invalid_naming:
            return False, f"发现未遵循 _<cid6>.md 命名规范的文件: {invalid_naming}", {"invalid_naming": invalid_naming}

        # 校验现场会话轮次 100% 存在
        scenario_results = []
        if expected_scenarios:
            for idx, sc in enumerate(expected_scenarios, 1):
                raw_turns = sc.get("turns", [])
                turns_clean = [t.get("prompt", "") if isinstance(t, dict) else str(t) for t in raw_turns]
                best_file = None
                best_match_count = 0
                for mf in all_mds:
                    with open(mf, "r", encoding="utf-8", errors="ignore") as f:
                        txt = f.read()
                    matches = sum(1 for t in turns_clean if t and t[:14] in txt)
                    if matches > best_match_count:
                        best_match_count = matches
                        best_file = mf

                matched_file = best_file

                if not matched_file:
                    return False, f"场景 {idx} 《{sc.get('title')}》 未在解压文件中找到对应的对话 Markdown！", {}

                with open(matched_file, "r", encoding="utf-8", errors="ignore") as f:
                    file_text = f.read()

                missing_turns = []
                for t_idx, p_str in enumerate(turns_clean, 1):
                    if p_str[:14] not in file_text:
                        missing_turns.append((t_idx, p_str[:20]))

                if missing_turns:
                    return False, f"场景 {idx} 存在缺失轮次: {missing_turns}", {"scenario": sc.get("title"), "missing": missing_turns}
                scenario_results.append({"scenario": sc.get("title"), "turns_matched": len(turns_clean)})

        # 运行 ExportSpecificationAsserter
        if ExportSpecificationAsserter:
            asserter = ExportSpecificationAsserter(extract_dir)
            spec_ok = asserter.run_all_assertions(
                min_conversations=min_conversations,
                expected_golden_chats=expected_golden_chats,
                target_chat_id=chat_id,
                uploaded_files=uploaded_files
            )
            if not spec_ok:
                err_summary = f": {asserter.errors[0]}" if asserter.errors else ""
                return False, f"ExportSpecificationAsserter 规范断言失败 (错误数: {len(asserter.errors)}){err_summary}", {"errors": asserter.errors}

        target_info = f", 目标会话命中: {chat_id}" if chat_id else ""
        return True, f"导出 ZIP 规范断言 100% 通过 (对话数: {len(all_mds)}, 0字节文件: 0{target_info}, 场景全轮次命中: {len(scenario_results)})", {"md_count": len(all_mds)}
