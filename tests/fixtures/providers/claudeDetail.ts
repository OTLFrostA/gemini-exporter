/** Raw GET /api/organizations/:org/chat_conversations/:id response bodies.
 * Every key supplies an independent, fixed native reply; no scenarios or options.
 */
const conversation = '11111111-1111-4111-8111-111111111111';
const root = '33333333-3333-4333-8333-333333333333';
const branch = '44444444-4444-4444-8444-444444444444';
const leaf = '55555555-5555-4555-8555-555555555555';

function message(uuid: string, parent: string | null, sender: string, text: string) {
    return { uuid, parent_message_uuid: parent, sender,
        content: [{ type: 'text', text }], created_at: '2026-10-01T00:00:00.000Z' };
}

function detail<T extends { uuid: string }>(messages: T[], currentLeaf: string | null = leaf) {
    return { uuid: conversation, name: 'Claude authored title', created_at: '2026-10-01T00:00:00Z',
        updated_at: '2026-10-02T00:00:00Z', chat_messages: messages,
        current_leaf_message_uuid: currentLeaf };
}

const fixtureMap = {
    'CL_L1_SOURCE_SELECTED_BRANCH_01': () => detail([
        message(root, null, 'human', 'Question'),
        message(branch, root, 'assistant', 'Abandoned answer'),
        message(leaf, root, 'assistant', 'Selected **answer**'),
    ]),
    'CL_L1_SOURCE_MISSING_PARENT_01': () => detail([message(leaf, root, 'assistant', 'Answer')]),
    'CL_L1_SOURCE_MISSING_LEAF_01': () => detail([message(root, null, 'human', 'Question')], null),
    'CL_L1_SOURCE_FOREIGN_CONVERSATION_01': () => detail([]),
    'CL_L1_SOURCE_MISSING_MESSAGES_01': () => ({ uuid: conversation }),
    'CL_L1_SOURCE_SENTINEL_ROOT_01': () => detail([
        message(root, '00000000-0000-4000-8000-000000000000', 'human', 'Q'),
        message(leaf, root, 'assistant', 'A'),
    ]),
    'CL_L1_SOURCE_UNRESOLVED_PARENT_01': () => detail([message(leaf, branch, 'assistant', 'Missing')]),
    'CL_L1_SOURCE_CYCLIC_BRANCH_01': () => detail([
        message(root, leaf, 'human', 'Q'),
        message(leaf, root, 'assistant', 'Cycle'),
    ]),
};

export function detailGen(key: keyof typeof fixtureMap) {
    return fixtureMap[key]();
}
