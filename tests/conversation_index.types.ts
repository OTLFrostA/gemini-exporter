import type { DomainConversationIndex, ConversationIndexPatch } from '../src/core/domain/conversationIndex.js';
import { StorageService } from '../src/core/storage/storageService.js';

const index: DomainConversationIndex = { providerId: 'gemini', id: 'chat', title: '', titleSource: 'default',
    cloudAvailability: 'unknown', hasTakeoutImport: false };
const count: number | undefined = index.messageCount;
const source: DomainConversationIndex['titleSource'] = 'provider';
// @ts-expect-error Historical timestamp aliases never cross the index boundary.
const alias: DomainConversationIndex = { ...index, timestamp: 1 };
// @ts-expect-error Candidate maps are acquisition evidence, not canonical metadata.
const candidates: DomainConversationIndex = { ...index, titles: { rpc: 'Title' } };
// @ts-expect-error A body cannot enter index storage.
const body: DomainConversationIndex = { ...index, messages: [] };
// @ts-expect-error Unknown activity is absent, never null.
const undated: DomainConversationIndex = { ...index, updatedAt: null };
// @ts-expect-error Message activity is a distinct numeric fact; it cannot be null.
const badMessageTime: DomainConversationIndex = { ...index, lastMessageAt: null };
// @ts-expect-error Identity cannot be changed by an index patch.
const patch: ConversationIndexPatch = { id: 'replacement' };
// @ts-expect-error Partial historical rows cannot be written as canonical indexes.
const badWrite = () => StorageService.setConversations('u0', [{ id: 'chat', title: 'Title' }]);
void [badMessageTime, count, source, alias, candidates, body, undated, patch, badWrite];
