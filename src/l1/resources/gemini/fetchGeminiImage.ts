import { OperationError } from '../../../shared/errors/operationError.js';
import { isPlatformImageUrl, platformOrigins } from '../../../shared/platformHosts.js';

/** Chrome hides Location on manual redirects. Observe only this fetch's headers,
 * match concurrent reads by request ID, and authorize each subsequent GET separately. */
export async function fetchGeminiImage(sourceUri: string, init: RequestInit): Promise<Response> {
    const api = globalThis.chrome?.webRequest;
    const manual: RequestInit = { ...init, redirect: 'manual' };
    if (!api) return fetch(sourceUri, manual);
    const accept = `image/*, */*;q=0.8;request=${crypto.randomUUID()}`;
    const filter: chrome.webRequest.RequestFilter = { urls: platformOrigins('gemini'), types: ['xmlhttprequest'] };
    let current = new URL(sourceUri);
    current.hash = '';
    let requestId: string | undefined;
    let receiveLocation: ((value?: string) => void) | undefined;
    const sent = (details: chrome.webRequest.OnSendHeadersDetails) => {
        if (details.url === current.href && details.initiator === `chrome-extension://${chrome.runtime.id}`
            && details.requestHeaders?.some(h => h.name.toLowerCase() === 'accept' && h.value === accept)) {
            requestId = details.requestId;
        }
    };
    const received = (details: chrome.webRequest.OnHeadersReceivedDetails) => {
        if (details.requestId === requestId && details.url === current.href) {
            receiveLocation?.(details.responseHeaders?.find(h => h.name.toLowerCase() === 'location')?.value);
        }
        return undefined;
    };
    try {
        api.onSendHeaders.addListener(sent, filter, ['requestHeaders']);
        api.onHeadersReceived.addListener(received, filter, ['responseHeaders']);
        for (let hop = 0; hop <= 5; hop++) {
            requestId = undefined;
            const headers = new Promise<string | undefined>(resolve => { receiveLocation = resolve; });
            const response = await fetch(current.href, { ...manual, headers: { Accept: accept } });
            if (response.type !== 'opaqueredirect') return response;
            if (hop === 5) break;
            // An opaque Fetch response can settle before Chrome dispatches its headers event.
            const unavailable = () => receiveLocation?.();
            const timeout = setTimeout(unavailable, 3000);
            init.signal?.addEventListener('abort', unavailable);
            let location: string | undefined;
            try {
                init.signal?.throwIfAborted();
                location = await headers;
                init.signal?.throwIfAborted();
            } finally {
                clearTimeout(timeout);
                init.signal?.removeEventListener('abort', unavailable);
            }
            if (!location) break;
            const next = URL.parse(location, current);
            if (!next || !isPlatformImageUrl('gemini', next.href)) break;
            next.hash = '';
            current = next;
        }
        throw new OperationError('RESOURCE_LOCATOR_UNAVAILABLE', 'Gemini image redirect unavailable');
    } finally {
        api.onSendHeaders.removeListener(sent);
        api.onHeadersReceived.removeListener(received);
    }
}
