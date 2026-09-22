// src/core/api/parser/payload.ts - Canonical batchexecute envelope unwrapper and payload extractor
// NOTE: Cannot import from extractors.ts (circular). Schema ref: GEMINI_JSPB_SCHEMA.ERROR_INFO.ERROR_SLOT = 5
const ERROR_SLOT = 5;

export interface InnerPayloadDiscoveryOptions {
    wrb?: string;
    rpcId?: string | string[];
    heuristicFilter?: (candidateStr: string) => boolean;
}

export interface InnerPayloadDiscoveryResult {
    inner: any | null;
    innerStr: string | null;
    isStandardWrb: boolean;
    bardError: string | null;
}

/**
 * Converts a JSPB timestamp candidate (either [seconds, nanos] tuple or numeric seconds/millis) to milliseconds.
 */
export function payloadToMs(val: unknown): number | null {
    if (!val) return null;
    if (Array.isArray(val) && typeof val[0] === "number" && val[0] > 1e9) {
        if (val[0] > 1e11) return Math.round(val[0]);
        const sec = val[0];
        const nano = typeof val[1] === "number" ? val[1] : 0;
        return Math.round(sec * 1000 + Math.floor(nano / 1e6));
    }
    if (typeof val === "number" && val > 1e9) {
        return val > 1e11 ? Math.round(val) : Math.round(val * 1000);
    }
    return null;
}

/**
 * Extracts and parses the inner JSON payload from a batchexecute top envelope array.
 * Supports standard [wrb, rpc, innerJsonStr] matching, heuristic fallback scanning,
 * and BardErrorInfo detection.
 */
export function extractInnerPayload(
    top: unknown,
    options?: InnerPayloadDiscoveryOptions
): InnerPayloadDiscoveryResult {
    const wrb = options?.wrb || "wrb.fr";
    const rpcTarget = options?.rpcId;
    const rpcList = Array.isArray(rpcTarget)
        ? rpcTarget
        : (rpcTarget ? [rpcTarget] : []);

    let innerStr: string | null = null;
    let isStandardWrb = false;

    if (Array.isArray(top)) {
        // 1. Standard wrb + rpc pattern matching
        if (rpcList.length > 0) {
            for (const item of top) {
                if (Array.isArray(item) && item[0] === wrb && rpcList.includes(item[1]) && typeof item[2] === "string") {
                    innerStr = item[2];
                    isStandardWrb = true;
                    break;
                }
            }
        }

        // 2. Heuristic fallback scanning
        if (!innerStr && options?.heuristicFilter) {
            for (const item of top) {
                if (Array.isArray(item) && typeof item[2] === "string" && options.heuristicFilter(item[2])) {
                    innerStr = item[2];
                    isStandardWrb = false;
                    break;
                }
            }
        }
    }

    let inner: any = null;
    if (innerStr) {
        try {
            inner = JSON.parse(innerStr);
        } catch { /* intentional: parse chunk candidate fallback */ }
    }

    // 3. Fallback: scanning raw nested string chunks in top if inner is still null
    if (!inner && Array.isArray(top)) {
        for (const item of top) {
            if (typeof item === "string" && item.startsWith("[[")) {
                try {
                    inner = JSON.parse(item);
                } catch { /* intentional: parse chunk candidate fallback */ }
            }
            if (inner) break;
        }
    }

    // 4. BardErrorInfo extraction when no inner payload could be discovered
    let bardError: string | null = null;
    if (!innerStr && !inner && Array.isArray(top)) {
        for (const item of top) {
            if (Array.isArray(item) && item[ERROR_SLOT]) {
                const str5 = JSON.stringify(item[ERROR_SLOT]);
                if (str5.includes("BardErrorInfo")) {
                    bardError = str5;
                    break;
                }
            }
        }
    }

    return {
        inner,
        innerStr,
        isStandardWrb,
        bardError
    };
}

const PayloadParser = {
    payloadToMs,
    extractInnerPayload
};

if (typeof module === "object" && module.exports) {
    module.exports = PayloadParser;
}

export default PayloadParser;
