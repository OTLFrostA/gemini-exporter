import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as protocol from '../../src/core/protocol/protocol.js';
import { geminiAccountObservation } from '../../src/core/provider/gemini/accountObservation.js';
import { readGeminiListRequest } from '../../src/core/parsers/gemini/rpc/listRequest.js';
import { readGeminiDetailRequest } from '../../src/core/parsers/gemini/rpc/detailRequest.js';
import { parseConfirmedGeminiDeletion } from '../../src/core/parsers/gemini/rpc/parseDeletion.js';
import type { sniffUserProfileFromDom } from '../../src/content/accountSniffer.js';

/** Real MAIN Hook and pure decoders; only browser IO/profile discovery is substituted. */
export function createHookSandbox(sniffProfile?: typeof sniffUserProfileFromDom) {
    const posted: { msg: { type: string; payload: Record<string, unknown> }; origin: string }[] = [];
    const win = {
        __nextResponseText: '',
        postMessage(msg: (typeof posted)[number]['msg'], origin: string) { posted.push({ msg, origin }); },
        addEventListener() {}, setInterval() { return 0; },
        async fetch(_input?: unknown, _init?: RequestInit) { return new Response(win.__nextResponseText); },
    };
    class MockXhr { open(_method: string, _url: string) {} send(_body?: string) {} addEventListener() {} }
    const source = fs.readFileSync(path.resolve('src/content/hookCredentials.ts'), 'utf8')
        .replace(/import\s+(?:type\s+)?(?:\{[^}]*\}|[\w*\s,]+)\s*from\s*['"][^'"]+['"];?\s*/g, '');
    const script = transformSync(source, { loader: 'ts', format: 'iife' }).code;
    vm.runInNewContext(script, { window: win,
        location: { origin: 'https://gemini.google.com', href: 'https://gemini.google.com/app', pathname: '/app' },
        document: { querySelectorAll: () => [], addEventListener() {} },
        console, URL, URLSearchParams, Request, Response, TextEncoder, TextDecoder, Uint8Array, XMLHttpRequest: MockXhr,
        GeminiProtocol: protocol.GeminiProtocol, CrossWorldEvents: protocol.CrossWorldEvents,
        sniffUserProfileFromDom: sniffProfile ?? (() => ({ gaiaId: '10000000001' })),
        geminiAccountObservation, readGeminiListRequest, readGeminiDetailRequest, parseConfirmedGeminiDeletion,
    });
    posted.length = 0;
    return { posted, win, Xhr: MockXhr };
}
