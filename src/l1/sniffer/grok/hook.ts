import { GROK_SOURCE_EVENT, grokRequest } from './observation.js';
import { grokAccount } from '../../parsers/grok/source.js';
import { readCappedStreamText } from '../shared/streamAndBridge.js';

const HOOK_FLAG = '__gemExporterGrokHookInstalled';

/** Only completed native reads trigger acquisition. Request identity is checked at both ends. */
export function installGrokHook(): void {
    if (Reflect.get(window, HOOK_FLAG) === true) return;
    Reflect.set(window, HOOK_FLAG, true);
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href).href;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        const request = grokRequest(url, method);
        const identity = async () => {
            const response = await nativeFetch('/rest/auth/get-user', { credentials: 'include' });
            if (!response.ok) throw new Error('Grok identity unavailable');
            return grokAccount(await response.json()).providerAccountId;
        };
        // Start before the native request. Never delay or reject the website's request for capture.
        const owner = request ? identity().catch(() => null) : Promise.resolve(null);
        const response = await nativeFetch(input, init);
        if (!request || !response.ok) return response;
        const copy = response.clone();
        void (async () => {
            const captured = await owner;
            if (!captured) return;
            const text = await readCappedStreamText(copy.body, 16 * 1024 * 1024);
            if (text === null) return;
            if (await identity() !== captured) return;
            const responseBody: unknown = request.kind === 'list' ? JSON.parse(text) : null;
            window.postMessage({ type: GROK_SOURCE_EVENT, payload: { url, method, owner: captured,
                status: response.status, responseBody } }, location.origin);
        })().catch(error => console.debug('[Grok source]', error));
        return response;
    };
}
installGrokHook();
