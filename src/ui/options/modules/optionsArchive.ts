import type { Conversation } from '../../../types/conversation.js';
import { getStore, getStorage, getExportCtrl, getSyncCtrl, t } from '../optionsContext.js';

let dismissed = '';

/** One non-blocking summary, scoped to the visible account. Closing always retains data. */
export async function renderArchiveNotice(conversations: Conversation[], slot: string, reload: () => Promise<void>): Promise<void> {
    const card = document.getElementById('archiveNotice');
    if (!card || getStore()?.getCurrentSlot() !== slot) return;
    const affected = conversations.filter(c => c.cloudAvailability === 'deleted');
    const signature = slot + affected.map(c => `${c.id}:${c.cloudAvailability}`).sort().join('|');
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
        if (getStore()?.getCurrentSlot() !== slot || !window.confirm(t('archiveCleanConfirm', affected.length))) return;
        for (const conversation of affected) await getStorage().removeConversation(slot, conversation.id);
        await reload();
    });
    card.replaceChildren(content);
    card.hidden = false;
}
