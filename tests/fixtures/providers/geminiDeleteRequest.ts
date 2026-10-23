/** Raw Gemini GzXR5e conversation deletion RPC request bodies. */
const fixtureMap = {
    'G_DELETE_SNIFFER_REQUEST_01': () => new URLSearchParams({
        'f.req': JSON.stringify([[['GzXR5e', JSON.stringify(['c_deadbeef00112233']), null, 'generic']]]),
    }).toString(),
    'G_FROZEN_CONTRACT_DELETE_REQUEST_01': () => new URLSearchParams({
        'f.req': JSON.stringify([[['GzXR5e', JSON.stringify(['c_deadbeef00112233']), null, 'generic']]]),
    }).toString(),
};

export function deleteRequestGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
