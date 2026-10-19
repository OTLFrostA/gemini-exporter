import type { PageObservation } from '../src/core/domain/pageObservation.js';
import type { ingestIndexes } from '../src/core/domain/ingestion.js';
const keys = [{ id: 'source', time: 100 }] as const;
const items = [{ conversationId: 'source', fields: {} }] as const;
const observation: PageObservation<(typeof items)[number]> = {
    providerId: 'gemini', accountId: '10000000-0000-4000-8000-000000000001', streamId: 'recent',
    requestCursor: null, nextCursor: null, requestedAt: 1, requestKnown: true, valid: true, ordered: true,
    keys, items,
};
const admit: Parameters<typeof ingestIndexes> = ['10000000-0000-4000-8000-000000000001', items, observation];
void admit;
// @ts-expect-error Source evidence is immutable through the public observation contract.
observation.keys.push({ id: 'mutated', time: 0 });
// @ts-expect-error Source items are immutable through the public observation contract.
observation.items.push({ conversationId: 'mutated', fields: {} });
