import type { Account } from '../../l2/accountRegistry.js';
import type { ConversationKey } from '../../l2/conversationKey.js';
import { readConversation } from '../../l2/readConversation.js';
import { composeDomainDocument } from '../../l3b/compose/composeDomainDocument.js';
import { renderDocumentMarkdown } from '../../l4/format/markdown/renderMarkdown.js';
import { buildExportFileName } from '../../shared/utils/pathUtils.js';

export interface DriveMarkdownDocument {
    name: string;
    markdown: string;
}

/** Only committed complete local snapshots; no source RPCs, attachment bytes, or local ExportRecord writes.
 * Reuses the canonical Domain -> Document AST -> Markdown pipeline.
 */
export async function renderDriveMarkdown(key: ConversationKey, account: Account,
    locale: 'en' | 'zh'): Promise<DriveMarkdownDocument | null> {
    const snapshot = await readConversation(key);
    if (!snapshot || snapshot.detail.quality.status !== 'complete') return null;
    const turn = snapshot.detail.quality.sourceTurn;
    if (turn && turn !== 'finished' && turn !== 'interrupted') return null;
    const updated = snapshot.index.updatedAt;
    const saved = snapshot.detail.savedAt;
    if (updated !== undefined && (saved === undefined || saved < updated)) return null;
    const document = composeDomainDocument(snapshot, account);
    return {
        name: buildExportFileName(document.title, key.conversationId, 'md'),
        markdown: renderDocumentMarkdown(document, {}, { locale }),
    };
}
