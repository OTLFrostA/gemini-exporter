import type { DomainAsset, DomainGeneratedMediaIdentity } from '../../../domain/conversationDetail.js';
import { eventSecond, normalizeChatId } from './generationEvent.js';

export interface ResourceIdentity {
    assetId: string;
    sourceUris: readonly string[];
    generation?: Partial<DomainGeneratedMediaIdentity>;
}
export function resourceIdentity(asset: DomainAsset): ResourceIdentity {
    return { assetId: asset.id, sourceUris: asset.source?.uri ? [asset.source.uri] : [], generation: asset.generation };
}
function requestId(generation?: Partial<DomainGeneratedMediaIdentity>): string {
    return generation?.providerRequestId?.trim().replace(/^r_/i, '').toLowerCase() ?? '';
}
function ordinal(generation?: Partial<DomainGeneratedMediaIdentity>): number | undefined {
    const value = generation?.imageOrdinal ?? (generation?.imageCount === 1 ? 0 : undefined);
    return value !== undefined && Number.isInteger(value) && value >= 0
        && (generation?.imageCount === undefined || value < generation.imageCount) ? value : undefined;
}
function conflicts(a: ResourceIdentity, b: ResourceIdentity, chatId: string): boolean {
    const x = a.generation, y = b.generation;
    if ([x, y].some(g => g?.chatId && normalizeChatId(g.chatId) !== chatId)) return true;
    if (requestId(x) && requestId(y) && requestId(x) !== requestId(y)) return true;
    if (x?.prompt?.trim() && y?.prompt?.trim() && x.prompt.trim() !== y.prompt.trim()) return true;
    if (eventSecond(x?.time) !== null && eventSecond(y?.time) !== null && eventSecond(x?.time) !== eventSecond(y?.time)) return true;
    return ordinal(x) !== undefined && ordinal(y) !== undefined && ordinal(x) !== ordinal(y);
}
function eventMatches(a: ResourceIdentity, b: ResourceIdentity, chatId: string): boolean {
    const x = a.generation, y = b.generation;
    return normalizeChatId(x?.chatId) === chatId && normalizeChatId(y?.chatId) === chatId
        && !!x?.prompt?.trim() && x.prompt.trim() === y?.prompt?.trim()
        && eventSecond(x.time) !== null && eventSecond(x.time) === eventSecond(y?.time);
}

/** Exact source evidence first; cross-source events require a unique event and image position.
 * Generation ordinals are source-local counters, never a cross-source relationship key. */
export function findResourceMatch(chat: string, requested: ResourceIdentity, candidates: readonly ResourceIdentity[]): number | null {
    const chatId = normalizeChatId(chat);
    if (!chatId || requested.generation?.chatId && normalizeChatId(requested.generation.chatId) !== chatId) return null;
    const uriMatch = (candidate: ResourceIdentity) => requested.sourceUris.some(uri => !!uri && candidate.sourceUris.includes(uri));
    const ids = candidates.filter(candidate => !!requested.assetId && candidate.assetId === requested.assetId);
    const uris = candidates.filter(uriMatch);
    if (ids.length > 1 || ids.some(candidate => conflicts(requested, candidate, chatId))) return null;
    if (ids.length && uris.length && new Set([...ids, ...uris]).size > 1) return null;
    const exact = candidates.filter(candidate => uriMatch(candidate) || (requested.assetId && candidate.assetId === requested.assetId
        && (!requested.sourceUris.length || !candidate.sourceUris.length)));
    if (exact.length) return exact.length === 1 && !conflicts(requested, exact[0], chatId) ? candidates.indexOf(exact[0]) : null;

    const position = ordinal(requested.generation);
    if (position === undefined) return null;
    const events = candidates.filter(candidate => eventMatches(requested, candidate, chatId)
        && (!requestId(requested.generation) || !requestId(candidate.generation) || requestId(requested.generation) === requestId(candidate.generation)));
    if (!events.length || events.some(candidate => conflicts(requested, { ...candidate, generation: { ...candidate.generation, imageOrdinal: undefined, imageCount: undefined } }, chatId))) return null;
    // Distinct request tokens or source-local event counters distinguish otherwise identical events.
    if (events.some(a => events.some(b => requestId(a.generation) && requestId(b.generation)
        ? requestId(a.generation) !== requestId(b.generation)
        : a.generation?.generationOrdinal !== b.generation?.generationOrdinal))) return null;
    const positions = events.map(candidate => ordinal(candidate.generation));
    if (positions.some(value => value === undefined) || new Set(positions).size !== events.length) return null;
    const matches = events.filter(candidate => ordinal(candidate.generation) === position);
    return matches.length === 1 ? candidates.indexOf(matches[0]) : null;
}

/** Both directions must be unique before bytes can be rebound to another source's asset. */
export function matchResourceSets(chatId: string, targets: readonly ResourceIdentity[], sources: readonly ResourceIdentity[]): Array<{ target: number; source: number }> {
    const matches: Array<{ target: number; source: number }> = [];
    targets.forEach((target, index) => {
        const source = findResourceMatch(chatId, target, sources);
        if (source !== null && findResourceMatch(chatId, sources[source], targets) === index) matches.push({ target: index, source });
    });
    return matches;
}
