/** Native ChatGPT /api/auth/session JSON mock data. */
const indexSession = () => ({ accessToken: 'test-token', user: { id: 'u-index' }, account: { id: 'w-index' } });
const listSession = () => ({ accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' } });
const fixtureMap = {
    'C_L1_CLIENT_V2_MOCKED_03': () => ({
        accessToken: 'token', user: { id: 'user-1' }, account: { id: 'workspace-1' },
    }),
    'C_L1_CLIENT_V2_MOCKED_05': () => ({
        accessToken: 'token', user: { id: 'user-1' }, account: { id: 'workspace-1' },
    }),
    'C_L1_CONTRACT_20': () => ({
        accessToken: 'token', user: { id: 'other-user' }, account: { id: 'workspace' },
    }),
    'C_LIST_SOURCE_BOUNDARY_03': () => ({ accessToken: 'test-token' }),
    'C_LIST_SOURCE_BOUNDARY_05': indexSession,
    'C_PROVIDER_CHATGPT_TREE_02': listSession,
    'C_PROVIDER_CHATGPT_TREE_04': listSession,
    'C_PROVIDER_CHATGPT_TREE_06': listSession,
    'C_PROVIDER_CHATGPT_TREE_09': listSession,
    'C_E2E_CHATGPT_SCAN_02': () => ({
        accessToken: 'test-token', user: { id: 'chatgpt-user', name: 'GPT test account' },
        account: { id: 'workspace' },
    }),
    'C_CAPTURE_SESSION_01': () => ({
        user: { id: 'subject' }, account: { id: 'workspace' }, accessToken: 'must-never-cross-worlds',
    }),
    'C_CAPTURE_SESSION_02': () => ({
        user: { id: 'other' }, account: { id: 'workspace' }, accessToken: 'must-never-cross-worlds',
    }),
    'C_CAPTURE_SESSION_03': () => ({
        user: { id: 'subject' }, account: { id: 'workspace' }, accessToken: 'must-never-cross-worlds',
    }),
    'C_FILE_DOWNLOAD_SESSION_01': () => ({ accessToken: 'tok' }),
};
export function sessionGen(key: keyof typeof fixtureMap): Record<string, unknown> {
    return fixtureMap[key]();
}
