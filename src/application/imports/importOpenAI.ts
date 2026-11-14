import type { SourceResourceContext } from '../../l1/resources/sourceResources.js';
import { parseOpenAIExportArchive } from '../../l1/imports/openai/parseArchive.js';
import { admitArchivedConversations, requireImportTargetAccount } from './batchAdmitImports.js';

export interface OpenAIImportResult {
    imported: number;
    skipped: number;
    missingAssets: number;
    status: 'ok' | 'partial' | 'empty';
}

/** Offline export workflow uses L1 archive decoding/parsing and L2 admission. */
export async function importOpenAI(file: Blob | Uint8Array, accountId: string,
    onProgress?: (percent: number) => void, resources?: SourceResourceContext): Promise<OpenAIImportResult> {
    const account = await requireImportTargetAccount(
        accountId,
        'chatgpt',
        'CHATGPT_ACCOUNT_REQUIRED',
        'Select a ChatGPT account before importing OpenAI ZIP',
    );
    onProgress?.(5);
    const parsedArchive = await parseOpenAIExportArchive(file, account.providerAccountId, () => onProgress?.(35));
    const batch = await admitArchivedConversations({
        accountId,
        items: parsedArchive.conversations,
        yieldEvery: 25,
        resources,
        extract: item => ({
            conversationId: item.conversationId,
            parsed: item.parsed,
            bindResources: ctx => {
                for (const [assetId, entry] of item.boundEntries) {
                    ctx.retain({ accountId, conversationId: item.conversationId }, assetId, async () => ({ bytes: await entry.bytes() }));
                }
            },
        }),
        onItemSettled: ({ position, total }) => {
            onProgress?.(35 + Math.floor((position + 1) / total * 65));
        },
    });
    const skipped = parsedArchive.skippedEmpty + batch.rejectedCount;
    const missingAssets = parsedArchive.missingAssets;
    const status: OpenAIImportResult['status'] = !parsedArchive.conversationCount
        ? 'empty'
        : (batch.incompleteQuality || skipped > 0 || missingAssets > 0) ? 'partial' : 'ok';
    onProgress?.(100);
    return {
        imported: batch.acceptedIds.size,
        skipped,
        missingAssets,
        status,
    };
}
