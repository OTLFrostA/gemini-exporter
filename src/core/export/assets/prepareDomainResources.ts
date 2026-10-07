import type { LegacyResourceHints } from '../../parsers/shared/resources/resourceHints.js';
import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import { normalizeArchiveResourceName } from './archivePath.js';
import { decodeDataUrlAsset, buildDataUrlStorageRef, sha256Hex } from './index.js';
import type { ResourceBindings } from '../../document/ast/ast.js';

/** Resource preparation is a side channel; never replace Domain identities with export identities. */
export async function prepareDomainResources(conversation: DomainConversationDetail, hints: LegacyResourceHints = {}): Promise<ResourceBindings> {
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
