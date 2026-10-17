import { getConversationAvailability } from '../../../core/storage/conversationAvailability.js';
import type { DomainConversationIndex } from '../../../types/conversation.js';
import { getStore, getStorage, getExportCtrl, getSyncCtrl, t } from '../optionsContext.js';

let dismissed = '';

/** One non-blocking summary, scoped to the visible account. Closing always retains data. */
export async function renderArchiveNotice(conversations: DomainConversationIndex[], slot: string, reload: () => Promise<void>): Promise<void> {
    const card = document.getElementById('archiveNotice');
    if (!card || getStore()?.getCurrentAccountId() !== slot) return;
    const availability = await getConversationAvailability(slot);
    if (getStore()?.getCurrentAccountId() !== slot) return;
    const affected = conversations.filter(c => availability[c.key.conversationId] === 'deleted');
    const signature = slot + affected.map(c => `${c.key.conversationId}:deleted`).sort().join('|');
    if (!affected.length || signature === dismissed) {
        card.hidden = true;
        return;
    }
    // Build the notice synchronously, without hiding it or loading archived bodies on each list update.
    const content = document.createDocumentFragment();
    const note = document.createElement('p'); note.textContent = t('archiveSummary'); content.append(note);
    const busy = () => !!getExportCtrl()?.isRunning() || !!getSyncCtrl()?.isScanning();
    const button = (key: string, action: () => Promise<void> | void) => {
        const element = document.createElement('button'); element.className = 'ghost small';
        element.textContent = t(key); element.style.margin = '6px 6px 0 0';
        element.onclick = () => { if (!busy()) void Promise.resolve(action()).catch(error => { note.textContent = String(error); }); };
        content.append(element);
    };
    button('archiveDismiss', () => { dismissed = signature; card.hidden = true; });
    button('archiveCleanLocal', async () => {
        if (getStore()?.getCurrentAccountId() !== slot || !window.confirm(t('archiveCleanConfirm', affected.length))) return;
        for (const conversation of affected) await getStorage().removeConversation(slot, conversation.key.conversationId);
        await reload();
    });
    card.replaceChildren(content);
    card.hidden = false;
}
