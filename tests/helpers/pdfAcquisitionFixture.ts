import { preparePdfItem as prepare, type PdfSelectedItem, type PreparePdfItemContext } from '../../src/core/export/pdf/prepareItem.js';
import { ingestConversation } from '../../src/core/domain/ingestion.js';
export * from '../../src/core/export/pdf/prepareItem.js';
/** Source fixtures publish through L2 before the existing PDF workflow reads them. */
export async function preparePdfItem(selected: PdfSelectedItem, context: PreparePdfItemContext = {}) {
    if (typeof selected === 'object' && selected.conversation) await ingestConversation(selected.account.id, selected);
    return prepare(selected, context);
}
