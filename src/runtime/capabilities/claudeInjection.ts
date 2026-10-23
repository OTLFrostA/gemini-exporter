import { hasClaudeAccess, CLAUDE_ORIGIN } from '../../l1/client/claude/claudeSource.js';

const ids = ['claude-source-main', 'claude-source-content'];
/** Register only after optional host access; revoke registrations with access. */
export async function syncClaudeContentScripts(): Promise<void> {
    if (!chrome.scripting?.getRegisteredContentScripts) return;
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (!await hasClaudeAccess()) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(item => item.id) });
        return;
    }
    const missing = ids.filter(id => !registered.some(item => item.id === id));
    if (missing.length) await chrome.scripting.registerContentScripts(missing.map(id => ({ id,
        matches: [CLAUDE_ORIGIN], runAt: 'document_start', allFrames: false, persistAcrossSessions: true,
        ...(id === ids[1] ? { css: ['src/ui/badge/content.css'] } : {}),
        js: [id === ids[0] ? 'dist/content/claude-hook.js' : 'dist/content/claude-content.js'],
        world: id === ids[0] ? 'MAIN' : 'ISOLATED' })));
}
