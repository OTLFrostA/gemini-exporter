# scripts/framework/cases/takeout.py
import os
import time
import json
import re
import zipfile
import hashlib
import base64
from typing import Tuple, Optional, Dict, Any

from scripts.framework.cases.base import FeatureTestCase, TestContext
from scripts.framework.features import FeatureDomain
from scripts.framework.actions import CDPActions
from scripts.framework.assertions import CDPAssertions, assert_scan_result
from scripts.framework.archive_resources import resource_references, resolve_archive_reference


def validate_takeout_records(expected_ids, expected_media, records, generation_ids=None):
    """Read-path assertions also work for a legitimate addedCount=0 re-import."""
    if {r.get('id') for r in records} != set(expected_ids):
        return False, "Takeout 正常读取路径缺少预期会话"
    acquired = {}
    for record in records:
        domain, summary = record.get('domain') or {}, record.get('summary') or {}
        if (record.get('ok') is not True or domain.get('id') != record['id']
                or domain.get('providerId') != 'gemini' or not summary.get('titles', {}).get('takeout')):
            return False, f"Takeout 会话身份/临时标题未进入正常存储: {record['id']}"
        messages = domain.get('messages') or []
        asset_ids = {a.get('id') for a in domain.get('assets', [])}
        def has_content(value):
            if isinstance(value, list):
                return any(has_content(child) for child in value)
            if not isinstance(value, dict):
                return False
            if any(isinstance(value.get(key), str) and value[key].strip() for key in ('text', 'code', 'source')):
                return True
            if value.get('type') in ('image', 'file') and value.get('assetId') in asset_ids:
                return True
            return any(has_content(value.get(key)) for key in ('children', 'blocks', 'items', 'rows', 'cells', 'headerRows'))
        for role in ('user', 'assistant'):
            valid = any(m.get('role') == role and has_content(m.get('content')) for m in messages)
            if role == 'assistant' and record['id'] in (generation_ids or []):
                valid = valid or any(m.get('role') == role and m.get('generation', {}).get('mediaKind') == 'image'
                                    and m.get('generation', {}).get('outputCount', 0) > 0 for m in messages)
            if not valid:
                return False, f"Takeout 会话 {record['id']} 缺少有效 {role} 内容"
        for resource in record.get('resources', []):
            name = os.path.basename(resource.get('sourcePath') or '')
            if name in expected_media:
                try:
                    data = base64.b64decode(resource.get('bytes') or '', validate=True)
                except (ValueError, TypeError):
                    return False, f"Takeout 资源不可读: {name}"
                if not data or hashlib.sha256(data).hexdigest() != expected_media[name]:
                    return False, f"Takeout 资源实体缺失或字节不一致: {name}"
                acquired[name] = True
    missing = set(expected_media) - acquired.keys()
    if missing:
        return False, f"Takeout 预期资源未进入读取路径: {sorted(missing)}"
    return True, f"Takeout {len(expected_ids)} 会话与 {len(expected_media)} 资源真实可读（支持重复导入）"


class TakeoutZipImportCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_takeout_zip_import",
            domain=FeatureDomain.TAKEOUT,
            name="离线 Takeout ZIP 导入",
            description="导入预置纯净 Takeout ZIP，离线附件池建立，初始提问前缀临时标题生效",
            critical=True,
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        if not os.path.isfile(ctx.takeout_zip):
            return False, f"Takeout ZIP 样本文件不存在: {ctx.takeout_zip}", None

        cdp_opt = ctx.connect_options()
        try:
            with zipfile.ZipFile(ctx.takeout_zip) as zf:
                html_files = [n for n in zf.namelist() if n.endswith('MyActivity.html')]
                if not html_files:
                    return False, "Takeout 样本缺少 MyActivity.html", None
                html_text = '\n'.join(zf.read(n).decode('utf-8') for n in html_files)
                expected_ids = sorted(set(re.findall(r'https://gemini\.google\.com/(?:u/\d+/)?app/([a-zA-Z0-9_-]+)', html_text)))
                generation_ids = set()
                for block in html_text.split('<div class="outer-cell')[1:]:
                    if re.search(r'\d+\s*generated images?|\d+\s*张生成的图片', block, re.IGNORECASE):
                        generation_ids.update(re.findall(r'https://gemini\.google\.com/(?:u/\d+/)?app/([a-zA-Z0-9_-]+)', block))
                expected_media = {}
                for name in html_files:
                    for ref in resource_references(zf.read(name).decode('utf-8'), html=True):
                        entry = resolve_archive_reference(name, ref)
                        if entry and entry not in html_files:
                            if entry not in zf.namelist():
                                return False, f"Takeout 样本引用资源缺失: {entry}", None
                            expected_media[os.path.basename(entry)] = hashlib.sha256(zf.read(entry)).hexdigest()
                catalog_media = {n: hashlib.sha256(zf.read(n)).hexdigest() for n in zf.namelist()
                                 if n.lower().endswith(('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'))}
            if not expected_ids:
                return False, "Takeout 样本没有可断言的会话身份", None
            print(f"   📥 导入离线 ZIP 样本 ({os.path.basename(ctx.takeout_zip)})...")
            import_res = CDPActions.import_takeout_zip(cdp_opt, ctx.takeout_zip, media_paths=list(catalog_media))
            if not import_res.get('success'):
                return False, f"导入失败: {import_res.get('error')}", import_res
            if set(import_res.get('importedIds', [])) != set(expected_ids) or import_res.get('status') != 'ok':
                return False, "导入完成回调缺少预期会话或包含部分资源失败", import_res
            if import_res.get('mediaDigests', {}) != catalog_media:
                return False, "Takeout 资源索引读取字节与原始 ZIP 不一致", import_res
            stored = cdp_opt.eval(f"""
            (async () => {{
                const slot = window.ConversationsStore.getCurrentSlot() || 'u0';
                const summaries = (await chrome.storage.local.get(['gemini_conversations'])).gemini_conversations || [];
                const result = [];
                for (const id of {json.dumps(expected_ids)}) {{
                    const identity = {{ providerId: 'gemini', accountSlot: slot, conversationId: id }};
                    const record = await chrome.runtime.sendMessage({{ action: 'domainStorage', command: 'get', payload: {{ identity }} }});
                    const domain = record?.value?.conversation;
                    const resources = [];
                    for (const resource of record?.value?.resources || []) {{
                        const read = await chrome.runtime.sendMessage({{ action: 'domainStorage', command: 'resource', payload: {{ identity, assetId: resource.assetId }} }});
                        resources.push({{ sourcePath: resource.sourcePath, bytes: read?.ok ? read.value : null }});
                    }}
                    result.push({{ id, ok: record?.ok, domain,
                        summary: summaries.find(c => c.id === id || c.id === 'c_' + id), resources }});
                }}
                return result;
            }})()
            """, await_promise=True) or []
            ok, msg = validate_takeout_records(expected_ids, expected_media, stored, generation_ids)
            if not ok:
                return False, msg, {'import': import_res}
            ctx.shared_data['takeout_ids'] = expected_ids
            # These designated historical samples are known online fixtures. Pure
            # offline identities in a custom archive are not required to upgrade.
            from scripts.framework.cases.export import DESIGNATED_HISTORICAL_CHATS
            known_online = {h['id'] for h in DESIGNATED_HISTORICAL_CHATS if not h.get('optional')}
            ctx.shared_data['expected_title_upgrade_ids'] = sorted(set(expected_ids) & known_online)
            return True, f"{msg}; 资源索引 {len(catalog_media)} 图片 SHA256 一致", import_res
        finally:
            cdp_opt.close()


class DeepScanPaginationCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_deep_scan_pagination",
            domain=FeatureDomain.TAKEOUT,
            name="全量拉取历史分页同步",
            description="点击【全量拉取历史】按钮，分页拉取所有云端会话，进度条正常推进至 100%",
            critical=True,
            prerequisites=[]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            print("   🔄 触发【全量拉取历史】(btnDeepScan)...")
            evidence = CDPActions.trigger_deep_scan(cdp_opt, max_wait=330)
            scan_ok, message = assert_scan_result(evidence)
            if not scan_ok:
                return False, message, evidence
            # Verify results include the known freshly generated online sessions.
            ids = [r['chat_id'] for r in ctx.chat_records if r.get('chat_id')]
            if ids:
                known = cdp_opt.eval("""(async () => {
                    const data = await chrome.storage.local.get(['gemini_conversations']);
                    return (data.gemini_conversations || []).filter(c => c.titleSource === 'rpc' && c.titles?.rpc).map(c => c.id.replace(/^c_/, ''));
                })()""", await_promise=True) or []
                missing = [cid for cid in ids if cid.removeprefix('c_') not in known]
                if missing:
                    return False, f"全量扫描结果缺少已知在线会话: {missing}", evidence
            ctx.shared_data['deep_scan_evidence'] = evidence
            return True, message, evidence
        finally:
            cdp_opt.close()


class AuthoritativeTitleUpgradeCase(FeatureTestCase):
    def __init__(self):
        super().__init__(
            feature_id="feat_authoritative_title_upgrade",
            domain=FeatureDomain.TAKEOUT,
            name="权威 RPC 标题覆盖晋级",
            description="全量拉取历史后，Takeout 临时标题被在线权威 RPC 标题平滑覆盖升级",
            critical=True,
            prerequisites=["feat_takeout_zip_import", "feat_deep_scan_pagination"]
        )

    def execute(self, ctx: TestContext) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        cdp_opt = ctx.connect_options()
        try:
            check_takeout_ids = ctx.shared_data.get('expected_title_upgrade_ids', [])
            if not check_takeout_ids:
                return False, "缺少已匹配的在线 Takeout 样本，无法验证权威标题晋级", None
            upg_ok, upg_msg, details = CDPAssertions.assert_title_upgraded(cdp_opt, check_takeout_ids)
            if upg_ok:
                return True, upg_msg, details
            return False, upg_msg, details
        finally:
            cdp_opt.close()
