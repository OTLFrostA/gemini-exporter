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

export const chatgptListFixtures = {
    clientSession: () => ({
        accessToken: 'token', user: { id: 'user-1' }, account: { id: 'workspace-1' },
    }),
    conflictingAccountSession: () => ({
        accessToken: 'token', user: { id: 'other-user' }, account: { id: 'workspace' },
    }),
    clientComplete: () => list([
        { id: 'chatgpt-source', title: 'Owned title', create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    clientIncomplete: () => list([
        { id: 'incomplete', update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: true }),

    parserNativePaging: () => list([
        { id: 'chat-1', title: 'Title', create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),
    parserMissingFlagAbsent: () => list([], { total: 0, offset: 0, limit: 100 }),
    parserMissingFlagPresent: () => list([], { total: 0, offset: 0, limit: 100, has_missing_conversations: true }),
    parserMalformedFlags: () => [null, 'false', 0, {}].map(flag =>
        ({ ...list([], { total: 0, offset: 0, limit: 100 }), has_missing_conversations: flag })),
    parserInvalidOffset: () => list([], { total: 0, offset: -1, limit: 100 }),

    boundaryIndexFacts: () => list([
        { id: 'api-chat', title: '  Source title  ', create_time: 1700000000.125,
            update_time: '2023-11-14T22:14:20Z',
            timestamp: 999, titles: { user: 'Injected title' }, source: 'takeout', messageCount: 100 },
        { id: 'untitled', title: '', create_time: null, update_time: 'invalid' },
        { id: 'millis', title: 'A', create_time: 1700000000123, update_time: Infinity },
    ], { total: 3, cursor: 'next' }),
    boundaryMalformedPages: () => [
        {}, { items: {} }, { items: [null] }, { items: [{ id: '' }] },
        { items: [], total: -1 }, { items: [], cursor: 3 },
    ],
    boundarySchemaDrift: () => ({ items: 'schema drift' }),
    boundarySessionToken: () => ({ accessToken: 'test-token' }),
    boundarySessionIndex: indexSession,
    boundaryCommitted: () => list([
        { id: 'listed', title: 'Listed chat', update_time: 1700000060 },
    ], { total: 1, offset: 0, limit: 100, has_missing_conversations: false }),

    treeListSession: listSession,
    treeOnePage: () => list([
        { id: 'a', title: 'A', create_time: 1, update_time: 2 },
        { id: 'b', title: 'B', create_time: 1, update_time: 1 },
        { id: 'c', title: 'C', create_time: 1, update_time: 0.5 },
    ], { total: 3, offset: 0, limit: 100, has_missing_conversations: false }),
    treeOffsetPage: (offset: number) => list(
        Array.from({ length: offset === 0 ? 100 : 2 }, (_, i) => ({
            id: `conversation-${offset + i}`, title: `Conversation ${offset + i}`,
            create_time: 1, update_time: 1000 - offset - i,
        })), { total: 102, limit: 100, offset },
    ),
    treeEmpty: () => list([], { total: 0, limit: 100, offset: 0 }),
    treeIncrementalRefresh: () => ({
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
    treeUntrustedPages: () => [
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

    browserSession: () => ({
        accessToken: 'test-token', user: { id: 'chatgpt-user', name: 'GPT test account' },
        account: { id: 'workspace' },
    }),
    browserList: () => list([
        { id: 'gpt-chat', title: 'ChatGPT history from source',
            create_time: 1700000000, update_time: 1700000010 },
    ], { total: 1, offset: 0, limit: 100 }),
};
