import { historicalFixture } from './nativeFixture.js';


import { composeDomainDocument } from '../../src/core/document/compose/composeDomainDocument.js';
import { prepareDomainResources } from '../../src/core/export/assets/prepareDomainResources.js';

/** Exercise the public semantic and resource boundaries independently. */
export async function composeFixture(domain: DomainConversationDetail, resourceHints: LegacyResourceHints = {}) {
    return { ...composeDomainDocument(domain), resources: await prepareDomainResources(await fixtureResourceResults(domain, resourceHints)) };
}

import type { ConversationRecordInput } from '../../src/core/compatibility/record/conversationRecord.js';

/** Historical fixture decoding feeds the same native composer and preparation APIs as production. */
export async function parseFixture(raw: ConversationRecordInput) {
    const parsed = historicalFixture(raw, { providerId: 'gemini' });
    const composed = await composeFixture(parsed.conversation, parsed.resourceHints);
    return { ...composed, domain: parsed.conversation, diagnostics: [...parsed.diagnostics, ...composed.diagnostics] };
}

import type { LegacyResourceHints } from '../../src/core/parsers/shared/resources/resourceHints.js';
import type { DomainConversationDetail } from '../../src/core/domain/conversationDetail.js';
import { normalizeArchiveResourceName } from '../../src/core/export/assets/archivePath.js';
import { decodeDataUrlAsset, buildDataUrlStorageRef, sha256Hex } from '../../src/core/export/assets/index.js';
import type { ResourceBindings } from '../../src/core/document/ast/ast.js';

/** Resource preparation is a side channel; never replace Domain identities with export identities. */
async function fixtureBindings(conversation: DomainConversationDetail, hints: LegacyResourceHints = {}): Promise<ResourceBindings> {
    const bindings: Record<string, string> = {};
    for (const asset of conversation.assets) {
        const path = hints[asset.id]?.archivePath;
        if (asset.failureReason && !asset.dataBase64 && !asset.document?.contentMarkdown) continue;
        if (path) {
            bindings[asset.id] = normalizeArchiveResourceName(path);
        } else if (asset.dataBase64 || asset.document?.contentMarkdown?.trim()) {
            // Preserve the existing content-addressed archive namespace for inline bytes.
            let bytes: Uint8Array;
            if (asset.dataBase64) {
                const unpadded = asset.dataBase64.replace(/^data:[^,]*,/i, '').replace(/\s+/g, '');
                const raw = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, '=');
                const result = await decodeDataUrlAsset(`data:${asset.mediaType ?? 'application/octet-stream'};base64,${raw}`);
                if (!result.ok) continue;
                bindings[asset.id] = result.storageRef;
                continue;
            } else bytes = new TextEncoder().encode(asset.document!.contentMarkdown!.trim());
            bindings[asset.id] = buildDataUrlStorageRef(await sha256Hex(bytes), asset.mediaType ?? 'application/octet-stream');
        } else if (/^data:/i.test(asset.source?.uri ?? '')) {
            const decoded = await decodeDataUrlAsset(asset.source!.uri!);
            if (decoded.ok) bindings[asset.id] = decoded.storageRef;
        }
    }
    return bindings;
}

/** Renderer fixtures declare available resources; production receipts come from actual writes. */
export async function fixtureResourceResults(domain: DomainConversationDetail, hints: LegacyResourceHints = {}) {
    return Object.entries(await fixtureBindings(domain, hints)).map(([resourceId, path]) => ({ ok: true as const, resourceId, value: { path } }));
}
