import { robustFirstPayload } from './extractors.js';
import { GeminiProtocol } from '../../../protocol/protocol.js';

/** Only a request-bound DELETE RPC with a matching positive response may delete local facts. */
export function parseConfirmedGeminiDeletion(requestBody: string, responseText: string): string | null {
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

        const response: unknown = robustFirstPayload(responseText);
        if (!Array.isArray(response)) return null;
        const replies = response.filter(row => Array.isArray(row)
            && row[0] === GeminiProtocol.WRB && row[1] === GeminiProtocol.RPCS.DELETE);
        if (replies.length !== 1) return null;
        const reply = replies[0] as unknown[];
        if (typeof reply[2] !== 'string' || reply[5] != null) return null;
        const confirmation: unknown = JSON.parse(reply[2]);
        if (!Array.isArray(confirmation) || confirmation[0] !== null || confirmation[1] !== sourceId) return null;
        return sourceId.slice(2);
    } catch { return null; }
}
