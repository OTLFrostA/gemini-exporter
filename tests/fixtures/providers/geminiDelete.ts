/** Raw Gemini GzXR5e conversation deletion RPC response bodies. */
const fixtureMap = {
    'G_DELETE_SNIFFER_RESPONSE_01': () => JSON.stringify([
        ['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_deadbeef00112233'])],
    ]),
    'G_DELETE_SNIFFER_RESPONSE_02': () => '',
    'G_FROZEN_CONTRACT_DELETE_RESPONSE_01': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_deadbeef00112233'])]]),
    'G_FROZEN_CONTRACT_DELETE_RESPONSE_02': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_abcdef1234567890'])]]),
    'G_REGRESSION_LOCK_DELETE_RESPONSE_01': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_deadbeef00112233'])]]),
    'G_REGRESSION_LOCK_DELETE_RESPONSE_02': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', 'c_feedface12345678', null]]),
    'G_REGRESSION_LOCK_DELETE_RESPONSE_03': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n' + JSON.stringify([['wrb.fr', 'GzXR5e', ['deleted'], null]]),
    'G_PROTOCOL_DELETE_RESPONSE_01': () =>
        `)]}'\n\n[["wrb.fr","GzXR5e","c_feedface12345678",null]]`,
    'G_P1I_QUOTED_DELETE_01': () => '[["wrb.fr","GzXR5e","c_aabbccdd11223344",null]]',
    'G_EXTRACTED_REGRESSION_FILTER_DELETE_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n' + JSON.stringify([['wrb.fr', 'GzXR5e', ['deleted'], null]]),
};

export function deleteGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
