import { hasChatGPTAccess, CHATGPT_OPTIONAL_ORIGINS } from '../../l1/client/chatgpt/chatgptAccess.js';

const ids = ['chatgpt-source-main', 'chatgpt-source-content'];
/** Register only after optional host access; revoke registrations with access. */
export async function syncChatGPTContentScripts(): Promise<void> {
    if (!chrome.scripting?.getRegisteredContentScripts) return;
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids });
    if (!await hasChatGPTAccess()) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(item => item.id) });
        return;
    }
    const missing = ids.filter(id => !registered.some(item => item.id === id));
    if (missing.length) await chrome.scripting.registerContentScripts(missing.map(id => ({ id,
        matches: [...CHATGPT_OPTIONAL_ORIGINS], runAt: 'document_start', allFrames: false, persistAcrossSessions: true,
        js: [id === ids[0] ? 'dist/content/chatgpt-hook.js' : 'dist/content/chatgpt-content.js'],
        world: id === ids[0] ? 'MAIN' : 'ISOLATED' })));
}
