import nativeDelete from '../gemini_native_delete.json';
/** Raw Gemini GzXR5e conversation deletion RPC response bodies. */
const fixtureMap = {
    'G_NATIVE_CAPTURE_DELETE_RESPONSE_01': () => nativeDelete.responseText,
    'G_NATIVE_CAPTURE_DELETE_MALFORMED_NULL_01': () =>
        nativeDelete.responseText.replace('"[]"', JSON.stringify('null')),
    'G_NATIVE_CAPTURE_DELETE_MALFORMED_ARRAY_01': () =>
        nativeDelete.responseText.replace('"[]"', JSON.stringify('[null]')),
    'G_NATIVE_CAPTURE_DELETE_MALFORMED_FALSE_01': () =>
        nativeDelete.responseText.replace('"[]"', JSON.stringify('[false]')),
    'G_NATIVE_CAPTURE_DELETE_MALFORMED_OTHER_01': () =>
        nativeDelete.responseText.replace('"[]"', JSON.stringify('[null,"c_other"]')),
    'G_REGRESSION_EMPTY_DELETE_RESPONSE_01': () => '',
    'G_DYNAMIC_DELETE_ECHO_01': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_8888abcd1234ef01'])]]),
    'G_DYNAMIC_DELETE_VOID_01': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([])]]),
    'G_DYNAMIC_DELETE_UNMATCHED_01': () =>
        JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_aaaaaaaaaaaaaaaa'])]]),
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

    'G_L1_VERIFIED_DELETE_ACK_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_deadbeef00112233'])]]),
    'G_L1_VERIFIED_DELETE_OTHER_ACK_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'GzXR5e', JSON.stringify([null, 'c_beefcafe12341234'])]]),
    'G_L1_VERIFIED_DELETE_LIMIT_01': () =>
        String.fromCharCode(41, 93, 125, 39) + '\n\n' + JSON.stringify([['wrb.fr', 'GzXR5e',
            JSON.stringify([null, 'c_deadbeef00112233']), null, null, ['BardErrorInfo', 1096]]]),
};

export function deleteGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
