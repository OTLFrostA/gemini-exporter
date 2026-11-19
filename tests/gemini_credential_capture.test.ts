import assert from 'node:assert/strict';
import test from 'node:test';
import { initGeminiCredentialCapture } from '../src/runtime/background/geminiCredentialCapture.js';
import { GEMINI_RPC_CREDENTIALS } from '../src/runtime/api/geminiRpcCredentials.js';

type RequestDetails = chrome.webRequest.OnBeforeRequestDetails;

test('Gemini native credentials go only to the initiating document, with URL/form precedence', t => {
    const origin = 'https://gemini.google.com';
    const url = origin + '/u/1/_/BardChatUi/data/batchexecute?f.sid=fixture-sid&bl=fixture-build&_reqid=123';
    const request: RequestDetails = {
        url, initiator: origin, frameId: 0, tabId: 42, documentId: 'document-id',
        parentFrameId: -1, method: 'POST', type: 'xmlhttprequest', timeStamp: 1, requestId: '42',
    };
    let receive: ((details: RequestDetails) => void) | undefined;
    const sendMessage = t.mock.fn(async (_tabId: number, _message: unknown, _options: chrome.tabs.MessageSendOptions) => {});
    const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
    t.after(() => {
        if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome);
        else Reflect.deleteProperty(globalThis, 'chrome');
    });
    Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
        tabs: { sendMessage },
        webRequest: { onBeforeRequest: { addListener: (listener: typeof receive) => { receive = listener; } } },
    } });
    initGeminiCredentialCapture();
    assert.ok(receive);
    for (const partial of [
        { frameId: 1 }, { tabId: -1 }, { documentId: undefined },
        { initiator: 'chrome-extension://extension-id' },
        { method: 'GET' }, { url: origin + '/no-rpc?next=batchexecute' },
        { url: origin + '/batchexecute?f.sid=fixture-sid' },
        { url: origin + '/_/BardChatUi/data/batchexecute' },
    ]) receive({ ...request, ...partial });
    assert.equal(sendMessage.mock.callCount(), 0);

    const raw = (...chunks: string[]) => ({ raw: chunks.map(chunk => ({ bytes: new TextEncoder().encode(chunk).buffer })) });
    const cases: [string, RequestDetails['requestBody'], string][] = [
        ['&at=url%20token', { formData: { at: ['body token'] } }, 'url token'],
        ['', { formData: { at: ['form token'] } }, 'form token'],
        ['', raw('request=1&a%74=form', '+token%2B%25'), 'form token+%'],
        ['', raw('f.req=at=decoy&format=wrong'), ''],
    ];
    for (const [query, requestBody, at] of cases) {
        receive({ ...request, url: url + query, requestBody });
        assert.deepEqual(sendMessage.mock.calls.at(-1)?.arguments, [42, {
            action: GEMINI_RPC_CREDENTIALS,
            requestId: '123',
            payload: { at, sid: 'fixture-sid', bl: 'fixture-build', accountSlot: 'u1' },
        }, { documentId: 'document-id' }]);
    }
});
