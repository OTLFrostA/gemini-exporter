import { payloadToMs } from '../../../parsers/gemini/rpc/payload.js';
import type { DetailParseResult } from './detailTypes.js';

const absent = (value: unknown): boolean => value == null || Array.isArray(value) && value.every(absent);

/** Recognize only the captured native empty-turn shape. Unknown payloads remain errors. */
export function hasConfirmedEmptyTurns(page: DetailParseResult, conversationId: string): boolean {
    const inner = page.transport.decodedPayload;
    if (page.conversation.detail.messages.length || page.conversation.detail.assets.length
        || page.transport.nextPageToken || page.evidence?.rejectedTurns
        || page.diagnostics.some(d => d.code === 'GEMINI_SCHEMA_DRIFT')
        || !Array.isArray(inner) || !Array.isArray(inner[0]) || !inner[0].length
        || !inner.slice(1).every(absent)) return false;
    return inner[0].every((turn: unknown) => {
        if (!Array.isArray(turn) || !Array.isArray(turn[0]) || turn[0][0] !== `c_${conversationId.replace(/^c_/, '')}`
            || turn[0].length !== 2 || payloadToMs(turn[4]) === null
            || typeof turn[0][1] !== 'string' || !turn[0][1].startsWith('r_')
            || JSON.stringify(turn[2]) !== '[[""]]') return false;
        const model: unknown = turn[3];
        if (!Array.isArray(model) || !Array.isArray(model[0]) || !model[0].length) return false;
        if (!turn.every((value, index) => [0, 2, 3, 4].includes(index) || absent(value))) return false;
        if (!model.every((value, index) => index === 0 || absent(value)
            || index === 3 && typeof value === 'string' && value.startsWith('rc_')
            || index === 8 && typeof value === 'string' && /^[A-Z]{2}$/.test(value)
            || index === 24 && value === 1)) return false;
        return model[0].every((candidate: unknown) => Array.isArray(candidate)
            && typeof candidate[0] === 'string' && candidate[0].startsWith('rc_')
            && JSON.stringify(candidate[1]) === '[""]'
            && candidate.every((value, index) => index < 2 || absent(value)));
    });
}
