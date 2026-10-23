/** Raw Gemini GzXR5e conversation deletion RPC request bodies. */
const fixtureMap = {
    'G_REGRESSION_MIXED_DELETE_REQUEST_01': () => new URLSearchParams({
        'f.req': JSON.stringify([[['otherRpc', JSON.stringify(['c_aabbccdd11223344'])],
            ['GzXR5e', JSON.stringify(['c_deadbeef00112233']), null, 'generic']]]),
    }).toString(),
    'G_REGRESSION_DELETE_NO_ID_REQUEST_01': () => 'f.req=[[["GzXR5e",null]]]',
    'G_REGRESSION_DECOY_DELETE_REQUEST_01': () =>
        'f.req=[["aabbccdd11223344"],["GzXR5e","c_deadbeef00112233"]]',
    'G_DELETE_SNIFFER_REQUEST_01': () => new URLSearchParams({
        'f.req': JSON.stringify([[['GzXR5e', JSON.stringify(['c_deadbeef00112233']), null, 'generic']]]),
    }).toString(),
    'G_FROZEN_CONTRACT_DELETE_REQUEST_01': () => new URLSearchParams({
        'f.req': JSON.stringify([[['GzXR5e', JSON.stringify(['c_deadbeef00112233']), null, 'generic']]]),
    }).toString(),
    'G_L1_VERIFIED_DELETE_REQUEST_01': () => new URLSearchParams({
        'f.req': JSON.stringify([[['GzXR5e', JSON.stringify([null, 'c_deadbeef00112233']), null, 'generic']]]),
    }).toString(),
};

export function deleteRequestGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
