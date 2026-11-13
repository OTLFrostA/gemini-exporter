import { OperationError } from '../../shared/errors/operationError.js';
import { getAccount } from '../../runtime/api/accountRegistry.js';
import { notifyDomainChanged } from '../../runtime/api/domainChanges.js';
import { ingestDetail } from '../../l2/ingestion.js';
import type { SourceResourceContext } from '../../l1/resources/sourceResources.js';
import { parseOpenAIExportArchive } from '../../l1/imports/openai/parseArchive.js';

export interface OpenAIImportResult {
    imported: number;
    skipped: number;
    missingAssets: number;
    status: 'ok' | 'partial' | 'empty';
}

/** Offline export workflow uses L1 archive decoding/parsing and L2 admission. */
export async function importOpenAI(file: Blob | Uint8Array, accountId: string,
    onProgress?: (percent: number) => void, resources?: SourceResourceContext): Promise<OpenAIImportResult> {
    const account = await getAccount(accountId);
    if (!account || account.providerId !== 'chatgpt') {
        throw new OperationError('CHATGPT_ACCOUNT_REQUIRED', 'Select a ChatGPT account before importing OpenAI ZIP');
    }
    onProgress?.(5);
    const parsedArchive = await parseOpenAIExportArchive(file, account.providerAccountId, () => onProgress?.(35));
    const result: OpenAIImportResult = {
        imported: 0,
        skipped: parsedArchive.skippedEmpty,
        missingAssets: parsedArchive.missingAssets,
        status: 'ok',
    };
    const imported = new Set<string>();
    const total = parsedArchive.conversations.length;
    for (const [position, item] of parsedArchive.conversations.entries()) {
        const { conversationId, parsed, boundEntries } = item;
        const admission = await ingestDetail(accountId, conversationId, parsed.conversation.detail, parsed.conversation.index);
        if (admission.accepted) {
            imported.add(conversationId);
            if (resources) {
                resources.retainParsed({ accountId, conversationId }, parsed);
                for (const [assetId, entry] of boundEntries) {
                    resources.retain({ accountId, conversationId }, assetId, async () => ({ bytes: await entry.bytes() }));
                }
            }
        } else {
            result.skipped++;
        }
        if (parsed.conversation.detail.quality.status !== 'complete') result.status = 'partial';
        onProgress?.(35 + Math.floor((position + 1) / total * 65));
        if ((position + 1) % 25 === 0) {
            notifyDomainChanged(accountId);
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
    }
    result.imported = imported.size;
    if (!parsedArchive.conversationCount) result.status = 'empty';
    else if (result.skipped || result.missingAssets) result.status = 'partial';
    notifyDomainChanged(accountId);
    onProgress?.(100);
    return result;
}
