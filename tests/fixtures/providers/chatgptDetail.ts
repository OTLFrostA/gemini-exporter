import { describeFixtures, synthetic, derived } from './provenance.js';
import dilCorpus from '../chatgpt_dil_corpus.json';
import dynamicQuestionnaire from '../chatgpt_dynamic_questionnaire.json';
import type { ChatGPTConversationNode } from '../../../src/l1/parsers/chatgpt/chatgptTypes.js';

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

function nativeDetail(mapping: Record<string, ChatGPTConversationNode>, current_node = 'answer') {
    return {
        id: 'source-chatgpt-1', title: 'Authored title', create_time: 1700000000,
        update_time: 1700000010, current_node, mapping, is_archived: false,
    };
}

function imageAcquisitionDetail() {
    const mapping: Record<string, ChatGPTConversationNode> = {
        root: { id: 'root', children: ['u1'] },
        u1: {
            id: 'u1', parent: 'root', children: ['t1'],
            message: {
                author: { role: 'user' },
                content: {
                    content_type: 'multimodal_text',
                    parts: [
                        'before image',
                        { content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_cat' },
                        'after image',
                    ],
                },
                id: 'msg-u1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        t1: {
            id: 't1', parent: 'u1', children: ['a1'],
            message: {
                author: { role: 'tool' },
                content: {
                    content_type: 'multimodal_text',
                    parts: [{ content_type: 'image_asset_pointer', asset_pointer: 'sediment://file_missing' }],
                },
                id: 'msg-t1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
        a1: {
            id: 'a1', parent: 't1', children: [],
            message: {
                author: { role: 'assistant' },
                content: { content_type: 'text', parts: ['here is your cat'] },
                id: 'msg-a1', recipient: 'all', status: 'finished_successfully', weight: 1,
            },
        },
    };
    return {
        title: 'img chat', create_time: 1700000000, update_time: 1700000060,
        current_node: 'a1', mapping, is_archived: false,
    };
}

const fixtureMap = {
    'C_CAPTURE_EMPTY_DETAIL_01': () => ({
        id: '6acffdc5-c4d0-83e8-8e1b-ba60979a618a', mapping: {},
    }),
    'C_PROVIDER_CHATGPT_TREE_IMAGE_DETAIL_01': () => imageAcquisitionDetail(),
    'C_PROVIDER_CHATGPT_TREE_INVALID_DETAIL_01': () => ({
        conversation_id: 'foreign', mapping: {},
    }),
    'C_PROVIDER_CHATGPT_TREE_INVALID_DETAIL_02': () => ({
        id: 'requested-conversation', mapping: null,
    }),
    'C_PROVIDER_CHATGPT_TREE_INVALID_DETAIL_03': () => ({
        id: 'requested-conversation', mapping: {
            one: { id: 'one', children: [], message: { bad: true } },
        },
    }),
    'C_PROVIDER_CHATGPT_TREE_FOREIGN_DETAIL_01': () => ({ id: 'other-conversation' }),
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
    'C_E2E_CHATGPT_EXPORT_DETAIL_01': () => ({
        id: 'gpt-chat',
        title: 'ChatGPT history from source',
        create_time: 1700000000,
        update_time: 1700000010,
        current_node: 'answer',
        is_archived: false,
        mapping: {
            root: { id: 'root', children: ['question'] },
            question: textNode('question', 'root', 'user', 'Derive Euler-Lagrange equation.'),
            answer: textNode('answer', 'question', 'assistant', 'Stationary action requires $\\frac{d}{dt}\\frac{\\partial L}{\\partial \\dot{q}} = \\frac{\\partial L}{\\partial q}$.'),
        },
    }),
    'C_BOUNDARY_FOREIGN_DETAIL_01': () => ({
        ...nativeDetail({
            root: { id: 'root', children: ['answer'] },
            answer: textNode('answer', 'root', 'assistant', 'Foreign payload'),
        }),
        id: 'foreign-conversation-id',
    }),
    'C_BOUNDARY_MALFORMED_MAPPING_01': () => ({
        id: '6acffdc5-c4d0-83e8-8e1b-ba60979a618a',
        mapping: null,
    }),
    'C_BOUNDARY_VALID_DETAIL_01': () => ({
        ...nativeDetail({
            root: { id: 'root', children: ['question'] },
            question: textNode('question', 'root', 'user', 'Question'),
            answer: textNode('answer', 'question', 'assistant', 'Answer'),
        }),
        id: '6acffdc5-c4d0-83e8-8e1b-ba60979a618a',
    }),
    'C_DERIVED_DIL_MULTIMODAL_AUDIT_01': () => {
        const codeEntry = dilCorpus[1];
        const bilingualEntry = dilCorpus[7];
        return {
            id: '6acffdc5-c4d0-83e8-8e1b-000000000101',
            title: 'Extended Hamming (8,4) SECDED Engineering Audit',
            create_time: 1760000000,
            update_time: 1760000120,
            current_node: 'a2',
            is_archived: false,
            mapping: {
                root: { id: 'root', children: ['u1'] },
                u1: {
                    ...textNode('u1', 'root', 'user', 'Provide a runnable Python encoder/syndrome verifier for the extended Hamming (8,4) SECDED code.'),
                    children: ['a1'],
                },
                a1: {
                    id: 'a1',
                    parent: 'u1',
                    children: ['u2'],
                    message: {
                        id: 'message-a1',
                        author: { role: 'assistant' },
                        recipient: 'all',
                        status: 'finished_successfully',
                        end_turn: true,
                        weight: 1,
                        content: { content_type: 'text', parts: [codeEntry.raw] },
                        metadata: { model_slug: 'gpt-5', model_dil_v2: { fallbackMarkdown: codeEntry.fallback } },
                    },
                },
                u2: {
                    ...textNode('u2', 'a1', 'user', 'Summarize the bilingual EN/ZH engineering audit verdict table and conventions.'),
                    children: ['a2'],
                },
                a2: {
                    id: 'a2',
                    parent: 'u2',
                    children: [],
                    message: {
                        id: 'message-a2',
                        author: { role: 'assistant' },
                        recipient: 'all',
                        status: 'finished_successfully',
                        end_turn: true,
                        weight: 1,
                        content: { content_type: 'text', parts: [bilingualEntry.raw] },
                        metadata: { model_slug: 'gpt-5', model_dil_v2: { fallbackMarkdown: bilingualEntry.fallback } },
                    },
                },
            },
        };
    },
    'C_DERIVED_DYNAMIC_QUESTIONNAIRE_01': () => ({
        id: '6ad9b0a8-1b6c-83e8-af11-3071d09cd382',
        title: '家庭堆肥知识小问卷',
        create_time: 1760000200,
        update_time: 1760000260,
        current_node: 'answer',
        is_archived: false,
        mapping: {
            root: { id: 'root', children: ['question'] },
            question: {
                ...textNode('question', 'root', 'user', '请生成一份家庭堆肥知识互动小问卷。'),
                children: ['answer'],
            },
            answer: {
                id: 'answer',
                parent: 'question',
                children: [],
                message: {
                    id: 'message-compost',
                    author: { role: 'assistant' },
                    recipient: 'all',
                    status: 'finished_successfully',
                    end_turn: true,
                    weight: 1,
                    content: { content_type: 'text', parts: [dynamicQuestionnaire.raw] },
                    metadata: { model_slug: 'gpt-5', model_dil_v2: { fallbackMarkdown: dynamicQuestionnaire.fallbackMarkdown } },
                },
            },
        },
    }),
};

export function detailGen<K extends keyof typeof fixtureMap>(key: K): ReturnType<(typeof fixtureMap)[K]> {
    return fixtureMap[key]() as ReturnType<(typeof fixtureMap)[K]>;
}

export const fixtureOrigins = describeFixtures(
    fixtureMap,
    synthetic("Authored ChatGPT protocol, content or state counterexample; no saved capture is used."),
    {
        C_DERIVED_DIL_MULTIMODAL_AUDIT_01: derived(
            ["tests/fixtures/chatgpt_dil_corpus.json"],
            "Captured live ChatGPT DIL Python CodeBlock, LaTeX math and bilingual audit table replies wrapped in a native /backend-api/conversation/:id mapping envelope.",
        ),
        C_DERIVED_DYNAMIC_QUESTIONNAIRE_01: derived(
            ["tests/fixtures/chatgpt_dynamic_questionnaire.json"],
            "Captured live ChatGPT interactive compost questionnaire DIL body and official fallbackMarkdown wrapped in a native /backend-api/conversation/:id mapping envelope.",
        ),
    },
);
