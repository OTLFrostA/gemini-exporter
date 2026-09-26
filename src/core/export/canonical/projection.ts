import type { CanonicalConversationBundle, Conversation, MessageNode } from './conversation.js';

export class CanonicalProjectionError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.name = 'CanonicalProjectionError';
        this.code = code;
    }
}

export interface ProjectionSelection {
    leafMessageId?: string | null;
}

export interface ProjectedView {
    messages: MessageNode[];
    rootIds: string[];
    selectedPathIds: string[] | null;
    omittedBranchMessageIds: string[];
}

export function validateMessageTree(conversation: Conversation): CanonicalProjectionError[] {
    const issues: CanonicalProjectionError[] = [];
    const seen = new Map<string, MessageNode>();
    for (const m of conversation.messages) {
        if (!m || typeof m.id !== 'string' || !m.id) {
            issues.push(new CanonicalProjectionError('MSG_BAD_ID', 'message has a missing or non-string id'));
            continue;
        }
        if (seen.has(m.id)) {
            issues.push(new CanonicalProjectionError('MSG_DUP_ID', `duplicate message id: ${m.id}`));
        } else {
            seen.set(m.id, m);
        }
    }
    for (const m of conversation.messages) {
        const parentId = m.parentId ?? null;
        if (parentId !== null && parentId !== undefined) {
            if (!seen.has(parentId)) {
                issues.push(new CanonicalProjectionError('MSG_ORPHAN', `message ${m.id} has unresolvable parentId ${parentId}`));
            } else if (parentId === m.id) {
                issues.push(new CanonicalProjectionError('MSG_SELF_PARENT', `message ${m.id} is its own parent`));
            }
        }
    }
    // Iterative DFS over parent edges to detect cycles without call-stack overflow.
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of seen.keys()) color.set(id, WHITE);
    const stack: Array<{ id: string; childIndex: number }> = [];
    for (const startId of seen.keys()) {
        if (color.get(startId) !== WHITE) continue;
        stack.push({ id: startId, childIndex: 0 });
        color.set(startId, GRAY);
        const path: string[] = [startId];
        while (stack.length > 0) {
            const top = stack[stack.length - 1];
            const node = seen.get(top.id)!;
            const parentId = node.parentId ?? null;
            if (parentId !== null && parentId !== undefined && seen.has(parentId)) {
                const parentColor = color.get(parentId);
                if (parentColor === GRAY) {
                    const cycle = [...path.slice(path.indexOf(parentId)), parentId].join(' -> ');
                    issues.push(new CanonicalProjectionError('MSG_CYCLE', `message parent cycle detected: ${cycle}`));
                    break;
                }
                if (parentColor === WHITE) {
                    color.set(parentId, GRAY);
                    path.push(parentId);
                    stack.push({ id: parentId, childIndex: 0 });
                    continue;
                }
            }
            color.set(top.id, BLACK);
            stack.pop();
            path.pop();
        }
    }
    return issues;
}

function resolveLeafId(bundle: CanonicalConversationBundle, selection?: ProjectionSelection): string | null {
    if (selection && selection.leafMessageId !== undefined) return selection.leafMessageId;
    const bundleLeaf = bundle.conversation.selectedLeafMessageId;
    return bundleLeaf === undefined ? null : bundleLeaf;
}

export function projectConversation(
    bundle: CanonicalConversationBundle,
    selection?: ProjectionSelection,
): ProjectedView {
    if (!bundle || !bundle.conversation || !Array.isArray(bundle.conversation.messages)) {
        throw new CanonicalProjectionError('BUNDLE_SHAPE', 'bundle.conversation.messages must be an array');
    }
    const conversation = bundle.conversation;
    const treeIssues = validateMessageTree(conversation);
    if (treeIssues.length > 0) {
        const first = treeIssues[0];
        throw new CanonicalProjectionError(first.code, `invalid message tree: ${first.message}`);
    }

    const byId = new Map<string, MessageNode>();
    for (const m of conversation.messages) byId.set(m.id, m);
    const rootIds = conversation.messages
        .filter((m) => (m.parentId ?? null) === null || (m.parentId ?? null) === undefined)
        .map((m) => m.id);

    const leafId = resolveLeafId(bundle, selection);
    if (leafId === null || leafId === undefined) {
        // Without a target leaf, fall back to source array order so linear and multi-root conversations render intact.
        return {
            messages: [...conversation.messages],
            rootIds,
            selectedPathIds: null,
            omittedBranchMessageIds: [],
        };
    }
    if (!byId.has(leafId)) {
        throw new CanonicalProjectionError('MSG_BAD_LEAF', `selected leaf message id not found: ${leafId}`);
    }
    const path: MessageNode[] = [];
    const pathIds: string[] = [];
    let cursor: string | null | undefined = leafId;
    const visited = new Set<string>();
    while (cursor !== null && cursor !== undefined) {
        if (visited.has(cursor)) {
            throw new CanonicalProjectionError('MSG_CYCLE', `cycle while resolving leaf path at ${cursor}`);
        }
        visited.add(cursor);
        const node: MessageNode = byId.get(cursor)!;
        path.unshift(node);
        pathIds.unshift(cursor);
        cursor = node.parentId ?? null;
    }
    const onPath = new Set(pathIds);
    const omittedBranchMessageIds = conversation.messages
        .map((m) => m.id)
        .filter((id) => !onPath.has(id));
    return { messages: path, rootIds, selectedPathIds: pathIds, omittedBranchMessageIds };
}
