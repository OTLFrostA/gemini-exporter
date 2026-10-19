import { getAccount } from '../../api/accountRegistry.js';
import { defaultGeminiProvider } from '../../provider/gemini/geminiProvider.js';
import { ProviderRegistry } from '../../provider/providerRegistry.js';
import CoverageAdmission, { type ScanHead } from '../../domain/coverageAdmission.js';

export interface ScanRequest { accountId: string; forceFull?: boolean }
export type ScanStatus = 'up_to_date' | 'complete' | 'partial_limit' | 'aborted' | 'error';
export interface ScanResult {
    status: ScanStatus;
    pagesFetched: number;
    conversationsFetched: number;
    reason?: string;
}
export type ScanProgress = Pick<ScanResult, 'pagesFetched' | 'conversationsFetched'>;
const active = new Set<string>();

export async function scanAll(request: ScanRequest, options: {
    onProgress?: (progress: ScanProgress) => void;
    signal?: AbortSignal;
} = {}): Promise<ScanResult> {
    const { accountId } = request;
    const counts: ScanProgress = { pagesFetched: 0, conversationsFetched: 0 };
    const result = (status: ScanStatus, reason?: string): ScanResult =>
        ({ status, ...counts, ...(reason ? { reason } : {}) });
    if (active.has(accountId)) return result('error', 'Scan already running');
    active.add(accountId);
    try {
        options.signal?.throwIfAborted();
        const account = await getAccount(accountId);
        const provider = account && (ProviderRegistry.get(account.providerId) ?? (account.providerId === 'gemini' ? defaultGeminiProvider : undefined));
        if (!provider) throw new Error('Account provider unavailable');
        const previous = await CoverageAdmission.getCoverage(accountId, 'recent');
        const baseline = previous ? structuredClone(previous) : null;
        let scanHead: ScanHead | undefined;
        let verifiedStop = false;
        const end = await provider.listConversations({ accountId, streamId: 'recent', signal: options.signal,
            onPageCommitted: async info => {
                counts.pagesFetched = info.page;
                counts.conversationsFetched = info.totalObserved;
                scanHead ??= info.scanHead;
                options.onProgress?.({ ...counts });
                options.signal?.throwIfAborted();
                if (!request.forceFull && baseline?.range && scanHead) {
                    verifiedStop = await CoverageAdmission.hasTrustedBoundary(accountId, baseline, scanHead);
                }
                return verifiedStop;
            } });
        options.signal?.throwIfAborted();
        switch (end) {
            case 'source_end': return result('complete');
            case 'provider_limit': return result('partial_limit', 'provider_limit');
            case 'max_pages': return result('partial_limit', 'max_pages');
            case 'stopped': return verifiedStop ? result('up_to_date') : result('error', 'Unverified scan stop');
        }
    } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return result('aborted');
        return result('error', error instanceof Error ? error.message : String(error));
    } finally { active.delete(accountId); }
}
