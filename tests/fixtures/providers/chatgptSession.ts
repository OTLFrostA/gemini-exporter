/** Native ChatGPT /api/auth/session JSON mock data. */
const indexSession = () => ({ accessToken: 'test-token', user: { id: 'u-index' }, account: { id: 'w-index' } });
const listSession = () => ({ accessToken: 'tok', user: { id: 'u-list' }, account: { id: 'workspace-list' } });
const fixtureMap = {
    'C_DISCOVERY_SESSION_01': () => ({
        accessToken: 'test-token', user: { id: 'user', name: 'Test user' }, account: { id: 'workspace' },
    }),
    'C_DISCOVERY_SESSION_02': () => ({}),
    'C_DISCOVERY_SESSION_03': () => ({
        accessToken: 'test-token', user: { id: 'user', name: 'Test user' },
    }),
    'C_DISCOVERY_SESSION_04': () => ({
        accessToken: '', user: { id: 'user', name: 'Test user' }, account: { id: 'workspace' },
    }),
    'C_DISCOVERY_SESSION_05': () => ({}),
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
};
export function sessionGen(key: keyof typeof fixtureMap): Record<string, unknown> {
    return fixtureMap[key]();
}
