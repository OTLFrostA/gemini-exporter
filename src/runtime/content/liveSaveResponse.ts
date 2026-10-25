import type { ExportResult, ExportAttachmentIssue } from '../../application/export/types.js';
import { readConversationKey } from '../../l2/conversationKey.js';

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new TypeError('Invalid Live Save count');
    return value;
}
function attachmentIssue(value: unknown): ExportAttachmentIssue {
    if (!object(value) || typeof value.resourceId !== 'string' || typeof value.name !== 'string' || typeof value.code !== 'string'
        || (value.sourceUrl !== undefined && typeof value.sourceUrl !== 'string')
        || (value.httpStatus !== undefined && (typeof value.httpStatus !== 'number' || !Number.isFinite(value.httpStatus)))) {
        throw new TypeError('Invalid Live Save attachment issue');
    }
    return { resourceId: value.resourceId, name: value.name, code: value.code,
        ...(value.sourceUrl === undefined ? {} : { sourceUrl: value.sourceUrl }),
        ...(value.httpStatus === undefined ? {} : { httpStatus: value.httpStatus }) };
}

/** Chrome JSON replies are untrusted even when the worker's producer is typed. */
export function readLiveSaveResponse(response: unknown): ExportResult | null {
    if (!object(response) || response.ok !== true) {
        throw new Error(object(response) && typeof response.error === 'string' && response.error ? response.error : 'Live Save unavailable');
    }
    const result = response.result;
    if (result === null) return null;
    if (!object(result) || !Array.isArray(result.failed) || typeof result.aborted !== 'boolean'
        || (result.attachmentIssues !== undefined && !Array.isArray(result.attachmentIssues))) {
        throw new TypeError('Invalid Live Save result');
    }
    return {
        exported: count(result.exported), skipped: count(result.skipped), partial: count(result.partial),
        failed: Array.from(result.failed, readConversationKey), aborted: result.aborted,
        ...(result.expiredConversations === undefined ? {} : { expiredConversations: count(result.expiredConversations) }),
        ...(result.otherPartial === undefined ? {} : { otherPartial: count(result.otherPartial) }),
        ...(result.attachmentIssues === undefined ? {} : { attachmentIssues: Array.from(result.attachmentIssues, attachmentIssue) }),
    };
}
