/** Native POST /completion, /completion2 and retry_completion* SSE body samples. */
const fixtureMap = {
    'CL_L1_SOURCE_HOOK_COMPLETION_01': () => 'data: {"type":"message_stop"}\n\n',
};

export function streamGen(key: keyof typeof fixtureMap): string {
    return fixtureMap[key]();
}
