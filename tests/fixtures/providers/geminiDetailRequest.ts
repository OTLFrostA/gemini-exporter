/** Native request bodies for Gemini's hNvQHb Detail RPC. */
function requestBody(args: unknown[]): string {
    return new URLSearchParams({
        'f.req': JSON.stringify([[['hNvQHb', JSON.stringify(args), null, 'generic']]]),
    }).toString();
}

const fixtureMap = {
    'G_L1_DETAIL_REQUEST_VALID_01': () =>
        requestBody(['c_source_chat_123', 10, 'tC_NEXT_PAGE_123456789', 1, [1], [4], null, 1]),
    'G_L1_DETAIL_REQUEST_TRUNCATED_01': () =>
        requestBody(['c_source_chat_123', 10, 'tC_NEXT_PAGE_123456789']),
    'G_L1_DETAIL_REQUEST_GARBAGE_01': () => 'garbage',
};

export function requestGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
