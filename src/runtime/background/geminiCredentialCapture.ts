import { GEMINI_RPC_CREDENTIALS, type GeminiRpcCredentialsMessage } from '../../shared/types/geminiRpcCredentials.js';

const GEMINI_ORIGIN = 'https://gemini.google.com';

function formToken(body: chrome.webRequest.OnBeforeRequestDetails['requestBody']): string {
    if (body?.formData) {
        const at = body.formData.at?.[0];
        return typeof at === 'string' ? at : '';
    }
    if (!body?.raw) return '';
    // Native fetch/XHR can also send a URL-encoded string as text/plain.
    const decoder = new TextDecoder();
    let form = '';
    for (const part of body.raw) {
        if (!part.bytes) return '';
        form += decoder.decode(part.bytes, { stream: true });
    }
    return new URLSearchParams(form + decoder.decode()).get('at') ?? '';
}

export function initGeminiCredentialCapture(): void {
    chrome.webRequest?.onBeforeRequest.addListener(details => {
        const { tabId, documentId, initiator, frameId, method } = details;
        if (tabId < 0 || frameId !== 0 || !documentId || initiator !== GEMINI_ORIGIN || method !== 'POST') return;
        const { origin, pathname, searchParams } = new URL(details.url);
        const route = /^(?:\/u\/(\d+))?\/_\/BardChatUi\/data\/batchexecute$/.exec(pathname);
        if (origin !== GEMINI_ORIGIN || !route) return;
        const sid = searchParams.get('f.sid');
        if (!sid) return;

        const accountIndex = route[1];
        const payload = {
            sid,
            at: searchParams.get('at') || formToken(details.requestBody),
            bl: searchParams.get('bl') ?? '',
            accountSlot: accountIndex === undefined ? undefined : `u${accountIndex}`,
        };
        // Only the isolated extension script in this document receives the credential update.
        const message: GeminiRpcCredentialsMessage = {
            action: GEMINI_RPC_CREDENTIALS, requestId: searchParams.get('_reqid'), payload,
        };
        void chrome.tabs.sendMessage(tabId, message, { documentId })
            .catch(() => { /* The initiating document may have already closed or navigated. */ });
    }, { urls: [`${GEMINI_ORIGIN}/*/_/BardChatUi/data/batchexecute*`, `${GEMINI_ORIGIN}/_/BardChatUi/data/batchexecute*`],
        types: ['xmlhttprequest'] }, ['requestBody']);
}
