import type { ChatGPTApiConversationWithId, ChatGPTConversationNode } from '../../../src/l1/parsers/chatgpt/chatgptTypes.js';

/** Native JSON returned by GET /backend-api/conversation/:id (one payload per key). */
function textNode(id: string, parent: string, role: 'assistant' | 'user', content: string): ChatGPTConversationNode {
    return {
        id, parent, children: [],
        message: {
            id: 'message-' + id, author: { role }, recipient: 'all',
            status: 'finished_successfully', weight: 1, content: { content_type: 'text', parts: [content] },
        },
    };
}

function nativeDetail(mapping: Record<string, ChatGPTConversationNode>, current_node = 'answer'): ChatGPTApiConversationWithId {
    return {
        id: 'source-chatgpt-1', title: 'Authored title', create_time: 1700000000,
        update_time: 1700000010, current_node, mapping, is_archived: false,
    };
}

const fixtureMap = {
    'C_DETAIL_L1_SOURCE_01': () => nativeDetail({
        root: { id: 'root', children: ['question'] },
        question: textNode('question', 'root', 'user', 'Question'),
        answer: textNode('answer', 'question', 'assistant', 'Answer'),
    }),
    'C_DETAIL_L1_SOURCE_02': () => nativeDetail({
        answer: textNode('answer', 'missing', 'assistant', 'Answer'),
    }),
    'C_DETAIL_L1_SOURCE_03': () => nativeDetail({
        answer: textNode('answer', 'question', 'assistant', 'Answer'),
        question: textNode('question', 'answer', 'user', 'Question'),
    }),
    'C_DETAIL_L1_SOURCE_04': () => nativeDetail({}, ''),
    'C_DETAIL_L1_SOURCE_05': () => nativeDetail({
        root: { id: 'root', children: ['answer'] },
        answer: {
            id: 'answer', parent: 'root', children: [],
            message: {
                id: 'message-image', author: { role: 'assistant' },
                recipient: 'all', status: 'finished_successfully', weight: 1,
                content: {
                    content_type: 'multimodal_text',
                    parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://photo-1' }],
                },
            },
        },
    }),
};

export function detailGen(key: keyof typeof fixtureMap): ChatGPTApiConversationWithId {
    return fixtureMap[key]();
}
