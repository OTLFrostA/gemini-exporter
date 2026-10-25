import { GeminiProtocol, CrossWorldEvents } from '../../../protocol/gemini/protocol.js';
import { readGeminiDetailRequest } from '../../../parsers/gemini/rpc/detailRequest.js';
import { readGeminiListRequest } from '../../../parsers/gemini/rpc/listRequest.js';
import { parseConfirmedGeminiDeletion } from '../../../parsers/gemini/rpc/parseDeletion.js';
import type { GeminiConversationDeletedPayload, GeminiNetworkBatchexecutePayload } from '../../../protocol/gemini/events.js';
import type { GeminiCaptureContext, GeminiResponseHandler } from './router.js';

/** Own the batchexecute request/response correlation and cross-world delivery.
 * LIST/DETAIL are decoded in ISOLATED; DELETE retains its existing evidence check
 * on each side of that trust boundary. Parser internals are independent of routing.
 */
export function batchexecuteHandler(context: GeminiCaptureContext): GeminiResponseHandler {
    return {
        captureLimit: 3 * 1024 * 1024,
        start() {},
        complete(body, text, truncated, successful) {
            const { slot, url, requestAccountObservation, requestedAt } = context;
            if (successful && !truncated && requestAccountObservation
                && requestAccountObservation.providerAccountId !== 'default') {
                const id = parseConfirmedGeminiDeletion(body, text);
                if (id) {
                    const payload: GeminiConversationDeletedPayload = {
                        id, slot, requestAccountObservation, url, requestBody: body, responseText: text,
                    };
                    window.postMessage({ type: CrossWorldEvents.CONVERSATION_DELETED, payload }, location.origin);
                }
            }
            // Only relay supported RPC bodies, rather than every wrb.fr response.
            if (!text.includes(GeminiProtocol.RPCS.LIST) && !text.includes(GeminiProtocol.RPCS.DETAIL)) return;
            const listRequest = readGeminiListRequest(body);
            const detailRequest = readGeminiDetailRequest(body);
            const payload: GeminiNetworkBatchexecutePayload = {
                text: text.slice(0, 3000000),
                ...(listRequest ? { listRequest } : {}),
                ...(detailRequest ? { detailRequest } : {}),
                requestedAt, requestAccountObservation,
                truncated: truncated || !successful || text.length > 3000000,
                slot, url,
            };
            window.postMessage({ type: CrossWorldEvents.NETWORK_BATCHEXECUTE, payload }, location.origin);
        },
        end() {},
    };
}
