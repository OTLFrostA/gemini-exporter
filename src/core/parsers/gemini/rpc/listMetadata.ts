import { GeminiProtocol } from '../../../protocol/protocol.js';
import { normId, cleanTitle, isRealTitle } from './extractors.js';
import { extractInnerPayload } from './payload.js';
import { extractListItemTimestamp } from './parseList.js';
import { restoreConversationIndex, type DomainConversationIndex } from '../../../domain/conversationIndex.js';

/** Metadata returned beside detail belongs to the requested conversation, never a nearby row. */
export function findListConversationMetadata(top: unknown, targetId: string): DomainConversationIndex | undefined {
    const protocol = GeminiProtocol;
    if (!targetId || !Array.isArray(top)) return undefined;
    for (const rpc of [protocol.RPCS.LIST, protocol.RPCS.LEGACY_LIST]) {
        const { inner } = extractInnerPayload(top, { wrb: protocol.WRB, rpcId: rpc });
        if (!Array.isArray(inner)) continue;
        const rows = [inner[1], inner[2], inner[0]].find(Array.isArray) ?? [];
        const item = rows.find((row: unknown) => Array.isArray(row) && typeof row[0] === 'string' && normId(row[0]) === normId(targetId));
        if (!item) continue;
        const title = cleanTitle(item[1]);
        const realTitle = isRealTitle(title, normId(targetId));
        const updatedAt = extractListItemTimestamp(item);
        return restoreConversationIndex({ providerId: 'gemini', id: normId(targetId), title: realTitle ? title : '',
            titleSource: realTitle ? 'rpc' : 'default', cloudAvailability: 'available', hasTakeoutImport: false,
            ...(updatedAt !== null ? { updatedAt } : {}) });
    }
    return undefined;
}

