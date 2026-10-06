import type { DomainAsset, DomainConversationDetail } from '../../src/core/domain/conversationDetail.js';

/** Follow the public Domain relationship rather than assuming registry/message array positions coincide. */
export function messageAssets(domain: DomainConversationDetail, index = 0): DomainAsset[] {
    return (domain.messages[index]?.attachmentIds ?? []).map(id => {
        const asset = domain.assets.find(candidate => candidate.id === id);
        if (!asset) throw new Error(`Missing test resource: ${id}`);
        return asset;
    });
}
