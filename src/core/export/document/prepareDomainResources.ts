import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import { normalizeArchiveResourceName } from '../assets/archivePath.js';
import { decodeDataUrlAsset, buildDataUrlStorageRef, sha256Hex } from '../assets/index.js';
import type { ResourceBindings } from './ast.js';

/** Resource preparation is a side channel; never replace Domain identities with export identities. */
export async function prepareDomainResources(conversation: DomainConversationDetail): Promise<ResourceBindings> {
    const bindings: Record<string, string> = {};
    for (const asset of conversation.assets) {
        const path = asset.source?.path;
        if (asset.failureReason && !asset.dataBase64 && !asset.document?.contentMarkdown) continue;
        if (path) {
            bindings[asset.id] = normalizeArchiveResourceName(path);
        } else if (asset.dataBase64 || asset.document?.contentMarkdown?.trim()) {
            // Preserve the existing content-addressed archive namespace for inline bytes.
            let bytes: Uint8Array;
            if (asset.dataBase64) {
                const raw = asset.dataBase64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
                const result = await decodeDataUrlAsset(`data:${asset.mediaType ?? 'application/octet-stream'};base64,${raw}`);
                if (!result.ok) continue;
                bindings[asset.id] = result.storageRef;
                continue;
            } else bytes = new TextEncoder().encode(asset.document!.contentMarkdown!.trim());
            bindings[asset.id] = buildDataUrlStorageRef(await sha256Hex(bytes), asset.mediaType ?? 'application/octet-stream');
        } else if (asset.source?.uri?.startsWith('data:')) {
            const decoded = await decodeDataUrlAsset(asset.source.uri);
            if (decoded.ok) bindings[asset.id] = decoded.storageRef;
        }
    }
    return bindings;
}
