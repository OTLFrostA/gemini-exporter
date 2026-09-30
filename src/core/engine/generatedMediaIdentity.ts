import type { GeneratedMediaIdentity } from '../../types/conversation.js';

/** Takeout activity timestamps have second precision; RPC retains milliseconds. */
function eventSecond(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value / 1000);
}

export function normalizeRequestId(id: unknown): string | null {
    if (typeof id !== 'string' || !id.trim()) return null;
    const clean = id.trim().toLowerCase().replace(/^r_/, '');
    return /^[0-9a-f]{16}$/.test(clean) ? clean : (clean.length >= 8 ? clean : null);
}

export function sameGenerationEvent(a: GeneratedMediaIdentity, b: GeneratedMediaIdentity): boolean {
    const aReq = normalizeRequestId(a.providerRequestId);
    const bReq = normalizeRequestId(b.providerRequestId);
    if (aReq && bReq) {
        return aReq === bReq;
    }
    return a.chatId === b.chatId && a.generationOrdinal === b.generationOrdinal
        && eventSecond(a.time) !== null && eventSecond(a.time) === eventSecond(b.time)
        && !!a.prompt && a.prompt.trim() === b.prompt?.trim();
}

/** Resolve only a unique prompt/time event and its sole response, never a first/last turn guess. */
export function findGenerationModelMessage(chat: any, generation: GeneratedMediaIdentity): any | null {
    if (chat?.id && String(chat.id).replace(/^c_/, '') !== generation.chatId) return null;
    const messages = Array.isArray(chat?.messages) ? chat.messages : [];

    const targetReq = normalizeRequestId(generation.providerRequestId);
    if (targetReq) {
        // 1. Direct match on model message providerRequestId
        const direct = messages.filter((m: any) =>
            (m.role === 'model' || m.role === 'assistant') &&
            normalizeRequestId(m.providerRequestId) === targetReq
        );
        if (direct.length === 1) return direct[0];

        // 2. User message whose id or providerRequestId matches targetReq
        for (let i = 0; i < messages.length; i++) {
            const m = messages[i];
            if (m.role === 'user' && (normalizeRequestId(m.providerRequestId) === targetReq || normalizeRequestId(m.id) === targetReq || normalizeRequestId(m.turnId) === targetReq)) {
                for (let j = i + 1; j < messages.length; j++) {
                    if (messages[j].role === 'model' || messages[j].role === 'assistant') {
                        return messages[j];
                    }
                }
            }
        }
    }

    const marked = messages.filter((m: any) => m.generation && sameGenerationEvent(m.generation, generation));
    if (marked.length === 1) return marked[0];
    if (marked.length > 1 || eventSecond(generation.time) === null || !generation.prompt) return null;
    const users = messages.map((m: any, index: number) => ({ m, index })).filter(({ m }: any) =>
        m.role === 'user' && typeof m.content === 'string'
        && m.content.trim() === generation.prompt!.trim()
        && eventSecond(m.timestamp) === eventSecond(generation.time));
    if (users.length !== 1) return null;
    const models = [];
    for (let i = users[0].index + 1; i < messages.length && messages[i].role !== 'user'; i++) {
        if (messages[i].role === 'model' || messages[i].role === 'assistant') models.push(messages[i]);
    }
    return models.length === 1 ? models[0] : null;
}

export function hasGenerationImage(message: any, generation: GeneratedMediaIdentity): boolean {
    const images = [...(message?.images || []), ...(message?.attachments || [])]
        .filter((image: any) => image && (image.isGenerated === true || image.type === 'image'));

    const genReq = normalizeRequestId(generation.providerRequestId);
    const genOrd = generation.imageOrdinal;

    // Check images with providerRequestId
    if (genReq) {
        for (const image of images) {
            const imgReq = normalizeRequestId(image.providerRequestId || image.generation?.providerRequestId);
            if (imgReq === genReq) {
                const imgOrd = image.imageOrdinal ?? image.generation?.imageOrdinal ?? 0;
                const targetOrd = genOrd ?? 0;
                if (imgOrd === targetOrd) {
                    if (!image.generation) image.generation = { ...generation, turnId: message.id };
                    message.generation = { ...generation, turnId: message.id };
                    return true;
                }
            }
        }
        // If message itself is tagged with this providerRequestId and contains images
        const msgReq = normalizeRequestId(message.providerRequestId || message.generation?.providerRequestId);
        if (msgReq === genReq && images.length > 0) {
            if ((genOrd === undefined || genOrd === 0) && (generation.imageCount === 1 || images.length === 1)) {
                if (!images[0].generation) images[0].generation = { ...generation, turnId: message.id };
                message.generation = { ...generation, turnId: message.id };
                return true;
            }
            for (const image of images) {
                const imgOrd = image.imageOrdinal ?? image.generation?.imageOrdinal ?? 0;
                if (imgOrd === (genOrd ?? 0)) {
                    if (!image.generation) image.generation = { ...generation, turnId: message.id };
                    message.generation = { ...generation, turnId: message.id };
                    return true;
                }
            }
        }
    }

    if (images.some((image: any) => image.generation && sameGenerationEvent(image.generation, generation)
        && generation.imageOrdinal !== undefined && image.generation.imageOrdinal === generation.imageOrdinal)) return true;

    // A single-image event has an unambiguous image ordinal. Multi-image events need explicit ordinals.
    if (generation.imageCount !== 1 || (generation.imageOrdinal !== undefined && generation.imageOrdinal !== 0)) return false;
    const keys = new Set(images.map((image: any) => image.sourceUrl || image.originalUrl || image.src || image.url || image.localName)
        .filter(Boolean));
    if (keys.size !== 1) return false;
    for (const image of images) image.generation = { ...generation, turnId: message.id };
    message.generation = { ...generation, turnId: message.id };
    return true;
}
