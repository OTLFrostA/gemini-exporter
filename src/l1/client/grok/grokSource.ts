import type { OperationErrorCode } from '../../../shared/errors/operationError.js';
import type { SourceExecutionResult } from '../sourceExecution.js';
import { executeSourceReadInPlatformTabs } from '../tabSourceRunner.js';
import { hasPlatformAccess } from '../platformAccess.js';
import { grokUuid } from '../../parsers/grok/source.js';

export function hasGrokAccess(): Promise<boolean> { return hasPlatformAccess('grok'); }
export function validGrokRead(path: string, body?: { responseIds: string[] }): boolean {
    if (body) return /^\/rest\/app-chat\/conversations\/[\da-f-]{36}\/load-responses$/i.test(path)
        && body.responseIds.length > 0 && body.responseIds.length <= 100 && body.responseIds.every(grokUuid);
    return path === '/rest/auth/get-user'
        || /^\/rest\/app-chat\/conversations\?pageSize=60(?:&pageToken=[\da-f-]{36})?$/i.test(path)
        || /^\/rest\/app-chat\/conversations_v2\/[\da-f-]{36}\?includeWorkspaces=true&includeTaskResult=true$/i.test(path)
        || /^\/rest\/app-chat\/conversations\/[\da-f-]{36}\/response-node\?includeThreads=true$/i.test(path);
}

/** Only read APIs, including Grok's POST batch reader, execute in the authenticated tab. */
export async function readGrokSource(path: string, expectedUser?: string, body?: { responseIds: string[] }): Promise<unknown> {
    if (!validGrokRead(path, body) || expectedUser !== undefined && !grokUuid(expectedUser)) throw new TypeError('Invalid Grok API read');
    return executeSourceReadInPlatformTabs({
        platform: 'grok',
        unavailableMessage: 'Open Grok and log in before continuing',
        emptyResultMessage: 'Grok source returned no data',
        args: [path, expectedUser ?? null, body ?? null],
        func: async (resource: string, owner: string | null, payload: { responseIds: string[] } | null): Promise<SourceExecutionResult> => {
            class RequestFailure extends Error {
                constructor(readonly code: OperationErrorCode, message: string, readonly httpStatus?: number) { super(message); }
            }
            try {
                const CACHE_KEY = '__gemExporterGrokUserCache';
                const INFLIGHT_KEY = '__gemExporterGrokUserInflight';
                const TTL_MS = 10_000;
                const currentCookie = (): string => typeof document !== 'undefined' ? document.cookie : '';
                const get = async (targetPath: string, requestBody?: { responseIds: string[] }): Promise<unknown> => {
                    const r = await fetch(targetPath, { credentials: 'include', headers: { 'Content-Type': 'application/json' },
                        ...(requestBody ? { method: 'POST', body: JSON.stringify(requestBody) } : {}) });
                    if (!r.ok) throw new RequestFailure('SOURCE_HTTP_ERROR', 'Grok API HTTP ' + r.status, r.status);
                    const json: unknown = await r.json();
                    return json;
                };
                const extractUserId = (user: unknown): string => {
                    if (!user || typeof user !== 'object' || !('userId' in user) || typeof user.userId !== 'string') {
                        throw new RequestFailure('SOURCE_RESPONSE_INVALID', 'Invalid Grok current user');
                    }
                    return user.userId;
                };
                const readCachedUser = (cookieSnap: string): string | null => {
                    if (!cookieSnap) return null;
                    const raw: unknown = Reflect.get(globalThis, CACHE_KEY);
                    if (!raw || typeof raw !== 'object') return null;
                    const cachedCookie: unknown = Reflect.get(raw, 'cookie');
                    const verifiedAt: unknown = Reflect.get(raw, 'verifiedAt');
                    const userId: unknown = Reflect.get(raw, 'userId');
                    if (cachedCookie !== cookieSnap || typeof verifiedAt !== 'number' || Date.now() - verifiedAt >= TTL_MS || typeof userId !== 'string') {
                        return null;
                    }
                    return userId;
                };
                const saveCachedUser = (cookieSnap: string, userId: string): void => {
                    if (!cookieSnap) return;
                    Reflect.set(globalThis, CACHE_KEY, { cookie: cookieSnap, verifiedAt: Date.now(), userId });
                };
                const verify = async (forceRefresh: boolean): Promise<void> => {
                    if (!owner) return;
                    const snap = currentCookie();
                    if (!forceRefresh) {
                        const cached = readCachedUser(snap);
                        if (cached !== null) {
                            if (cached !== owner) throw new RequestFailure('ACCOUNT_CHANGED', 'Grok account changed');
                            return;
                        }
                    }
                    let inflight: Promise<string> | undefined;
                    if (!forceRefresh) {
                        const existing: unknown = Reflect.get(globalThis, INFLIGHT_KEY);
                        if (existing && typeof existing === 'object' && Reflect.get(existing, 'cookie') === snap) {
                            const pending: unknown = Reflect.get(existing, 'promise');
                            if (pending instanceof Promise) inflight = pending;
                        }
                    }
                    if (!inflight) {
                        const fetchPromise = get('/rest/auth/get-user').then(user => {
                            const userId = extractUserId(user);
                            saveCachedUser(currentCookie(), userId);
                            return userId;
                        }).finally(() => {
                            const current: unknown = Reflect.get(globalThis, INFLIGHT_KEY);
                            if (current && typeof current === 'object' && Reflect.get(current, 'promise') === fetchPromise) {
                                Reflect.deleteProperty(globalThis, INFLIGHT_KEY);
                            }
                        });
                        Reflect.set(globalThis, INFLIGHT_KEY, { cookie: snap, promise: fetchPromise });
                        inflight = fetchPromise;
                    }
                    const userId = await inflight;
                    if (userId !== owner) throw new RequestFailure('ACCOUNT_CHANGED', 'Grok account changed');
                };

                if (resource === '/rest/auth/get-user') {
                    const result = await get(resource);
                    const userId = extractUserId(result);
                    saveCachedUser(currentCookie(), userId);
                    if (owner && userId !== owner) throw new RequestFailure('ACCOUNT_CHANGED', 'Grok account changed');
                    return { ok: true, value: result };
                }
                const cookieBefore = currentCookie();
                if (owner) await verify(false);
                const result = await get(resource, payload ?? undefined);
                if (owner && (!cookieBefore || currentCookie() !== cookieBefore)) await verify(true);
                return { ok: true, value: result };
            } catch (error) {
                return { ok: false, issue: { code: error instanceof RequestFailure ? error.code : 'UNKNOWN_ERROR',
                    message: error instanceof Error ? error.message : 'Unknown error',
                    ...(error instanceof RequestFailure && error.httpStatus !== undefined ? { httpStatus: error.httpStatus } : {}) } };
            }
        },
    });
}
