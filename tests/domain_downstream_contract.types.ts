import { checkIsUpdated, getEffectiveTimestamp, resolveConversationExportState, render, getSelected } from '../src/ui/views/listView.js';
import type { ReadonlyDomain } from '../src/core/domain/runtimeValidation.js';

function checkConsumers(input: ReadonlyDomain, index: Parameters<typeof checkIsUpdated>[0], rec: Parameters<typeof checkIsUpdated>[1]) {
    checkIsUpdated(input.index, rec);
    resolveConversationExportState(input.index, rec);
    render([input.index]);
    const selected = getSelected([input.index]);
    // @ts-expect-error Selecting an index does not grant write access to it.
    selected[0].title = 'changed';
    // @ts-expect-error UI wrappers must preserve the core timestamp contract.
    checkIsUpdated({ id: 'x', updatedAt: 'not-a-number' });
    // @ts-expect-error Primitive inputs cannot be used as conversation indexes.
    resolveConversationExportState(123);
    // @ts-expect-error Historical aliases do not belong in canonical index consumers.
    getEffectiveTimestamp({ timestamp: 123 });
    if (index) {
        // @ts-expect-error Consumers cannot rewrite activity facts.
        index.updatedAt = 123;
    }
    if (rec) {
        // @ts-expect-error Consumers cannot rewrite export activity records.
        rec.chatTime = 123;
    }
    const conversations: Parameters<typeof render>[0] = [input.index];
    // @ts-expect-error The UI consumes a read-only catalog.
    conversations.push(input.index);
}
void checkConsumers;
