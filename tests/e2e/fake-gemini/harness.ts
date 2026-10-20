/**
 * Offline Gemini network simulator for running the *built* MV3 extension.
 *
 * Only browser traffic is mocked. Never import this module from src/ or dist/.
 * All reply shapes below are synthetic, based on existing repository tests, and
 * are NOT proof of compatibility with Google's current private protocol.
 */
import type { BrowserContext, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { renderFakeGeminiPage } from './page';

export interface FakeConversation {
    id: string; // normalized, without c_
    title: string;
    updatedSeconds: number;
    prompt: string;
    answer: string;
    pinned?: boolean;
}

export interface ReplayResponse {
    status?: number;
    body: string; // sanitized complete response bytes, including batchexecute framing
    contentType?: string;
}

/** Key examples: list:recent:head, list:recent:tC_2, detail:<id>:head, delete:<id>, gems, stream:<id>. */
export interface FakeGeminiReplay {
    provenance: 'synthetic' | 'locally-verified';
    responses: Record<string, ReplayResponse>;
}

export interface FakeGeminiScenario {
    gaiaId: string;
    email: string;
    conversations: FakeConversation[];
    pageSize: number;
    delayMs: number;
    /** Failure simulation is keyed just like replay responses, e.g. list:recent:head = 429. */
    statusOverrides?: Record<string, number>;
    replay?: FakeGeminiReplay;
}

/** Safe structural diagnostics only: never retain cookies, XSRF tokens or raw prompts. */
export interface FakeRequest {
    kind: 'list' | 'detail' | 'delete' | 'gems' | 'stream' | 'unknown';
    rpcIds: string[];
    stream: 'recent' | 'pinned' | null;
    cursor: string | null;
    conversationId: string | null;
    status: number;
}

export const DEFAULT_CONVERSATIONS: FakeConversation[] = [
    { id: 'a100000000000003', title: 'Third demo chat', updatedSeconds: 1790000200,
        prompt: 'Explain the third example', answer: 'Answer from demo chat three.' },
    { id: 'a100000000000002', title: 'Second demo chat', updatedSeconds: 1790000100,
        prompt: 'Explain the second example', answer: 'Answer from demo chat two.', pinned: true },
    { id: 'a100000000000001', title: 'First demo chat', updatedSeconds: 1790000000,
        prompt: 'Explain the first example', answer: 'Answer from demo chat one.' },
];

export function loadFakeGeminiReplay(filename: string): FakeGeminiReplay {
    const raw: unknown = JSON.parse(readFileSync(filename, 'utf8'));
    if (!raw || typeof raw !== 'object' || !('responses' in raw) || !('provenance' in raw)
        || !['synthetic', 'locally-verified'].includes(String(raw.provenance))
        || !raw.responses || typeof raw.responses !== 'object' || Array.isArray(raw.responses)) {
        throw new Error('Invalid Fake Gemini replay file');
    }
    for (const [key, response] of Object.entries(raw.responses)) {
        if (!response || typeof response !== 'object' || typeof Reflect.get(response, 'body') !== 'string')
            throw new Error('Invalid Fake Gemini replay response: ' + key);
    }
    return raw as FakeGeminiReplay;
}

const ACCOUNT = { gaiaId: '10000000001', email: 'fake-gemini@example.test' };
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

type RpcCall = { id: string; args: unknown };
function readCalls(body: string | null): RpcCall[] {
    const batch: unknown = JSON.parse(new URLSearchParams(body ?? '').get('f.req') ?? 'null');
    if (!Array.isArray(batch)) throw new Error('f.req must be a batch');
    const calls: RpcCall[] = [];
    for (const group of batch) {
        if (!Array.isArray(group)) throw new Error('invalid f.req group');
        for (const call of group) {
            if (!Array.isArray(call) || typeof call[0] !== 'string' || typeof call[1] !== 'string')
                throw new Error('invalid f.req call');
            calls.push({ id: call[0], args: JSON.parse(call[1]) });
        }
    }
    if (!calls.length) throw new Error('empty f.req');
    return calls;
}
function wire(rows: Array<[string, unknown]>): string {
    return ")]}'\n\n" + JSON.stringify(rows.map(([id, inner]) => ['wrb.fr', id, JSON.stringify(inner)]));
}
function convRow(item: FakeConversation): unknown[] {
    return ['c_' + item.id, item.title, null, null, null, [item.updatedSeconds, 0]];
}
function readId(value: unknown): string | null {
    return typeof value === 'string' && /^c_[a-f0-9]{8,64}$/i.test(value) ? value.slice(2).toLowerCase() : null;
}

export class FakeGeminiHarness {
    readonly scenario: FakeGeminiScenario;
    readonly requests: FakeRequest[] = [];
    readonly unexpectedPaths: string[] = [];
    private readonly deleted = new Set<string>();

    constructor(options: Partial<FakeGeminiScenario> = {}) {
        this.scenario = {
            ...ACCOUNT, conversations: DEFAULT_CONVERSATIONS.map(item => ({ ...item })),
            pageSize: 2, delayMs: 0, ...options,
        };
        if (!/^\d{10,25}$/.test(this.scenario.gaiaId)) throw new Error('Fixture Gaia must be numeric');
        if (!(this.scenario.pageSize >= 1 && Number.isInteger(this.scenario.pageSize))) throw new Error('Invalid fake pageSize');
    }

    /** Set up BEFORE opening gemini.google.com or the extension workbench. */
    async install(context: BrowserContext): Promise<void> {
        await context.route(/^https:\/\/gemini\.google\.com\//, async route => {
            const req = route.request();
            const url = new URL(req.url());
            if (req.isNavigationRequest() && req.method() === 'GET') {
                await route.fulfill({
                    status: 200, contentType: 'text/html; charset=utf-8',
                    body: renderFakeGeminiPage(this.scenario, url.pathname),
                });
                return;
            }
            if (url.pathname.endsWith('/batchexecute') && req.method() === 'POST') {
                await this.rpc(route);
                return;
            }
            if (url.pathname.endsWith('/StreamGenerate') && req.method() === 'POST') {
                await this.stream(route);
                return;
            }
            if (url.pathname === '/favicon.ico') {
                await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
                return;
            }
            // Never fall through to Google's real servers. These paths must be
            // characterized by the local authenticated calibration agent.
            this.unexpectedPaths.push(url.pathname);
            await route.fulfill({ status: 501, contentType: 'text/plain', body: 'Unmocked Gemini endpoint' });
        });
        // Small, deterministic offline media stand-ins; no real Google requests.
        await context.route(/^https:\/\/(?:[^/]+\.)?(?:googleusercontent\.com|usercontent\.google\.com|gstatic\.com)\//,
            route => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
    }

    private find(id: string | null): FakeConversation | undefined {
        return id ? this.scenario.conversations.find(item => item.id === id && !this.deleted.has(id)) : undefined;
    }
    private list(call: RpcCall): { key: string; response: unknown; stream: 'recent' | 'pinned' | null; cursor: string | null } {
        const args = call.args;
        if (!Array.isArray(args)) throw new Error('invalid list args');
        // Combined Detail + MaZiqc often requests conversation metadata, not a sidebar page.
        if (Array.isArray(args[2]) && args[2].length === 6 && readId(args[2][5])) {
            const item = this.find(readId(args[2][5]));
            return { key: 'metadata', response: [null, null, item ? [convRow(item)] : []], stream: null, cursor: null };
        }
        if (args.length !== 3 || !Array.isArray(args[2]) || (args[1] !== null && typeof args[1] !== 'string'))
            throw new Error('invalid list request layout');
        const stream = args[2][0] === 1 ? 'pinned' : 'recent';
        const cursor = args[1] as string | null;
        const offset = cursor === null ? 0 : /^tC_(\d+)$/.exec(cursor)?.[1];
        if (offset === undefined) throw new Error('unknown fake list cursor');
        const start = Number(offset);
        const rows = this.scenario.conversations.filter(item => !this.deleted.has(item.id) && (stream === 'recent' || item.pinned))
            .sort((a, b) => b.updatedSeconds - a.updatedSeconds);
        const portion = rows.slice(start, start + this.scenario.pageSize);
        const next = start + this.scenario.pageSize < rows.length ? 'tC_' + (start + this.scenario.pageSize) : null;
        return { key: 'list:' + stream + ':' + (cursor ?? 'head'),
            response: [null, next, portion.map(convRow)], stream, cursor };
    }
    private detail(call: RpcCall): { key: string; response: unknown; cursor: string | null; conversationId: string | null } {
        const args = call.args;
        if (!Array.isArray(args) || args.length !== 8) throw new Error('invalid detail request layout');
        const id = readId(args[0]);
        if (!id) throw new Error('invalid detail conversation id');
        const cursor = typeof args[2] === 'string' ? args[2] : null;
        const item = this.find(id);
        if (!item) {
            return { key: 'detail:' + id + ':' + (cursor ?? 'head'), cursor, conversationId: id,
                response: null };
        }
        const turn = [
            ['c_' + item.id, 'r_' + item.id], [item.updatedSeconds, 0],
            [[item.prompt]], [[['rc_' + item.id, [[item.answer]]]]],
        ];
        return { key: 'detail:' + id + ':' + (cursor ?? 'head'),
            response: [[turn], null, item.title], cursor, conversationId: id };
    }
    private delete(call: RpcCall): { key: string; response: unknown; conversationId: string | null } {
        const matches = JSON.stringify(call.args).match(/c_[a-f0-9]{8,64}/gi) ?? [];
        if (matches.length !== 1) throw new Error('invalid delete request');
        const id = readId(matches[0]);
        if (id && this.find(id)) this.deleted.add(id);
        return { key: 'delete:' + id, response: [null, 'c_' + id], conversationId: id };
    }
    private override(key: string, defaultBody: string): ReplayResponse {
        const fixture = this.scenario.replay?.responses[key];
        return { status: this.scenario.statusOverrides?.[key] ?? fixture?.status ?? 200,
            body: fixture?.body ?? defaultBody, contentType: fixture?.contentType ?? 'application/json' };
    }
    private async fulfill(route: Route, key: string, defaultBody: string): Promise<number> {
        if (this.scenario.delayMs > 0) await new Promise(resolve => setTimeout(resolve, this.scenario.delayMs));
        const response = this.override(key, defaultBody);
        await route.fulfill({
            status: response.status, contentType: response.contentType, body: response.body,
            headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
        });
        return response.status!;
    }

    private async rpc(route: Route): Promise<void> {
        let observed: FakeRequest = { kind: 'unknown', rpcIds: [], stream: null, cursor: null, conversationId: null, status: 400 };
        try {
            const calls = readCalls(route.request().postData());
            observed.rpcIds = calls.map(call => call.id);
            const rows: Array<[string, unknown]> = [];
            let lookupKey = '';
            for (const call of calls) {
                if (call.id === 'MaZiqc') {
                    const result = this.list(call);
                    rows.push([call.id, result.response]);
                    if (result.stream && observed.kind !== 'detail') {
                        observed.kind = 'list'; observed.stream = result.stream; observed.cursor = result.cursor;
                        lookupKey = result.key;
                    }
                } else if (call.id === 'hNvQHb') {
                    const result = this.detail(call);
                    observed.kind = 'detail'; observed.cursor = result.cursor;
                    observed.conversationId = result.conversationId;
                    lookupKey = result.key;
                    rows.push([call.id, result.response]);
                } else if (call.id === 'GzXR5e') {
                    const result = this.delete(call);
                    observed.kind = 'delete'; observed.conversationId = result.conversationId;
                    lookupKey = result.key;
                    rows.push([call.id, result.response]);
                } else if (call.id === 'CNgdBe') {
                    observed.kind = 'gems'; lookupKey = 'gems';
                    rows.push([call.id, [null, []]]);
                } else {
                    observed.kind = 'unknown';
                    throw new Error('unmocked RPC ' + call.id);
                }
            }
            if (!lookupKey) throw new Error('uncharacterized RPC call');
            observed.status = await this.fulfill(route, lookupKey, wire(rows));
        } catch {
            observed.status = 400;
            await route.fulfill({ status: 400, contentType: 'text/plain', body: 'Invalid or unmocked fake Gemini request' });
        } finally {
            this.requests.push(observed);
        }
    }
    private async stream(route: Route): Promise<void> {
        // StreamGenerate is not a batchexecute RPC. The synthetic frame below
        // exercises the L1 transport observer, not the full Google model protocol.
        const requestBody = route.request().postData() ?? '';
        const id = readId(/c_[a-f0-9]{8,64}/i.exec(requestBody)?.[0]) ?? this.scenario.conversations[0]?.id ?? null;
        const candidate: unknown[] = Array(9).fill(null);
        candidate[0] = 'rc_' + (id ?? 'unknown');
        candidate[8] = [2];
        const inner: unknown[] = Array(26).fill(null);
        inner[1] = ['c_' + id, 'r_' + (id ?? 'abcd')];
        inner[4] = [candidate];
        inner[25] = 'synthetic-save-marker';
        const text = wire([['synthetic-stream', inner]]);
        const key = 'stream:' + id;
        const status = await this.fulfill(route, key, text);
        this.requests.push({ kind: 'stream', rpcIds: [], stream: null, cursor: null, conversationId: id, status });
    }
}
