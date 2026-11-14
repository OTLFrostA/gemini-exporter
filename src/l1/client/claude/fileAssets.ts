import { OperationError, readOperationIssue, type OperationIssue } from '../../../shared/errors/operationError.js';
import type { ResourceBytes } from '../../../shared/resources/resourceResult.js';
import { ResourceHttpError, ResourceProcessingError } from '../../../shared/resources/resourceResult.js';
import { isRecord } from '../../../shared/utils/typeGuards.js';
import { executeInFirstPlatformTab } from '../tabSourceRunner.js';
import { claudeUuid } from '../../sniffer/claude/observation.js';

export function claudeFileId(uri?: string): string | null {
    const id = uri?.startsWith('claude-file:') ? uri.slice(12) : undefined;
    return claudeUuid(id) ? id : null;
}

interface ClaudeFileTabResult {
    status: number;
    base64?: string;
    mediaType?: string;
    issue?: OperationIssue;
}

/** Download through the same authenticated tab and organization as the source.
 * Only a fixed files endpoint is allowed; source URLs cannot redirect this API. */
export async function readClaudeFile(organization: string, file: string, signal?: AbortSignal): Promise<ResourceBytes> {
    if (!claudeUuid(organization) || !claudeUuid(file)) throw new TypeError('Invalid Claude file identity');
    return executeInFirstPlatformTab({
        platform: 'claude',
        unavailableMessage: 'Open Claude to acquire attachments',
        emptyResultMessage: 'Claude file returned no result',
        signal,
        args: [organization, file],
        func: async (org: string, id: string): Promise<ClaudeFileTabResult> => {
            const readCookieOrg = (): string | null | undefined => {
                const raw = document.cookie.split(';').map(s => s.trim()).find(s => s.startsWith('lastActiveOrg='))?.slice(14);
                if (raw === undefined) return undefined;
                try { return decodeURIComponent(raw); } catch { return null; }
            };
            const initialCookie = readCookieOrg();
            if (initialCookie !== undefined && initialCookie !== org) {
                return { status: 0, issue: { code: 'ACCOUNT_CHANGED', message: 'Claude attachment account changed' } };
            }
            if (initialCookie === undefined) {
                const orgResp = await fetch('/api/organizations', { credentials: 'include', headers: { Accept: 'application/json' } });
                if (!orgResp.ok) return { status: orgResp.status };
                const orgs: unknown = await orgResp.json();
                if (!Array.isArray(orgs) || !orgs.some((item: unknown) => item !== null && typeof item === 'object' && 'uuid' in item && item.uuid === org)) {
                    return { status: 0, issue: { code: 'ACCOUNT_CHANGED', message: 'Claude organization/account changed' } };
                }
            }
            const response = await fetch('/api/organizations/' + org + '/files/' + id + '/contents', { credentials: 'include', redirect: 'error' });
            if (!response.ok) return { status: response.status };
            const reader = response.body?.getReader();
            if (!reader) return { status: 0, issue: { code: 'RESOURCE_PROCESSING_FAILED', message: 'Missing Claude file bytes' } };
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    size += value.byteLength;
                    if (size > 20 * 1024 * 1024) return { status: 0, issue: { code: 'RESOURCE_SIZE_LIMIT', message: 'Claude attachment exceeds 20 MiB' } };
                    chunks.push(value);
                }
            } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
            const postCookie = readCookieOrg();
            if (postCookie !== undefined && postCookie !== org) {
                return { status: 0, issue: { code: 'ACCOUNT_CHANGED', message: 'Claude attachment account changed' } };
            }
            let binary = '';
            for (const chunk of chunks) for (let i = 0; i < chunk.length; i += 8192)
                binary += String.fromCharCode(...chunk.subarray(i, i + 8192));
            return { status: response.status, base64: btoa(binary), mediaType: response.headers.get('content-type')?.split(';')[0] ?? undefined };
        },
        decode: (raw): ResourceBytes => {
            if (!isRecord(raw) || typeof raw.status !== 'number') {
                throw new ResourceProcessingError('Claude file returned no result');
            }
            if ('issue' in raw && raw.issue !== undefined) {
                const issue = readOperationIssue(raw.issue);
                if (issue) throw new OperationError(issue.code, issue.message, issue.httpStatus);
                throw new OperationError('SOURCE_RESPONSE_INVALID', 'Claude file returned invalid error facts');
            }
            if (raw.status === 429) throw new OperationError('SOURCE_HTTP_ERROR', 'Claude file HTTP 429', 429);
            if (raw.status < 200 || resultStatusNotOk(raw.status)) throw new ResourceHttpError(raw.status);
            if (typeof raw.base64 !== 'string' || !raw.base64) throw new ResourceProcessingError('Claude file is empty');
            return {
                bytes: Uint8Array.from(atob(raw.base64), c => c.charCodeAt(0)),
                ...(typeof raw.mediaType === 'string' && raw.mediaType ? { mediaType: raw.mediaType } : {}),
            };
        },
    });
}

function resultStatusNotOk(status: number): boolean {
    return status >= 300;
}
