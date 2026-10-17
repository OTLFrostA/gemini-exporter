import { fixtureAccountFor } from './domainFixture.js';
import type { ResourceAcquisitionHints } from '../../src/core/resources/resourceAcquisition.js';
import { validateParserDomain } from '../../src/core/domain/runtimeValidation.js';
import { historicalFixture } from './nativeFixture.js';


import { composeDomainDocument } from '../../src/core/document/compose/composeDomainDocument.js';


/** Exercise the public semantic and resource boundaries independently. */
export async function composeFixture(domain: DomainConversationWithDetail, resourceHints: LegacyResourceHints = {}, sourceVersion?: number, acquisitionHints: ResourceAcquisitionHints = {}) {
    return { ...composeDomainDocument(validateParserDomain(sourceVersion === undefined ? domain : { ...domain, index: { ...domain.index, updatedAt: sourceVersion } }), fixtureAccountFor(validateParserDomain(sourceVersion === undefined ? domain : { ...domain, index: { ...domain.index, updatedAt: sourceVersion } }))), resources: await fixtureBindings(domain, resourceHints, acquisitionHints) };
}

import type { ConversationRecordInput } from './recordFixture/conversationRecord.js';

/** Historical fixture decoding feeds the same native composer and preparation APIs as production. */
export async function parseFixture(raw: ConversationRecordInput) {
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    const composed = await composeFixture(parsed.conversation, parsed.resourceHints, parsed.sourceVersion, parsed.acquisitionHints);
    return { ...composed, domain: parsed.conversation, sourceVersion: parsed.sourceVersion, diagnostics: [...parsed.diagnostics, ...composed.diagnostics] };
}

import type { LegacyResourceHints } from '../../src/core/parsers/shared/resources/resourceHints.js';
import type { DomainConversationWithDetail } from '../../src/core/domain/conversation.js';
import { normalizeArchiveResourceName } from '../../src/core/export/assets/archivePath.js';
import { decodeDataUrlAsset, buildDataUrlStorageRef, sha256Hex } from '../../src/core/export/assets/index.js';
import type { ResourceBindings } from '../../src/core/document/ast/ast.js';

/** Resource preparation is a side channel; never replace Domain identities with export identities. */
async function fixtureBindings(conversation: DomainConversationWithDetail, hints: LegacyResourceHints = {}, acquisitionHints: ResourceAcquisitionHints = {}): Promise<ResourceBindings> {
    const bindings: Record<string, string> = {};
    for (const asset of conversation.detail.assets) {
        const path = hints[asset.id]?.archivePath;
        const dataBase64 = acquisitionHints[asset.id]?.dataBase64;
        if (path) {
            bindings[asset.id] = normalizeArchiveResourceName(path);
        } else if (dataBase64 || asset.document?.contentMarkdown?.trim()) {
            // Preserve the existing content-addressed archive namespace for inline bytes.
            let bytes: Uint8Array;
            if (dataBase64) {
                const unpadded = dataBase64.replace(/^data:[^,]*,/i, '').replace(/\s+/g, '');
                const raw = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
                const result = await decodeDataUrlAsset(`data:${asset.mediaType ?? 'application/octet-stream'};base64,${raw}`);
                if (!result.ok) continue;
                bindings[asset.id] = result.storageRef;
                continue;
            } else bytes = new TextEncoder().encode(asset.document!.contentMarkdown!.trim());
            bindings[asset.id] = buildDataUrlStorageRef(await sha256Hex(bytes), asset.mediaType ?? 'application/octet-stream');
        } else {
            const uri = [acquisitionHints[asset.id]?.url, acquisitionHints[asset.id]?.sourceUrl, asset.sourceUri].find(value => /^data:/i.test(value ?? ''));
            if (!uri) continue;
            const decoded = await decodeDataUrlAsset(uri);
            if (decoded.ok) bindings[asset.id] = decoded.storageRef;
        }
    }
    return bindings;
}

/** Renderer fixtures declare available resources; production receipts come from actual writes. */
export async function fixtureResourceResults(domain: DomainConversationWithDetail, hints: LegacyResourceHints = {}, acquisitionHints: ResourceAcquisitionHints = {}) {
    return Object.entries(await fixtureBindings(domain, hints, acquisitionHints)).map(([resourceId, path]) => ({ ok: true as const, resourceId, value: { path } }));
}
