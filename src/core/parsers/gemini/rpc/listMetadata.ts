import { GeminiProtocol } from '../../../protocol/protocol.js';
import { GEMINI_JSPB_SCHEMA, normId, cleanTitle, isRealTitle } from './extractors.js';
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

/** A characterized metadata-only detail page uses list rows at inner[2], not arbitrary scalars. */
export function findMetadataOnlyConversation(inner: unknown, targetId?: string): { id: string; title: string } | undefined {
    if (!Array.isArray(inner) || inner[0] !== null || inner[1] !== null) return undefined;
    const rows: unknown = inner[GEMINI_JSPB_SCHEMA.INNER.METADATA_ONLY_LIST];
    if (!Array.isArray(rows)) return undefined;
    const matches = rows.filter((row: unknown): row is [string, string, ...unknown[]] =>
        Array.isArray(row) && typeof row[0] === 'string' && row[0].startsWith('c_')
        && typeof row[1] === 'string' && (!targetId || normId(row[0]) === normId(targetId)));
    if (matches.length !== 1) return undefined;
    return { id: matches[0][0], title: cleanTitle(matches[0][1]) };
}
