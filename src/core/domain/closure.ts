import type { DomainConversationDetail } from './conversationDetail.js';
import { mapContentAssetReferences } from '../content/assetReferences.js';

/** Domain is a closed, JSON-portable semantic graph; invalid references never reach exporters. */
export function assertDomainClosure(conversation: DomainConversationDetail): void {
    if (typeof conversation.providerId !== 'string' || !conversation.providerId.trim()) {
        throw new TypeError('Domain providerId must be a non-empty string');
    }
    const assets = new Set<string>();
    for (const asset of conversation.assets) {
        if (typeof asset.id !== 'string' || !asset.id || assets.has(asset.id)) throw new TypeError(`Duplicate or empty Domain asset identity: ${asset.id}`);
        assets.add(asset.id);
    }
    conversation.messages.forEach((message, index) => {
        const reference = (ref: string): string => {
            if (!assets.has(ref)) throw new TypeError(`Unregistered Domain asset '${ref}' in messages[${index}]`);
            return ref;
        };
        const owned = message.attachmentIds ?? [];
        if (new Set(owned).size !== owned.length) throw new TypeError(`Duplicate Domain attachment reference in messages[${index}]`);
        owned.forEach(reference);
        mapContentAssetReferences(message.content, reference);
        if (message.reasoning !== undefined) {
            if (!Array.isArray(message.reasoning)) throw new TypeError('Domain reasoning must be Content AST');
            mapContentAssetReferences(message.reasoning, reference);
        }
    });
}
