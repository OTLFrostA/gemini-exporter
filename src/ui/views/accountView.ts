import type { Account } from '../../core/domain/accountRegistry.js';
import type { IAccountView } from '../../types/ui.js';
import { $, t } from '../uiCommon.js';

export function render(accounts: Account[], accountId: string): void {
    const select = $('accountIdSelect');
    if (!select) return;
    select.style.display = accounts.length ? 'inline-block' : 'none';
    select.replaceChildren();
    for (const account of accounts) {
        const option = document.createElement('option');
        option.value = account.id;
        option.selected = account.id === accountId;
        const label = account.providerAccountId === 'default' ? t('defaultAccount')
            : account.email ? account.displayName ? `${account.displayName} (${account.email})` : account.email
            : account.displayName || account.providerAccountId;
        option.textContent = `${label} · ${account.providerId}`;
        select.appendChild(option);
    }
}
export const AccountView: IAccountView = { render };
export default AccountView;
