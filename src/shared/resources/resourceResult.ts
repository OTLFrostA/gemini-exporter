/** A recoverable resource failure is separate from conversation/source facts. */
export type ResourceResult<T> =
    | { ok: true; resourceId: string; value: T }
    | { ok: false; resourceId: string; reason: string; code: string; httpStatus?: number; sourceUrl?: string };
export type ResourceFailure = Extract<ResourceResult<never>, { ok: false }>;
/** Transport encodings are normalized once; successful acquisition always contains bytes. */
export interface ResourceBytes { bytes: Uint8Array; mediaType?: string; name?: string }
/** Only a successful write/mount produces a delivery receipt. */
export interface ResourceDelivery { path: string }
export type PreparedResources = ReadonlyMap<string, ResourceResult<ResourceBytes>>;

export function missingResource(resourceId: string, reason: string, code = 'RESOURCE_UNAVAILABLE'): ResourceFailure {
    return { ok: false, resourceId, reason, code };
}
/** Cancellation retains control-flow semantics; only individual resource errors recover. */
export async function attemptResource<T>(resourceId: string, work: () => Promise<T>, signal?: AbortSignal | null): Promise<ResourceResult<T>> {
    signal?.throwIfAborted();
    try {
        const value = await work();
        signal?.throwIfAborted();
        return { ok: true, resourceId, value };
    } catch (error) {
        signal?.throwIfAborted();
        if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') throw error;
        if (error instanceof ResourceProcessingError) return missingResource(resourceId, error.message, 'RESOURCE_PROCESSING_FAILED');
        if (error instanceof ResourceHttpError) {
            const status = error.httpStatus;
            return { ...missingResource(resourceId, error.message,
                status === 404 || status === 410 ? 'RESOURCE_SOURCE_EXPIRED'
                    : status === 401 || status === 403 ? 'RESOURCE_ACCESS_RESTRICTED' : 'RESOURCE_DOWNLOAD_FAILED'), httpStatus: status };
        }
        return missingResource(resourceId, error instanceof Error ? error.message : String(error));
    }
}
/** Only an actual attachment response status establishes source unavailability. */
export class ResourceHttpError extends Error {
    constructor(readonly httpStatus: number) { super(`Resource request failed: HTTP ${httpStatus}`); }
}
export type ResourceIssueKind = 'expired' | 'restricted' | 'download' | 'processing';
export function resourceIssueKind(failure: ResourceFailure): ResourceIssueKind {
    if (failure.code === 'RESOURCE_SOURCE_EXPIRED') return 'expired';
    if (failure.code === 'RESOURCE_ACCESS_RESTRICTED') return 'restricted';
    if (/PROCESSING|DECODE|EMPTY|ZERO_BYTES|TOO_LARGE/.test(failure.code)) return 'processing';
    return 'download';
}
export function resourceFailureText(failure: ResourceFailure, locale: 'zh' | 'en'): string {
    const kind = resourceIssueKind(failure);
    const labels = locale === 'zh'
        ? { expired: '来源附件已失效，来源文件已不存在或链接已失效', restricted: '附件访问受限，可能需要重新登录', download: '附件下载失败，请稍后重试', processing: '附件无法处理' }
        : { expired: 'Source attachment unavailable: the file no longer exists or its link is invalid', restricted: 'Attachment access restricted; you may need to sign in again', download: 'Attachment download failed; please retry later', processing: 'Attachment could not be processed' };
    return labels[kind] + (failure.httpStatus ? ` (HTTP ${failure.httpStatus})` : '');
}

export class ResourceProcessingError extends Error {}
