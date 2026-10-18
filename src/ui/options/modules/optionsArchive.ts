import type { DomainConversationIndex } from '../../../types/conversation.js';
/** The new Index has no cloud deletion fact; never infer deletion from an absent list item. */
export async function renderArchiveNotice(_conversations: DomainConversationIndex[], _accountId: string, _reload: () => Promise<void>): Promise<void> {
    const card = document.getElementById('archiveNotice');
    if (card) card.hidden = true;
}
