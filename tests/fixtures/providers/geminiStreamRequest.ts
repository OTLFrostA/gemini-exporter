/** Gemini StreamGenerate transport request samples. */
const fixtureMap = {
    'G_STREAM_E2E_REQUEST_01': () => 'f.req=test',
};

export function requestGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
