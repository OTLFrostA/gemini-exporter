import type { Account } from '../../l2/accountRegistry.js';
import type { SourceResourceContext } from '../../l1/resources/sourceResources.js';
import { parseGeminiTakeoutZipArchive, readTakeoutBytes } from '../../l1/imports/takeout/readArchive.js';
import { OperationError } from '../../shared/errors/operationError.js';
import { TakeoutParseError } from '../../shared/types/errors.js';
import { admitArchivedConversations, requireImportTargetAccount } from './batchAdmitImports.js';

export interface TakeoutParseResult { imported: number; added: number; status: 'ok' | 'partial' }

/** Application offline import workflow: L1 archive parsing precedes L2 admission and UI invalidation. */
export async function importTakeout(file: File, accountId: Account['id'], onProgress?: (percent: number) => void, resources?: SourceResourceContext): Promise<TakeoutParseResult> {
    const account = await requireImportTargetAccount(
        accountId,
        'gemini',
        'GEMINI_ACCOUNT_REQUIRED',
        'Takeout requires an existing Gemini account',
    );
    onProgress?.(15);
    const results = await parseGeminiTakeoutZipArchive(file, { account, providerId: 'gemini',
        onProgress: (completed, total) => onProgress?.(70 + Math.floor(completed / total * 18)),
        onArchiveReady: () => { onProgress?.(40); onProgress?.(70); },
    }).catch((error: unknown) => {
        if (error instanceof TakeoutParseError || error instanceof OperationError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('no recognized conversation identities') || message.includes('Unsupported Takeout')) {
            throw new TakeoutParseError('Unsupported Takeout structure', true, 'MyActivity.html');
        }
        throw new TakeoutParseError(message, false);
    });
    const importedIds = new Set(results.map(result => result.conversationId));
    let resourceFailure = false;
    const batch = await admitArchivedConversations({
        accountId,
        items: results,
        yieldEvery: 50,
        resources,
        extract: result => ({
            conversationId: result.conversationId,
            parsed: result,
            bindResources: ctx => {
                for (const [assetId, bound] of Object.entries(result.archiveResources)) {
                    ctx.retain({ accountId, conversationId: result.conversationId }, assetId, async () => {
                        const bytes = await readTakeoutBytes(bound.entry);
                        if (!bytes?.byteLength) throw new Error('Empty Takeout resource');
                        return { bytes };
                    });
                }
            },
        }),
        onItemSettled: ({ item: result }) => {
            for (const asset of result.conversation.detail.assets) {
                if (!result.archiveResources[asset.id] && ![asset.sourceUri, result.acquisitionHints[asset.id]?.url, result.acquisitionHints[asset.id]?.sourceUrl].some(uri => /^(?:https?:\/\/|\/\/|data:)/i.test(uri ?? ''))
                    && !result.acquisitionHints[asset.id]?.dataBase64) resourceFailure = true;
            }
        },
    });
    onProgress?.(100);
    return {
        imported: importedIds.size,
        added: batch.addedCount,
        status: resourceFailure || batch.incompleteQuality ? 'partial' : 'ok',
    };
}
