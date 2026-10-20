import { renderList } from '../src/ui/options/views/listView.js';
import { ConversationViewState } from '../src/ui/options/state/conversationsStore.js';
import { getEffectiveTimestamp } from '../src/shared/utils/titleUtils.js';
import type { ReadonlyDomain } from '../src/l2/runtimeValidation.js';

function checkConsumers(input: ReadonlyDomain, state: ConversationViewState) {
    const indexes: ConversationViewState['indexes'] = [input.index];
    state.indexes = indexes;
    renderList(state, false);
    getEffectiveTimestamp(input.index);
    // @ts-expect-error Selecting an index does not grant write access to Domain facts.
    input.index.title = 'changed';
    // @ts-expect-error Source timestamps remain numeric.
    getEffectiveTimestamp({ updatedAt: 'not-a-number' });
    // @ts-expect-error Primitive inputs cannot be used as conversation indexes.
    getEffectiveTimestamp(123);
    // @ts-expect-error Historical aliases do not belong in canonical index consumers.
    getEffectiveTimestamp({ timestamp: 123 });
    // @ts-expect-error The UI must not rewrite activity facts.
    input.index.updatedAt = 123;
    const key = state.keys()[0];
    // @ts-expect-error Selection returns scoped keys, never editable Domain records.
    key.title = 'changed';
    const record = state.records[key.conversationId];
    // @ts-expect-error Export source versions remain numeric.
    record.chatTime = 'invalid';
}
void checkConsumers;
