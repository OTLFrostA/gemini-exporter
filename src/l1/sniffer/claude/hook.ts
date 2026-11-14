import { CLAUDE_SOURCE_EVENT, claudeRequest, activeClaudeOrganization } from './observation.js';
import { readCappedStreamLines } from '../shared/streamAndBridge.js';

const HOOK_FLAG = '__gemExporterClaudeHookInstalled';

/** Observe the site's own requests. Never issue identity/source polling requests. */
export function installClaudeHook(): void {
    if (Reflect.get(window, HOOK_FLAG) === true) return;
    Reflect.set(window, HOOK_FLAG, true);
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href).href;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const request = claudeRequest(url, method);
        const owner = activeClaudeOrganization(document.cookie);
        const response = await nativeFetch(input, init);
        if (!request || !owner || owner !== request.organization || !response.ok) return response;
        const copy = response.clone();
        void (async () => {
            let responseBody: unknown = null;
            if (request.kind === 'stream') {
                const complete = await readCappedStreamLines(copy.body, 16 * 1024 * 1024, line => {
                    if (!line.startsWith('data:')) return false;
                    try {
                        const event: unknown = JSON.parse(line.slice(5));
                        return !!event && typeof event === 'object' && !Array.isArray(event) && Reflect.get(event, 'type') === 'message_stop';
                    } catch { return false; }
                });
                if (!complete) return;
            } else if (request.kind !== 'delete') {
                const text = await copy.text();
                if (text.length > 8 * 1024 * 1024) return;
                responseBody = JSON.parse(text);
            }
            if (activeClaudeOrganization(document.cookie) !== owner) return;
            window.postMessage({ type: CLAUDE_SOURCE_EVENT, payload: {
                ...request, url, method, responseBody, status: response.status,
            } }, location.origin);
        })().catch(error => console.debug('[Claude source]', error));
        return response;
    };
}
installClaudeHook();
