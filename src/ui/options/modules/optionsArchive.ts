import type { Conversation } from '../../../types/conversation.js';
import { getDomainConversationResult } from '../../../core/storage/domain/nativePersistence.js';
import { normId } from '../../../core/utils/pathUtils.js';
import { getStore, getList, getStorage, getExportCtrl, getSyncCtrl, t } from '../optionsContext.js';
import { exportSelected } from './optionsExport.js';

let revision = 0;
let dismissed = '';

/** One non-blocking summary, scoped to the visible account. Closing always retains data. */
export async function renderArchiveNotice(conversations: Conversation[], slot: string, reload: () => Promise<void>): Promise<void> {
    const card = document.getElementById('archiveNotice');
    if (!card) return;
    const generation = ++revision;
    const affected = conversations.filter(c => c.cloudAvailability === 'deleted' || c.cloudAvailability === 'unlisted');
    const signature = slot + affected.map(c => `${c.id}:${c.cloudAvailability}`).sort().join('|');
    card.hidden = true;
    if (!affected.length || signature === dismissed) return;
    const rows = await Promise.all(affected.map(async conversation => ({ conversation,
        hasBody: !!(await getDomainConversationResult(slot, normId(conversation.id)))?.conversation.messages.length
    })));
    if (generation !== revision || getStore()?.getCurrentSlot() !== slot) return;
    card.replaceChildren();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = t('archiveSummary', rows.filter(r => r.conversation.cloudAvailability === 'deleted').length,
        rows.filter(r => r.conversation.cloudAvailability === 'unlisted').length, rows.filter(r => r.hasBody).length, rows.filter(r => !r.hasBody).length);
    details.append(summary);
    const note = document.createElement('p'); note.textContent = t('archiveRetainedNote'); details.append(note);
    const list = document.createElement('ul'); list.style.cssText = 'max-height:140px; overflow:auto; padding-left:20px;';
    for (const row of rows) {
        const li = document.createElement('li');
        li.textContent = `${row.conversation.title || row.conversation.id} — ${t(row.conversation.cloudAvailability === 'deleted' ? 'archiveCloudDeleted' : 'archiveUnlisted')} · ${t(row.hasBody ? 'archiveHasBody' : 'archiveMetadataOnly')}`;
        list.append(li);
    }
    details.append(list); card.append(details);
    const busy = () => !!getExportCtrl()?.isRunning() || !!getSyncCtrl()?.isScanning();
    const button = (key: string, action: () => Promise<void> | void) => {
        const element = document.createElement('button'); element.className = 'ghost small';
        element.textContent = t(key); element.style.margin = '6px 6px 0 0';
        element.onclick = () => { if (!busy()) void Promise.resolve(action()).catch(error => { note.textContent = String(error); details.open = true; }); };
        card.append(element); return element;
    };
    button('archiveExportLocal', async () => {
        if (getStore()?.getCurrentSlot() !== slot) return;
        getList()?.selectByIds?.(new Set(rows.filter(r => r.hasBody).map(r => r.conversation.id)), conversations);
        await exportSelected(null, true);
    }).disabled = !rows.some(r => r.hasBody);
    button('archiveCleanLocal', async () => {
        if (getStore()?.getCurrentSlot() !== slot || !window.confirm(t('archiveCleanConfirm', rows.length))) return;
        for (const row of rows) await getStorage().removeConversation(slot, row.conversation.id);
        await reload();
    });
    button('archiveDismiss', () => { dismissed = signature; card.hidden = true; });
    card.hidden = false;
}
