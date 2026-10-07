import type { DomainGeneratedMediaIdentity as GeneratedMediaIdentity } from '../../../domain/conversationDetail.js';

/** Takeout activity timestamps have second precision; RPC retains milliseconds. */
export function eventSecond(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value / 1000);
}

export function normalizeRequestId(id: unknown): string | null {
    if (typeof id !== 'string' || !id.trim()) return null;
    const clean = id.trim().toLowerCase().replace(/^r_/, '');
    return /^[0-9a-f]{16}$/.test(clean) ? clean : (clean.length >= 8 ? clean : null);
}

export function normalizeChatId(id: unknown): string {
    if (typeof id !== 'string' && typeof id !== 'number') return '';
    return String(id).trim().replace(/^c_/, '');
}

export function sameGenerationEvent(a: GeneratedMediaIdentity, b: GeneratedMediaIdentity): boolean {
    const aChat = normalizeChatId(a.chatId);
    const bChat = normalizeChatId(b.chatId);
    if (!aChat || !bChat || aChat !== bChat) {
        return false;
    }

    const aReq = normalizeRequestId(a.providerRequestId);
    const bReq = normalizeRequestId(b.providerRequestId);
    if (aReq && bReq) {
        return aReq === bReq;
    }
    return a.generationOrdinal === b.generationOrdinal
        && eventSecond(a.time) !== null && eventSecond(a.time) === eventSecond(b.time)
        && !!a.prompt && a.prompt.trim() === b.prompt?.trim();
}
