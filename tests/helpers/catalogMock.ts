import type { DomainConversationIndex } from '../../src/core/domain/conversationIndex.js';
/** Physical catalog mock, with business merge always executed by real L2. */
export function catalogMock(read: () => DomainConversationIndex[], write: (list: DomainConversationIndex[]) => void) {
    return { local: {
        async get(keys: string | string[] | null) {
            return Object.fromEntries((keys === null ? [] : typeof keys === 'string' ? [keys] : keys)
                .filter(key => key.startsWith('conversations_')).map(key => [key, structuredClone(read())]));
        },
        async set(values: Record<string, unknown>) {
            for (const [key, value] of Object.entries(values)) if (key.startsWith('conversations_')) {
                if (!Array.isArray(value)) throw new TypeError('Invalid test catalog');
                write(value);
            }
        },
        async remove() {},
    } };
}
