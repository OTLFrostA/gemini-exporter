import type { OperationErrorCode } from '../../../shared/errors/operationError.js';
import type { SourceExecutionResult } from '../sourceExecution.js';
import { executeSourceReadInPlatformTabs } from '../tabSourceRunner.js';
import { hasPlatformAccess } from '../platformAccess.js';
import { PLATFORM_HOSTS } from '../../../shared/platformHosts.js';
import { claudeUuid } from '../../sniffer/claude/observation.js';

export const CLAUDE_ORIGIN = PLATFORM_HOSTS.claude.pages[0];
export function hasClaudeAccess(): Promise<boolean> { return hasPlatformAccess('claude'); }
const allowedPath = /^\/api\/organizations(?:\/([\da-f-]{36})\/chat_conversations(?:\/([\da-f-]{36}))?(?:\?tree=true&rendering_mode=messages&render_all_tools=true)?)?$/i;
const paginatedPath = /^\/api\/organizations\/([\da-f-]{36})\/chat_conversations_v2\?limit=100&offset=\d+&consistency=strong$/i;

/**
 * Execute authenticated, same-origin API reads in a logged-in Claude tab.
 * No cookies or tokens ever cross the extension boundary; only JSON is returned.
 * An expected organization is verified both before and after the request.
 */
export async function readClaudeSource(path: string, expectedOrganization?: string): Promise<unknown> {
    const standard = allowedPath.exec(path);
    const paginated = paginatedPath.exec(path);
    const validPath = standard
        ? (standard[1] === undefined || claudeUuid(standard[1]))
            && (standard[2] === undefined || claudeUuid(standard[2]))
        : paginated !== null && claudeUuid(paginated[1]);
    if (!validPath || (expectedOrganization !== undefined && !claudeUuid(expectedOrganization)))
        throw new TypeError('Invalid Claude API request');
    return executeSourceReadInPlatformTabs({
        platform: 'claude',
        unavailableMessage: 'Open Claude and log in before continuing',
        emptyResultMessage: 'Claude source returned no data',
        args: expectedOrganization === undefined ? [path] : [path, expectedOrganization],
        func: async (requestedPath: string, organization?: string): Promise<SourceExecutionResult> => {
            class RequestFailure extends Error {
                constructor(readonly code: OperationErrorCode, message: string, readonly httpStatus?: number) { super(message); }
            }
            try {
                const checkCookieOrg = () => {
                    if (!organization) return;
                    const cookieOrg = document.cookie.split(';').map(part => part.trim())
                        .find(part => part.startsWith('lastActiveOrg='))?.slice('lastActiveOrg='.length);
                    if (cookieOrg && decodeURIComponent(cookieOrg) !== organization)
                        throw new RequestFailure('ACCOUNT_CHANGED', 'Active Claude organization differs from selected account');
                };
                const getJson = async (resource: string): Promise<unknown> => {
                    const response = await fetch(resource, { credentials: 'include',
                        headers: { Accept: 'application/json' } });
                    if (!response.ok) throw new RequestFailure('SOURCE_HTTP_ERROR', 'Claude API HTTP ' + response.status, response.status);
                    const json: unknown = await response.json();
                    return json;
                };
                if (organization) {
                    checkCookieOrg();
                    const organizations = await getJson('/api/organizations');
                    if (!Array.isArray(organizations)) throw new RequestFailure('SOURCE_RESPONSE_INVALID', 'Invalid Claude organizations response');
                    if (!organizations.some(
                        (org: unknown) => org !== null && typeof org === 'object'
                            && 'uuid' in org && org.uuid === organization))
                        throw new RequestFailure('ACCOUNT_CHANGED', 'Claude organization/account changed');
                }
                const value = await getJson(requestedPath);
                checkCookieOrg();
                return { ok: true, value };
            } catch (error) {
                return { ok: false, issue: { code: error instanceof RequestFailure ? error.code : 'UNKNOWN_ERROR',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    ...(error instanceof RequestFailure && error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}) } };
            }
        },
    });
}
