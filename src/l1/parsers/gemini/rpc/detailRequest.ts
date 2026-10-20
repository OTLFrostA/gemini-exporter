import type { ConversationKey } from '../../../../l2/conversationKey.js';

export interface GeminiDetailRequestContext { conversationId: ConversationKey['conversationId']; requestCursor: string | null }

/** Only a single, characterized detail call establishes a source cursor. */
export function readGeminiDetailRequest(body: unknown): GeminiDetailRequestContext | null {
    if (typeof body !== 'string') return null;
    try {
        const batch: unknown = JSON.parse(new URLSearchParams(body).get('f.req') || 'null');
        if (!Array.isArray(batch)) return null;
        const calls = batch.flat().filter((call: unknown) => Array.isArray(call) && call[0] === 'hNvQHb');
        if (calls.length !== 1 || typeof calls[0][1] !== 'string') return null;
        const args: unknown = JSON.parse(calls[0][1]);
        if (!Array.isArray(args) || args.length !== 8 || typeof args[0] !== 'string' || !/^c_[\w-]+$/.test(args[0])
            || (args[1] !== null && args[1] !== 10) || (args[2] !== null && typeof args[2] !== 'string')
            || args[3] !== 1 || JSON.stringify(args[4]) !== '[1]' || JSON.stringify(args[5]) !== '[4]'
            || args[6] !== null || args[7] !== 1) return null;
        return { conversationId: args[0].slice(2), requestCursor: args[2] };
    } catch { return null; }
}
