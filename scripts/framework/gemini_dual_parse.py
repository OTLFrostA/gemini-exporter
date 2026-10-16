"""Test-only capture of the native replies used by the actual Gemini export.

No fetch, prompt, DOM scraping, or additional conversation is initiated here.
"""
import json
import re
import subprocess
from pathlib import Path


INSTALL_CAPTURE = r"""(() => {
    if (window.__geminiDualCapture) throw new Error('Gemini capture already installed');
    const original = chrome.tabs.sendMessage;
    const state = {original, replies: {}};
    window.__geminiDualCapture = state;
    chrome.tabs.sendMessage = function(...args) {
        const message = args[1];
        if (message?.action !== 'getConversationDetail') return original.apply(this, args);
        const capture = reply => {
            const id = String(message.conversationId || '').replace(/^c_/, '');
            try {
                (state.replies[id] ||= []).push(reply === undefined ? null : JSON.parse(JSON.stringify(reply)));
            } catch (error) {
                (state.replies[id] ||= []).push({success: false, error: 'capture failed: ' + String(error)});
            }
        };
        const last = args.length - 1;
        if (typeof args[last] === 'function') {
            const callback = args[last];
            args[last] = function(reply) { capture(reply); return callback(reply); };
            return original.apply(this, args);
        }
        const result = original.apply(this, args);
        result?.then?.(capture, () => {});
        return result;
    };
    return true;
})()"""


def install_capture(cdp):
    if cdp.eval(INSTALL_CAPTURE) is not True:
        raise RuntimeError('Failed to install Gemini native export capture')


def finish_capture(cdp, directory, expected_ids):
    """Persist each target response and always restore sendMessage, including on failure."""
    directory = Path(directory)
    selected = list(dict.fromkeys(expected_ids))
    missing = []
    try:
        directory.mkdir(parents=True, exist_ok=True)
        # Stale earlier targets must not enter a new audit.
        for previous in directory.glob('*.json'):
            previous.unlink()
        for cid in selected:
            if not re.fullmatch(r'[A-Za-z0-9_-]+', cid):
                raise ValueError('Invalid Gemini conversation ID in capture')
            replies = cdp.eval(f'window.__geminiDualCapture?.replies[{json.dumps(cid)}]') or []
            native = [reply for reply in replies if isinstance(reply, dict)
                      and reply.get('success') is True and reply.get('source') == 'batchexecute']
            if not native:
                missing.append(cid)
                continue
            (directory / f'{cid}.json').write_text(json.dumps(native[-1], ensure_ascii=False, indent=2), encoding='utf-8')
        manifest = {'expected': selected, 'missingNative': missing}
        (directory.parent / 'capture.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        return manifest
    finally:
        cdp.eval("""(() => {
            const state = window.__geminiDualCapture;
            if (state) chrome.tabs.sendMessage = state.original;
            delete window.__geminiDualCapture;
        })()""")


def run_check(repo_root, source, destination):
    command = ['node', '-r', str(Path(repo_root) / 'tests/ts_register.js'),
               str(Path(repo_root) / 'scripts/check_gemini_dual_parse.ts'),
               '--input', str(source), '--output', str(destination)]
    result = subprocess.run(command, cwd=repo_root, capture_output=True, text=True, timeout=180)
    summary_file = Path(destination) / 'summary.json'
    if not summary_file.is_file():
        raise RuntimeError(f'Gemini dual parse produced no report: {result.stderr[-1500:]}')
    summary = json.loads(summary_file.read_text(encoding='utf-8'))
    if result.returncode not in (0, 1):
        raise RuntimeError(f'Gemini dual parse execution failed: {result.stderr[-1500:]}')
    return result.returncode == 0 and summary.get('passed') is True, summary
