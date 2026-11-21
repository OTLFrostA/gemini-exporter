import type { GeminiProtocolModule } from "../../../protocol/gemini/protocol.js";
import type { GeminiCredentials } from './credentialManager.js';

const GEMINI_API_URL = "https://gemini.google.com/_/BardChatUi/data/batchexecute";

interface RpcRequestOptions {
    api: string;
    rpcids: string;
    fReq: string;
    cred?: Partial<GeminiCredentials>;
    sourcePath?: string;
    timeoutMs?: number;
    signal?: AbortSignal | null;
}

interface GeminiClientRpcClientModule {
    GEMINI_API_URL: string;
    getProtocol: () => GeminiProtocolModule;
    getApiUrl: (slot?: string | null) => string;
    nextReqid: () => string;
    generateFallbackSid: () => string;
    postBatchexecute: (options: RpcRequestOptions) => Promise<{ response: Response; text: string }>;
    mergeAbortSignals: (signals: Array<AbortSignal | null | undefined>) => AbortSignal | undefined;
}

import { GeminiProtocol } from "../../../protocol/gemini/protocol.js";
import { generateFallbackSid } from "./credentialManager.js";

function getProtocol(): GeminiProtocolModule {
    return GeminiProtocol;
}

const nextReqid = GeminiProtocol.createReqidGenerator();
const recentRpcRequests = new Map<string, string>();

export function isOwnRpcRequest(requestId: unknown, sid: string): boolean {
    return typeof requestId === 'string' && recentRpcRequests.get(requestId) === sid;
}

    function getApiUrl(slot?: string | null): string {
        if (slot && slot !== "default") {
            let t = slot.startsWith("/") ? slot : (slot.startsWith("u/") ? `/${slot}` : slot.replace(/^u/, "/u/"));
            return `https://gemini.google.com${t}/_/BardChatUi/data/batchexecute`;
        }
        return GEMINI_API_URL;
    }

    function mergeAbortSignals(signals: Array<AbortSignal | null | undefined>): AbortSignal | undefined {
        const active = signals.filter((s): s is AbortSignal => !!s);
        if (active.length === 0) return undefined;
        if (active.length === 1) return active[0];
        return AbortSignal.any(active);
    }

    async function postBatchexecute(options: RpcRequestOptions): Promise<{ response: Response; text: string }> {
        const {
            api,
            rpcids,
            fReq,
            cred,
            sourcePath = "/app",
            timeoutMs = 0,
            signal
        } = options;

        const P = getProtocol();
        const sid = String(cred?.sid || generateFallbackSid());
        const requestId = nextReqid();
        const params = new URLSearchParams({
            rpcids,
            "source-path": sourcePath,
            bl: cred?.bl || P.BL_FALLBACK,
            "f.sid": sid,
            _reqid: requestId,
            rt: "c"
        });

        const body = new URLSearchParams();
        body.append("f.req", fReq);
        if (cred?.at) body.append("at", cred.at);

        let controller: AbortController | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        if (timeoutMs > 0 && typeof AbortController !== "undefined") {
            controller = new AbortController();
            timeoutId = setTimeout(() => {
                try { controller?.abort(new DOMException('Gemini RPC request timed out', 'TimeoutError')); } catch (_) {}
            }, timeoutMs);
        }

        try {
            // Chromium attributes isolated-world fetches to the tab's origin too.
            // Do not re-capture our own requests (which may use a fallback sid).
            recentRpcRequests.set(requestId, sid);
            if (recentRpcRequests.size > 128) {
                const oldest = recentRpcRequests.keys().next();
                if (!oldest.done) recentRpcRequests.delete(oldest.value);
            }
            const resp = await fetch(`${api}?${params}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                    "X-Same-Domain": "1"
                },
                body: body.toString(),
                credentials: "include",
                signal: mergeAbortSignals([signal, controller ? controller.signal : null])
            });
            let text = '';
            try {
                text = await resp.text();
            } catch (error) {
                if (resp.ok || signal?.aborted) throw error;
            }
            return { response: resp, text };
        } catch (error) {
            if (controller?.signal.aborted && !signal?.aborted) throw controller.signal.reason;
            throw error;
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

export { getApiUrl, postBatchexecute };

const GeminiClientRpcClient: GeminiClientRpcClientModule = {
    GEMINI_API_URL,
    getProtocol,
    getApiUrl,
    nextReqid,
    generateFallbackSid,
    postBatchexecute,
    mergeAbortSignals
};

export default GeminiClientRpcClient;
