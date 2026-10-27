import detail from './grokDetail.json';
import imageDetail from './grokImageDetail.json';

/** Captured metadata/tree/load-responses bodies; no production parser runs here. */
function textDetail() {
    const copy: Omit<typeof detail, 'tree'> & { tree: {
        responseNodes: typeof detail.tree.responseNodes; inflightResponses: unknown[];
    } } = structuredClone(detail);
    return copy;
}
const fixtureMap = {
    'GR_DETAIL_TEXT_01': () => textDetail(),
    'GR_DETAIL_IMAGE_01': () => structuredClone(imageDetail),
    'GR_METADATA_01': () => structuredClone(detail.metadata),
    'GR_RESPONSES_01': () => structuredClone(detail.bodies),
    'GR_TREE_STABLE_01': () => textDetail().tree,
    'GR_TREE_INFLIGHT_01': () => {
        const tree = textDetail().tree;
        tree.inflightResponses.push({});
        return tree;
    },
};
export function detailGen<K extends 'GR_DETAIL_TEXT_01' | 'GR_DETAIL_IMAGE_01'>(key: K): ReturnType<(typeof fixtureMap)[K]> {
    return fixtureMap[key]() as ReturnType<(typeof fixtureMap)[K]>;
}
export function metadataGen(key: 'GR_METADATA_01') { return fixtureMap[key](); }
export function responsesGen(key: 'GR_RESPONSES_01') { return fixtureMap[key](); }
export function treeGen(key: 'GR_TREE_STABLE_01' | 'GR_TREE_INFLIGHT_01') { return fixtureMap[key](); }
