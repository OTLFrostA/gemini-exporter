/**
 * ChatGPT native List test data only.
 * Tests select a named case; protocol fields, synthetic source rows, and
 * malformed variants are constructed here rather than in test bodies.
 * No cross-provider contract, mock Provider, or assertions belong here.
 */
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
const indexSession = () => ({
    accessToken: 'test-token', user: { id: 'u-index' }, account: { id: 'w-index' },
});
const listSession = () => ({
    accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' },
});



// One unique key per consuming List test call site. Values preserve the old data.
const fixtureMap = {
    'C_L1_CLIENT_V2_MOCKED_03': () => ({
        accessToken: 'token', user: { id: 'user-1' }, account: { id: 'workspace-1' },
    }),
    'C_L1_CLIENT_V2_MOCKED_04': () => list([
        { id: 'chatgpt-source', title: 'Owned title', create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_L1_CLIENT_V2_MOCKED_05': () => ({
        accessToken: 'token', user: { id: 'user-1' }, account: { id: 'workspace-1' },
    }),
    'C_L1_CLIENT_V2_MOCKED_06': () => list([
        { id: 'incomplete', update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: true }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_01': () => list([
        { id: 'chat-1', title: 'Title', create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_02': () => list([], { total: 0, offset: -1, limit: 100 }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_03': () => list([], { total: 0, offset: 0, limit: 100 }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_04': () => list([], { total: 0, offset: 0, limit: 100, has_missing_conversations: true }),
    'C_L1_CHATGPT_SOURCE_V2_UNIT_05': () => [null, 'false', 0, {}].map(flag =>
        ({ ...list([], { total: 0, offset: 0, limit: 100 }), has_missing_conversations: flag })),
    'C_L1_CONTRACT_20': () => ({
        accessToken: 'token', user: { id: 'other-user' }, account: { id: 'workspace' },
    }),
    'C_LIST_SOURCE_BOUNDARY_01': () => list([
        { id: 'api-chat', title: '  Source title  ', create_time: 1700000000.125,
            update_time: '2023-11-14T22:14:20Z',
            timestamp: 999, titles: { user: 'Injected title' }, source: 'takeout', messageCount: 100 },
        { id: 'untitled', title: '', create_time: null, update_time: 'invalid' },
        { id: 'millis', title: 'A', create_time: 1700000000123, update_time: Infinity },
    ], { total: 3, cursor: 'next' }),
    'C_LIST_SOURCE_BOUNDARY_02': () => [
        {}, { items: {} }, { items: [null] }, { items: [{ id: '' }] },
        { items: [], total: -1 }, { items: [], cursor: 3 },
    ],
    'C_LIST_SOURCE_BOUNDARY_03': () => ({ accessToken: 'test-token' }),
    'C_LIST_SOURCE_BOUNDARY_04': () => ({ items: 'schema drift' }),
    'C_LIST_SOURCE_BOUNDARY_05': indexSession,
    'C_LIST_SOURCE_BOUNDARY_06': () => list([
        { id: 'listed', title: 'Listed chat', update_time: 1700000060 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_01': () => ({
        cached: [
            { id: 'a', title: 'A', create_time: 1, update_time: 3 },
            { id: 'b', title: 'B', create_time: 1, update_time: 2 },
        ],
        pages: [[
            { id: 'c', title: 'C', create_time: 2, update_time: 4 },
            { id: 'a', title: 'A', create_time: 1, update_time: 3 },
            { id: 'z', title: 'Z', create_time: 1, update_time: 9 },
        ]],
    }),
    'C_PROVIDER_CHATGPT_TREE_02': listSession,
    'C_PROVIDER_CHATGPT_TREE_03': () => list([
        { id: 'a', title: 'A', create_time: 1, update_time: 2 },
        { id: 'b', title: 'B', create_time: 1, update_time: 1 },
        { id: 'c', title: 'C', create_time: 1, update_time: 0.5 },
    ], { total: 3, offset: 0, limit: 100, has_missing_conversations: false }),
    'C_PROVIDER_CHATGPT_TREE_04': listSession,
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
    'C_PROVIDER_CHATGPT_TREE_06': listSession,
    'C_PROVIDER_CHATGPT_TREE_07': () => list([], { total: 0, limit: 100, offset: 0 }),
    'C_PROVIDER_CHATGPT_TREE_08': () => [
        list([{ id: 'missing-time', title: 'Missing time' }],
            { total: 1, limit: 100, offset: 0, has_missing_conversations: false }),
        list([{ id: 'missing-row', title: 'Incomplete', update_time: 2 }],
            { total: 1, limit: 100, offset: 0, has_missing_conversations: true }),
        list([{ id: 'wrong-offset', title: 'Wrong offset', update_time: 2 }],
            { total: 1, limit: 100, offset: 100, has_missing_conversations: false }),
        list([{ id: 'missing-total', title: 'Missing total', update_time: 2 }],
            { limit: 100, offset: 0, has_missing_conversations: false }),
        list([{ id: 'short-page', title: 'Short page', update_time: 2 }],
            { total: 2, limit: 100, offset: 0 }),
        list([{ id: 'no-total', title: 'No total', update_time: 2 }],
            { limit: 100, offset: 0 }),
        list([{ id: 'bad-offset', title: 'Bad offset', update_time: 2 }],
            { total: 1, limit: 100, offset: 100 }),
        list([{ id: 'no-limit', title: 'No limit', update_time: 2 }],
            { total: 1, offset: 0 }),
    ],
    'C_PROVIDER_CHATGPT_TREE_09': listSession,
    'C_E2E_CHATGPT_SCAN_01': () => list([
        { id: 'gpt-chat', title: 'ChatGPT history from source',
            create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100 }),
    'C_E2E_CHATGPT_SCAN_02': () => ({
        accessToken: 'test-token', user: { id: 'chatgpt-user', name: 'GPT test account' },
        account: { id: 'workspace' },
    }),
};

/** Single public List data entrypoint for chatgpt; no cross-provider protocol abstraction. */
export function listGen<K extends keyof typeof fixtureMap>(key: K): ReturnType<(typeof fixtureMap)[K]> {
    return fixtureMap[key]() as ReturnType<(typeof fixtureMap)[K]>;
}
