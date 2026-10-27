import detail from './grokDetail.json';

/** List variants reuse captured metadata; envelopes/cursors are explicit synthetic states. */
const row = () => structuredClone(detail.metadata.conversation);
const fixtureMap = {
    'GR_LIST_TERMINAL_01': () => ({ conversations: [row()] }),
    'GR_LIST_CONTINUATION_01': () => ({ conversations: [row()], nextPageToken: detail.id }),
    'GR_LIST_EMPTY_01': () => ({ conversations: [] }),
    'GR_LIST_EMPTY_TOKEN_01': () => ({ conversations: [], nextPageToken: '' }),
    'GR_LIST_NULL_TOKEN_01': () => ({ conversations: [], nextPageToken: null }),
    'GR_LIST_NUMBER_TOKEN_01': () => ({ conversations: [], nextPageToken: 12 }),
    'GR_LIST_FOREIGN_TOKEN_01': () => ({ conversations: [], nextPageToken: '../foreign' }),
    'GR_LIST_BLANK_TITLE_01': () => ({ conversations: [{ ...row(), title: '   ' }] }),
    'GR_LIST_NUMBER_TITLE_01': () => ({ conversations: [{ ...row(), title: 12 }] }),
    'GR_LIST_DUPLICATE_01': () => ({ conversations: [row(), row()] }),
    'GR_LIST_MISSING_TIME_01': () => ({ conversations: [{ ...row(), modifyTime: null }] }),
};
export function listGen<K extends keyof typeof fixtureMap>(key: K): ReturnType<(typeof fixtureMap)[K]> {
    return fixtureMap[key]() as ReturnType<(typeof fixtureMap)[K]>;
}
