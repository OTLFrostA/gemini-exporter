import { validateParserDomain, type TrustedDomain } from '../../domain/runtimeValidation.js';
import { isTitleSource } from '../../domain/titleAuthority.js';
import { parseIndexMetadata } from '../shared/parseIndexMetadata.js';

const fields = new Set(['providerId', 'id', 'title', 'titleSource', 'createdAt', 'url', 'completeness', 'assets', 'messages']);
/** Upgrade-only reader for the retired flat Domain snapshot. Current reads reject it. */
export function parseDomainSnapshotV2(value: unknown, savedAt?: number): TrustedDomain {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('Invalid v2 Domain snapshot');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !fields.has(key)) || typeof row.providerId !== 'string'
        || typeof row.id !== 'string' || typeof row.title !== 'string'
        || row.titleSource !== undefined && (typeof row.titleSource !== 'string' || !isTitleSource(row.titleSource))
        || row.createdAt !== undefined && (typeof row.createdAt !== 'number' || !Number.isFinite(row.createdAt))
        || row.url !== undefined && typeof row.url !== 'string') throw new TypeError('Invalid v2 Domain metadata');
    // The common validator establishes body schema and closure; this parser does not copy its schema.
    return validateParserDomain({ index: parseIndexMetadata({ providerId: row.providerId, id: row.id, title: row.title,
        ...(typeof row.titleSource === 'string' && isTitleSource(row.titleSource) ? { titleSource: row.titleSource } : {}),
        ...(typeof row.createdAt === 'number' ? { createdAt: row.createdAt } : {}),
        ...(typeof row.url === 'string' ? { url: row.url } : {}), ...(savedAt !== undefined ? { updatedAt: savedAt } : {}),
        messageCount: Array.isArray(row.messages) ? row.messages.length : undefined }),
        detail: { completeness: row.completeness as 'complete' | 'partial' | 'unknown',
            assets: row.assets as import('../../domain/conversationDetail.js').DomainAsset[],
            messages: row.messages as import('../../domain/conversationDetail.js').DomainMessage[] } });
}
