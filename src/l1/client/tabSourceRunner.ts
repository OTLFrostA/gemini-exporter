import { OperationError } from '../../shared/errors/operationError.js';
import { PLATFORM_HOSTS, platformDisplayName, type SourcePlatform } from '../../shared/platformHosts.js';
import { hasPlatformAccess } from './platformAccess.js';
import { readSourceExecution } from './sourceExecution.js';

/** Query authorized open tabs for a platform, ordered active-first and preserving valid ID 0. */
export async function queryAuthorizedPlatformTabIds(platform: SourcePlatform): Promise<number[]> {
    if (!await hasPlatformAccess(platform)) {
        throw new OperationError('PLATFORM_PERMISSION_REQUIRED', `${platformDisplayName(platform)} host permission unavailable`);
    }
    const tabs = await chrome.tabs.query({ url: [...PLATFORM_HOSTS[platform].pages] });
    return [...tabs]
        .sort((a, b) => Number(!!b.active) - Number(!!a.active))
        .flatMap(tab => tab.id === undefined ? [] : [tab.id]);
}

/** Run a self-contained isolated-world script on the first responsive platform tab (stopping immediately on HTTP 429). */
export async function executeInFirstPlatformTab<Args extends unknown[], Decoded = unknown>(options: {
    platform: SourcePlatform;
    unavailableMessage: string;
    emptyResultMessage: string;
    func: (...args: Args) => Promise<unknown> | unknown;
    args: Args;
    decode: (raw: unknown) => Decoded;
    signal?: AbortSignal;
}): Promise<Decoded> {
    options.signal?.throwIfAborted();
    const tabIds = await queryAuthorizedPlatformTabIds(options.platform);
    let lastError: unknown = new OperationError('SOURCE_PAGE_UNAVAILABLE', options.unavailableMessage);
    for (const tabId of tabIds) {
        options.signal?.throwIfAborted();
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId },
                world: 'ISOLATED',
                func: options.func,
                args: options.args,
            });
            options.signal?.throwIfAborted();
            if (results.length !== 1 || results[0]?.result === undefined) {
                throw new OperationError('SOURCE_RESPONSE_INVALID', options.emptyResultMessage);
            }
            return options.decode(results[0].result);
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') throw error;
            if (error instanceof OperationError && error.httpStatus === 429) throw error;
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(`${platformDisplayName(options.platform)} tab source unavailable`);
}

/** Standard SourceExecutionResult runner across candidate tabs for a platform. */
export async function executeSourceReadInPlatformTabs<Args extends unknown[]>(options: {
    platform: SourcePlatform;
    unavailableMessage: string;
    emptyResultMessage: string;
    func: (...args: Args) => Promise<unknown>;
    args: Args;
    signal?: AbortSignal;
}): Promise<unknown> {
    return executeInFirstPlatformTab({
        ...options,
        decode: readSourceExecution,
    });
}
