import { chatGPTRequest, CHATGPT_SOURCE_EVENT, chatGPTObservedIdentity, chatGPTConversationId, chatGPTStreamEvent, chatGPTWorkspaceMatches } from './observation.js';
import { installChatGPTSidebarCapture } from './sidebar.js';
import { readCappedStreamLines } from '../shared/streamAndBridge.js';

const HOOK_FLAG = '__gemExporterChatGPTHookInstalled';
const IDENTITY_TIMEOUT_MS = 10_000;

/** MAIN-world acquisition only. Tokens never cross the world/message boundary. */
export function installChatGPTHook(): void {
    if (Reflect.get(window, HOOK_FLAG) === true) return;
    Reflect.set(window, HOOK_FLAG, true);
    const original = window.fetch;
    const nativeFetch = original.bind(window);
    const identity = async (): Promise<string | null> => {
        try {
            const response = await nativeFetch('/api/auth/session', {
                credentials: 'include', signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS) });
            return response.ok ? chatGPTObservedIdentity(await response.json()) : null;
        } catch { return null; }
    };
    // The current site embeds the initial history in router loader data; no
    // /conversations fetch occurs for that first sidebar page.
    if (typeof document !== 'undefined') installChatGPTSidebarCapture(identity,
        payload => window.postMessage({ type: CHATGPT_SOURCE_EVENT, payload }, location.origin));
    window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href).href;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const request = chatGPTRequest(url, method);
        if (!request) return nativeFetch(input, init);
        // Observation must never delay or detach the site's own request, so the
        // session is sampled alongside it rather than before it.
        const pendingIdentity = identity();
        const workspace = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('ChatGPT-Account-ID');
        let body: unknown;
        try {
            const text = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
            body = text ? JSON.parse(text) : null;
        } catch { body = null; }
        const response = await nativeFetch(input, init);
        if (response.ok) {
            const copy = response.clone();
            void (async () => {
                const requestIdentity = await pendingIdentity;
                if (!requestIdentity || (workspace && !chatGPTWorkspaceMatches(requestIdentity, workspace))) {
                    await copy.body?.cancel();
                    return;
                }
                let responseBody: unknown, conversationId = request.conversationId;
                if (request.kind === 'stream') {
                    const completed = await readCappedStreamLines(copy.body, 16 * 1024 * 1024, line => {
                        const event = chatGPTStreamEvent(line);
                        if (event.conversationId) conversationId = event.conversationId;
                        return event.done;
                    });
                    if (!completed) return;
                    responseBody = null;
                    if (!conversationId && body && typeof body === 'object' && 'conversation_id' in body && chatGPTConversationId(body.conversation_id)) {
                        conversationId = body.conversation_id;
                    }
                } else {
                    const text = await copy.text();
                    if (text.length > 8 * 1024 * 1024) return;
                    responseBody = JSON.parse(text);
                }
                if ((request.kind !== 'list' && !conversationId) || await identity() !== requestIdentity) return;
                window.postMessage({ type: CHATGPT_SOURCE_EVENT, payload: { ...request, conversationId,
                    requestIdentity, url, requestBody: request.kind === 'delete' ? body : null, responseBody } }, location.origin);
            })().catch(error => console.debug('[ChatGPT source]', error));
        }
        return response;
    };
}

installChatGPTHook();
