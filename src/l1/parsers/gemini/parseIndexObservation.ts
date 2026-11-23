import type { DomainConversationIndex } from '../../../l2/conversationIndex.js';
import { semanticTitleSource } from '../shared/parseIndexMetadata.js';
import { normalizeTimestamp } from '../shared/time.js';
import { cleanTitle, isRealTitle, isBrandPlaceholderTitle } from '../../../shared/utils/titleText.js';
import { normId } from '../../../shared/utils/pathUtils.js';
import { isReservedRoute } from '../../protocol/gemini/url.js';
import type { GeminiIndexObservationInput } from './shared/structuredTypes.js';
export type { GeminiIndexObservationInput } from './shared/structuredTypes.js';
type GeminiIndexObservationSource = 'rpc-list' | 'detail' | 'dom';
export function parseGeminiIndexObservation(value: unknown, source: GeminiIndexObservationSource): { conversationId: string; fields: Omit<DomainConversationIndex, 'key'> } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Gemini index observation');
    const row = {
        id: 'id' in value ? value.id : undefined,
        title: 'title' in value ? value.title : undefined,
        titleSource: 'titleSource' in value ? value.titleSource : undefined,
        createdAt: 'createdAt' in value ? value.createdAt : undefined,
        updatedAt: 'updatedAt' in value ? value.updatedAt : undefined,
    };
    if (typeof row.id !== 'string') throw new TypeError('Index observation has no identity');
    const id = normId(row.id);
    if (!id || id === 'unknown' || isReservedRoute(id)) throw new TypeError('Invalid conversation identity');
    const candidate = typeof row.title === 'string' ? cleanTitle(row.title) : '';
    const title = isRealTitle(candidate, id) || row.titleSource === 'takeout' && candidate && !isBrandPlaceholderTitle(candidate) ? candidate : undefined;
    const createdAt = normalizeTimestamp(row.createdAt), updatedAt = normalizeTimestamp(row.updatedAt);
    return { conversationId: id, fields: {
        ...(title ? { title, titleSource: semanticTitleSource(typeof row.titleSource === 'string' ? row.titleSource : source === 'rpc-list' ? 'rpc' : 'dom') } : {}),
        ...(createdAt !== undefined ? { createdAt } : {}), ...(updatedAt !== undefined ? { updatedAt } : {}) } };
}
