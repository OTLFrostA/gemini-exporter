/** Raw Gemini GzXR5e conversation deletion RPC response bodies. */
const fixtureMap = {
    'G_DELETE_SNIFFER_RESPONSE_01': () => JSON.stringify([
        ['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_deadbeef00112233'])],
    ]),
    'G_DELETE_SNIFFER_RESPONSE_02': () => '',
};

export function deleteGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
