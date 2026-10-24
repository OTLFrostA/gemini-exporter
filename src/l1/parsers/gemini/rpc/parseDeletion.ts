import { geminiResponse, type GeminiResponseEnvelope } from './responseEnvelope.js';
import { GeminiProtocol } from '../../../protocol/gemini/protocol.js';

/** The Detail RPC itself must contain the Gemini 1167 business error; a LIST error in the
 * same batchexecute envelope is not evidence that the target conversation disappeared. */
export function isConfirmedGeminiDetailNotFound(responseText: string | GeminiResponseEnvelope): boolean {
    const top = geminiResponse(responseText).rows(GeminiProtocol.RPCS.DETAIL);
    return top.some(row => GeminiProtocol.isConfirmedDeletedError(JSON.stringify(row[5] ?? null), 200));
}

/** Only a request-bound DELETE RPC with a matching positive response may delete local facts. */
export function parseConfirmedGeminiDeletion(requestBody: string, responseText: string | GeminiResponseEnvelope): string | null {
    try {
        const raw = new URLSearchParams(requestBody).get('f.req');
        if (!raw) return null;
        const batch: unknown = JSON.parse(raw);
        if (!Array.isArray(batch) || !Array.isArray(batch[0])) return null;
        const calls = batch[0] as unknown[];
        const deletes = calls.filter(call => Array.isArray(call)
            && call[0] === GeminiProtocol.RPCS.DELETE && typeof call[1] === 'string');
        if (deletes.length !== 1) return null;
        const argumentsJson: unknown = JSON.parse((deletes[0] as string[])[1]);
        const ids = JSON.stringify(argumentsJson).match(/c_[a-f0-9]{8,64}/gi);
        if (!ids || ids.length !== 1) return null;
        const sourceId = ids[0].toLowerCase();

        const response = geminiResponse(responseText);
        const replies = response.rows(GeminiProtocol.RPCS.DELETE);
        if (replies.length !== 1) return null;
        const reply = replies[0];
        if (typeof reply[2] !== 'string' || reply[5] != null) return null;
        const confirmation = response.payload(GeminiProtocol.RPCS.DELETE).inner;
        if (!Array.isArray(confirmation)) return null;
        // Native GzXR5e is a void RPC: a successful reply contains [] (captured live).
        // The unique outgoing DELETE binds that acknowledgement to its target.
        const voidSuccess = confirmation.length === 0;
        const echoedSuccess = confirmation.length === 2 && confirmation[0] === null && confirmation[1] === sourceId;
        if (!voidSuccess && !echoedSuccess) return null;
        return sourceId.slice(2);
    } catch { return null; }
}
