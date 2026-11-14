import type { BlockNode } from '../../../l2/content/blocks.js';
import { isRecord } from '../../../shared/utils/typeGuards.js';

export function record(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
}
export function plain(text: string): BlockNode {
    return { type: 'paragraph', children: [{ type: 'text', text }] };
}
