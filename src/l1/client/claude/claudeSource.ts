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
                const CACHE_KEY = '__gemExporterClaudeOrgsCache';
                const INFLIGHT_KEY = '__gemExporterClaudeOrgsInflight';
                const TTL_MS = 10_000;
                const currentCookie = (): string => typeof document !== 'undefined' ? document.cookie : '';
                const checkCookieOrg = (): string | undefined => {
                    if (!organization) return undefined;
                    const cookieOrg = currentCookie().split(';').map(part => part.trim())
                        .find(part => part.startsWith('lastActiveOrg='))?.slice('lastActiveOrg='.length);
                    if (cookieOrg && decodeURIComponent(cookieOrg) !== organization)
                        throw new RequestFailure('ACCOUNT_CHANGED', 'Active Claude organization differs from selected account');
                    return cookieOrg;
                };
                const getJson = async (resource: string): Promise<unknown> => {
                    const response = await fetch(resource, { credentials: 'include',
                        headers: { Accept: 'application/json' } });
                    if (!response.ok) throw new RequestFailure('SOURCE_HTTP_ERROR', 'Claude API HTTP ' + response.status, response.status);
                    const json: unknown = await response.json();
                    return json;
                };
                const extractOrgUuids = (payload: unknown): string[] => {
                    if (!Array.isArray(payload)) throw new RequestFailure('SOURCE_RESPONSE_INVALID', 'Invalid Claude organizations response');
                    const items: readonly unknown[] = payload;
                    const uuids: string[] = [];
                    for (const org of items) {
                        if (org !== null && typeof org === 'object') {
                            const uuid: unknown = Reflect.get(org, 'uuid');
                            if (typeof uuid === 'string') uuids.push(uuid);
                        }
                    }
                    return uuids;
                };
                const readCachedOrgs = (cookieSnap: string): string[] | null => {
                    if (!cookieSnap) return null;
                    const raw: unknown = Reflect.get(globalThis, CACHE_KEY);
                    if (!raw || typeof raw !== 'object') return null;
                    const cachedCookie: unknown = Reflect.get(raw, 'cookie');
                    const verifiedAt: unknown = Reflect.get(raw, 'verifiedAt');
                    const uuids: unknown = Reflect.get(raw, 'uuids');
                    if (cachedCookie !== cookieSnap || typeof verifiedAt !== 'number' || Date.now() - verifiedAt >= TTL_MS || !Array.isArray(uuids)) {
                        return null;
                    }
                    return uuids.every((item): item is string => typeof item === 'string') ? uuids : null;
                };
                const saveCachedOrgs = (cookieSnap: string, uuids: string[]): void => {
                    if (!cookieSnap) return;
                    Reflect.set(globalThis, CACHE_KEY, { cookie: cookieSnap, verifiedAt: Date.now(), uuids });
                };
                const verifyOrgMembership = async (forceRefresh: boolean): Promise<void> => {
                    if (!organization) return;
                    const snap = currentCookie();
                    if (!forceRefresh) {
                        const cached = readCachedOrgs(snap);
                        if (cached) {
                            if (!cached.includes(organization)) {
                                throw new RequestFailure('ACCOUNT_CHANGED', 'Claude organization/account changed');
                            }
                            return;
                        }
                    }
                    let inflight: Promise<string[]> | undefined;
                    if (!forceRefresh) {
                        const existing: unknown = Reflect.get(globalThis, INFLIGHT_KEY);
                        if (existing && typeof existing === 'object' && Reflect.get(existing, 'cookie') === snap) {
                            const pending: unknown = Reflect.get(existing, 'promise');
                            if (pending instanceof Promise) inflight = pending;
                        }
                    }
                    if (!inflight) {
                        const fetchPromise = getJson('/api/organizations').then(payload => {
                            const uuids = extractOrgUuids(payload);
                            saveCachedOrgs(currentCookie(), uuids);
                            return uuids;
                        }).finally(() => {
                            const current: unknown = Reflect.get(globalThis, INFLIGHT_KEY);
                            if (current && typeof current === 'object' && Reflect.get(current, 'promise') === fetchPromise) {
                                Reflect.deleteProperty(globalThis, INFLIGHT_KEY);
                            }
                        });
                        Reflect.set(globalThis, INFLIGHT_KEY, { cookie: snap, promise: fetchPromise });
                        inflight = fetchPromise;
                    }
                    const uuids = await inflight;
                    if (!uuids.includes(organization)) {
                        throw new RequestFailure('ACCOUNT_CHANGED', 'Claude organization/account changed');
                    }
                };

                const cookieBefore = currentCookie();
                checkCookieOrg();
                if (requestedPath === '/api/organizations') {
                    const value = await getJson(requestedPath);
                    const uuids = extractOrgUuids(value);
                    saveCachedOrgs(currentCookie(), uuids);
                    if (organization && !uuids.includes(organization)) {
                        throw new RequestFailure('ACCOUNT_CHANGED', 'Claude organization/account changed');
                    }
                    checkCookieOrg();
                    return { ok: true, value };
                }
                if (organization) {
                    await verifyOrgMembership(false);
                }
                const value = await getJson(requestedPath);
                const postCookieOrg = checkCookieOrg();
                if (organization && currentCookie() !== cookieBefore && postCookieOrg === undefined) {
                    await verifyOrgMembership(true);
                }
                return { ok: true, value };
            } catch (error) {
                return { ok: false, issue: { code: error instanceof RequestFailure ? error.code : 'UNKNOWN_ERROR',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    ...(error instanceof RequestFailure && error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}) } };
            }
        },
    });
}
