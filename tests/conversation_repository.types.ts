import type { DomainConversation } from '../src/core/domain/conversation.js';
import type { ConversationRepository } from '../src/core/storage/conversationRepository.js';

function contract(conversation: DomainConversation, repository: ConversationRepository) {
    const title: string | undefined = conversation.index.title;
    // @ts-expect-error Metadata has one owner in the aggregate.
    const duplicateTitle = conversation.detail?.title;
    // Source version belongs to the captured Detail, separate from Index activity.
    const savedAt: number | undefined = conversation.detail?.savedAt;
    // @ts-expect-error Activity exists only on the index.
    const updatedAt = conversation.detail?.updatedAt;
    // @ts-expect-error Repository scope cannot follow global account changes.
    repository.scope.accountSlot = 'u1';
    void [title, duplicateTitle, savedAt, updatedAt];
}
void contract;
