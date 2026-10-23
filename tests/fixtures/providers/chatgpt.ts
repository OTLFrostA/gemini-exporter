/** Native responses from ChatGPT /backend-api/conversations only. */
type NativeListPage = {
    items: unknown[];
    total?: number | null;
    offset?: number;
    limit?: number;
    cursor?: string | null;
    has_missing_conversations?: unknown;
};
function list(items: unknown[], metadata: Omit<NativeListPage, 'items'> = {}): NativeListPage {
    return { items, ...metadata };
}



// One unique key per consuming List test call site. Values preserve the old data.
const fixtureMap = {
    'C_L1_CLIENT_V2_MOCKED_04': () => list([
        { id: 'chatgpt-source', title: 'Owned title', create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_L1_CLIENT_V2_MOCKED_06': () => list([
        { id: 'incomplete', update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: true }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_01': () => list([
        { id: 'chat-1', title: 'Title', create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_02': () => list([], { total: 0, offset: -1, limit: 100 }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_03': () => list([], { total: 0, offset: 0, limit: 100 }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_04': () => list([], { total: 0, offset: 0, limit: 100, has_missing_conversations: true }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_05_0': () => ({ ...list([], { total: 0, offset: 0, limit: 100 }), has_missing_conversations: null }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_05_1': () => ({ ...list([], { total: 0, offset: 0, limit: 100 }), has_missing_conversations: 'false' }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_05_2': () => ({ ...list([], { total: 0, offset: 0, limit: 100 }), has_missing_conversations: 0 }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_05_3': () => ({ ...list([], { total: 0, offset: 0, limit: 100 }), has_missing_conversations: {} }),
    'C_LIST_SOURCE_BOUNDARY_01': () => list([
        { id: 'api-chat', title: '  Source title  ', create_time: 1700000000.125,
            update_time: '2023-11-14T22:14:20Z',
            timestamp: 999, titles: { user: 'Injected title' }, source: 'takeout', messageCount: 100 },
        { id: 'untitled', title: '', create_time: null, update_time: 'invalid' },
        { id: 'millis', title: 'A', create_time: 1700000000123, update_time: Infinity },
    ], { total: 3, cursor: 'next' }),
    'C_LIST_SOURCE_BOUNDARY_02_0': () => ({}),
    'C_LIST_SOURCE_BOUNDARY_02_1': () => ({ items: {} }),
    'C_LIST_SOURCE_BOUNDARY_02_2': () => ({ items: [null] }),
    'C_LIST_SOURCE_BOUNDARY_02_3': () => ({ items: [{ id: '' }] }),
    'C_LIST_SOURCE_BOUNDARY_02_4': () => ({ items: [], total: -1 }),
    'C_LIST_SOURCE_BOUNDARY_02_5': () => ({ items: [], cursor: 3 }),
    'C_LIST_SOURCE_BOUNDARY_04': () => ({ items: 'schema drift' }),
    'C_LIST_SOURCE_BOUNDARY_06': () => list([
        { id: 'listed', title: 'Listed chat', update_time: 1700000060 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_03': () => list([
        { id: 'a', title: 'A', create_time: 1, update_time: 2 },
        { id: 'b', title: 'B', create_time: 1, update_time: 1 },
        { id: 'c', title: 'C', create_time: 1, update_time: 0.5 },
    ], { total: 3, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_05_0': () => ((offset: number) => list(
        Array.from({ length: offset === 0 ? 100 : 2 }, (_, i) => ({
            id: `conversation-${offset + i}`, title: `Conversation ${offset + i}`,
            create_time: 1, update_time: 1000 - offset - i,
        })), { total: 102, limit: 100, offset },
    ))(0),
    'C_PROVIDER_CHATGPT_TREE_05_100': () => ((offset: number) => list(
        Array.from({ length: offset === 0 ? 100 : 2 }, (_, i) => ({
            id: `conversation-${offset + i}`, title: `Conversation ${offset + i}`,
            create_time: 1, update_time: 1000 - offset - i,
        })), { total: 102, limit: 100, offset },
    ))(100),
    'C_PROVIDER_CHATGPT_TREE_07': () => list([], { total: 0, limit: 100, offset: 0 }),
    'C_PROVIDER_CHATGPT_TREE_08_0': () => list([{ id: 'missing-time', title: 'Missing time' }],
            { total: 1, limit: 100, offset: 0, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_08_1': () => list([{ id: 'missing-row', title: 'Incomplete', update_time: 2 }],
            { total: 1, limit: 100, offset: 0, has_missing_conversations: true }),
    'C_PROVIDER_CHATGPT_TREE_08_2': () => list([{ id: 'wrong-offset', title: 'Wrong offset', update_time: 2 }],
            { total: 1, limit: 100, offset: 100, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_08_3': () => list([{ id: 'missing-total', title: 'Missing total', update_time: 2 }],
            { limit: 100, offset: 0, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_08_4': () => list([{ id: 'short-page', title: 'Short page', update_time: 2 }],
            { total: 2, limit: 100, offset: 0 }),
    'C_PROVIDER_CHATGPT_TREE_08_5': () => list([{ id: 'no-total', title: 'No total', update_time: 2 }],
            { limit: 100, offset: 0 }),
    'C_PROVIDER_CHATGPT_TREE_08_6': () => list([{ id: 'bad-offset', title: 'Bad offset', update_time: 2 }],
            { total: 1, limit: 100, offset: 100 }),
    'C_PROVIDER_CHATGPT_TREE_08_7': () => list([{ id: 'no-limit', title: 'No limit', update_time: 2 }],
            { total: 1, offset: 0 }),
    'C_E2E_CHATGPT_SCAN_01': () => list([
        { id: 'gpt-chat', title: 'ChatGPT history from source',
            create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100 }),
};

/** The native /backend-api/conversations JSON payload, including malformed test values. */
export interface ChatGPTConversationsResponse {
    items?: unknown;
    total?: unknown;
    offset?: unknown;
    limit?: unknown;
    cursor?: unknown;
    has_missing_conversations?: unknown;
}

export function listGen(key: keyof typeof fixtureMap): ChatGPTConversationsResponse {
    return fixtureMap[key]();
}
