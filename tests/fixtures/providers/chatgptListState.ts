/** ChatGPT local incremental-list algorithm inputs, not HTTP payloads. */
const fixtureMap = {
    'C_PROVIDER_CHATGPT_TREE_01': () => ({
        cached: [
            { id: 'a', title: 'A', create_time: 1, update_time: 3 },
            { id: 'b', title: 'B', create_time: 1, update_time: 2 },
        ],
        pages: [[
            { id: 'c', title: 'C', create_time: 2, update_time: 4 },
            { id: 'a', title: 'A', create_time: 1, update_time: 3 },
            { id: 'z', title: 'Z', create_time: 1, update_time: 9 },
        ]],
    }),
};
export function listStateGen<K extends keyof typeof fixtureMap>(key: K): ReturnType<(typeof fixtureMap)[K]> {
    return fixtureMap[key]() as ReturnType<(typeof fixtureMap)[K]>;
}
