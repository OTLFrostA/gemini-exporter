/**
 * src/core/export/canonical/projection.ts
 * Shared branch projection for the canonical message tree.
 *
 * Implements integration doc section 3, item 1 ("message tree and branches"):
 * a single projectConversation() used by every renderer, with structural
 * validation (unique ids, resolvable parents, acyclic graph, valid leaf) and
 * explicit policies for no-selection / multi-root / legacy-linear input.
 *
 * Branches that are not selected stay in the canonical bundle/archive; they
 * are reported as omittedBranchMessageIds, never deleted or flattened.
 */

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
    /**
     * Explicit leaf to project. When omitted, the bundle's
     * selectedLeafMessageId is used; when that is absent too, the policy is
     * 'allInSourceOrder' (see below).
     */
    leafMessageId?: string | null;
}

export interface ProjectedView {
    /** Messages in render order (root -> leaf for a selected branch). */
    messages: MessageNode[];
    /** Ids of root messages in the bundle, in source order. */
    rootIds: string[];
    /** The selected root->leaf path, or null when no leaf was selected. */
    selectedPathIds: string[] | null;
    /**
     * Message ids that exist in the canonical bundle but are not part of the
     * projected view (other branches). They are retained in the bundle.
     */
    omittedBranchMessageIds: string[];
}

/**
 * Validate the message tree structurally. Returns a list of issues; an empty
 * list means the tree is projectable. Does not throw.
 */
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
    // Cycle detection (iterative DFS over parent edges).
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

/**
 * Project the canonical message tree to the renderable view.
 *
 * Policies:
 * - explicit or bundle-selected leaf: project the single root->leaf path;
 *   every other branch is reported in omittedBranchMessageIds and retained
 *   in the bundle/archive.
 * - no selection: project ALL messages in source (array) order. Legacy
 *   linear conversations (no parentId) and multi-root trees use this policy.
 * - invalid tree (duplicate ids, orphan parents, cycles, unknown leaf):
 *   throws CanonicalProjectionError; renderers must not silently drop content.
 */
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
        // No-selection policy: every message in source order (covers legacy
        // linear conversations, multi-root trees and unknown branch state).
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
    // Walk leaf -> root, then reverse for render order.
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
