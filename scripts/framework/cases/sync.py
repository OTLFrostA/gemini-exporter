"""Real-account sync checks shared by the existing full Tier 2 lifecycle."""
import json
import os
import time

from scripts.framework.actions import CDPActions
from scripts.framework.assertions import assert_full_scan_coverage, assert_passive_coverage, assert_activity_sync_result


def read_sync_state(cdp):
    return cdp.eval("""(async () => {
        const slot = window.ConversationsStore.getCurrentSlot() || 'u0';
        const suffix = slot === 'u0' ? '' : '_' + slot;
        const coverageKey = 'gemini_scan_coverage' + suffix;
        const convKey = 'gemini_conversations' + suffix;
        const expKey = slot === 'u0' ? 'exportedIds' : 'gemini_exported_' + slot;
        const data = await chrome.storage.local.get([coverageKey, convKey, expKey]);
        return { slot, coverage: data[coverageKey] || null,
            rows: (data[convKey] || []).map(c => ({ id: c.id.replace(/^c_/, ''), timestamp: c.timestamp,
                updatedAt: c.updatedAt, titleSource: c.titleSource, cloudAvailability: c.cloudAvailability })),
            exportIds: Object.keys(data[expKey] || {}).sort() };
    })()""", await_promise=True) or {}


def save_sync_evidence(ctx, name, evidence):
    with open(os.path.join(ctx.output_dir, name + '.json'), 'w', encoding='utf-8') as output:
        json.dump(evidence, output, ensure_ascii=False, indent=2)
    ctx.shared_data[name] = evidence


def reset_only_coverage(cdp):
    cdp.eval("""(async () => {
        const slot = window.ConversationsStore.getCurrentSlot() || 'u0';
        await chrome.storage.local.remove('gemini_scan_coverage' + (slot === 'u0' ? '' : '_' + slot));
    })()""", await_promise=True)


def wait_for_prior_scan(cdp, timeout=330):
    """The onboarding tour starts a real scan; do not reset its live ledger."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        scanning = cdp.eval('!!window.SyncController?.isScanning?.()')
        coverage = read_sync_state(cdp).get('coverage') or {}
        if not scanning and coverage.get('activeRunId') is None:
            return
        time.sleep(0.5)
    raise RuntimeError('Prior onboarding scan did not settle before passive coverage reset')


def prepare_activity_baseline(ctx, cdp_gemini):
    """Observe genuine webpage RPCs, then establish a full pre-chat baseline."""
    cdp_opt = ctx.connect_options()
    cdp_gemini.call('Page.enable')
    observer = cdp_gemini.call('Page.addScriptToEvaluateOnNewDocument', {'source': """
        window.__tier2PassivePages = [];
        window.addEventListener('message', event => {
            const p = event.data?.payload;
            if (event.data?.type === 'GEMINI_NETWORK_BATCHEXECUTE' && p?.listRequest?.streamId === 'recent') {
                window.__tier2PassivePages.push({ ...p.listRequest, requestedAt: p.requestedAt,
                    accountId: p.requestAccountId, truncated: p.truncated });
            }
        });
    """})
    script_id = observer.get('result', {}).get('identifier')
    if not script_id:
        cdp_opt.close()
        raise RuntimeError('Could not install passive RPC evidence listener: ' + str(observer))
    try:
        wait_for_prior_scan(cdp_opt)
        reset_only_coverage(cdp_opt)
        empty = read_sync_state(cdp_opt)
        if empty.get('coverage') is not None:
            raise RuntimeError('Passive fixture did not clear coverage')
        cdp_gemini.call('Page.reload', {'ignoreCache': True})
        deadline = time.monotonic() + 35
        passive = {}
        observations = []
        while time.monotonic() < deadline:
            passive = read_sync_state(cdp_opt)
            observations = cdp_gemini.eval('window.__tier2PassivePages || []') or []
            ok, message = assert_passive_coverage(empty, passive, observations)
            if ok:
                break
            # Native sidebar navigation requests further real pages if initial
            # RPCs preceded account readiness. No RPC response is synthesized.
            cdp_gemini.eval("""(() => {
                const open = document.querySelector('button[aria-label*="Open sidebar"], button[aria-label*="展开侧边栏"]');
                if (open) open.click();
                const items = document.querySelectorAll('gem-nav-list-item, a[href*="/app/"]');
                items[items.length - 1]?.scrollIntoView({ block: 'end' });
            })()""")
            time.sleep(0.5)
        save_sync_evidence(ctx, 'passive_sync_coverage', {'before': empty, 'after': passive, 'observations': observations})
        if not ok:
            raise RuntimeError(message)
        print('      ✓ 网页自然加载建立 Coverage，未点击 Sync All')
        reset_only_coverage(cdp_opt)
        full = CDPActions.trigger_deep_scan(cdp_opt)
        state = read_sync_state(cdp_opt)
        ok, message = assert_full_scan_coverage(full, state.get('coverage') or {})
        baseline = {'scan': full, 'state': state}
        save_sync_evidence(ctx, 'pre_chat_sync_baseline', baseline)
        if not ok:
            raise RuntimeError('Pre-chat full baseline failed: ' + message)
        recent = state['coverage']['streams']['recent']
        if not recent.get('range') and recent.get('orderingInvalidated') is not True:
            raise RuntimeError('Full traversal did not establish trusted recent coverage')
        if recent.get('orderingInvalidated') is True:
            print('      ✓ 时间字段与分页顺序不一致：完整覆盖已认证，后续强制完整分页验收')
        print('      ✓ 发帖前完整遍历基线: ' + message
              + '; Coverage historyComplete=' + str(state['coverage'].get('historyComplete')))
        return baseline
    finally:
        if script_id:
            cdp_gemini.call('Page.removeScriptToEvaluateOnNewDocument', {'identifier': script_id})
        cdp_opt.close()


def verify_activity_sync(ctx, baseline, target_ids, name):
    cdp_opt = ctx.connect_options()
    try:
        before = read_sync_state(cdp_opt)
        scan = CDPActions.trigger_deep_scan(cdp_opt)
        after = read_sync_state(cdp_opt)
        result = {'baseline': baseline, 'before': before, 'scan': scan, 'after': after, 'targetIds': target_ids}
        save_sync_evidence(ctx, name, result)
        ok, message = assert_activity_sync_result(baseline, before, scan, after, target_ids)
        if not ok:
            raise RuntimeError(message)
        print('      ✓ ' + message)
        return result
    finally:
        cdp_opt.close()
