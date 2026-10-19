import { listAccounts } from '../../core/api/accountRegistry.js';
import { listIndexes, listExportRecords } from '../../core/storage/storageService.js';
import type { Account } from '../../core/domain/accountRegistry.js';
import type { DomainConversationIndex } from '../../core/domain/conversationIndex.js';
import type { ExportRecord } from '../../core/application/export/types.js';

/** Options-only read mirror and explicit selection. No Domain writes or Skip decisions. */
export class ConversationViewState {
    accounts: Account[] = [];
    accountId: string | null = null;
    indexes: DomainConversationIndex[] = [];
    records: Record<string, ExportRecord> = {};
    selected = new Set<string>();
    search = '';
    filter = 'all';
    private revision = 0;
    constructor(private readonly reads = { listAccounts, listIndexes, listExportRecords }) {}
    selectAccount(id: string | null): void {
        if (id === this.accountId) return;
        this.revision++;
        this.accountId = id;
        this.indexes = []; this.records = {}; this.selected.clear();
    }
    async refresh(): Promise<void> {
        const revision = ++this.revision;
        const accounts = await this.reads.listAccounts();
        if (revision !== this.revision) return;
        const id = accounts.some(a => a.id === this.accountId) ? this.accountId : accounts[0]?.id ?? null;
        if (id !== this.accountId) { this.accountId = id; this.selected.clear(); }
        this.accounts = accounts;
        const [indexes, records] = id
            ? await Promise.all([this.reads.listIndexes(id), this.reads.listExportRecords(id)]) : [[], {}];
        if (revision !== this.revision || id !== this.accountId) return;
        this.indexes = indexes; this.records = records;
        const available = new Set(indexes.map(row => row.key.conversationId));
        for (const id of this.selected) if (!available.has(id)) this.selected.delete(id);
    }
    visible(): DomainConversationIndex[] {
        const query = this.search.trim().toLowerCase();
        return this.indexes.filter(row => {
            const record = this.records[row.key.conversationId];
            const matches = this.filter === 'all' || (this.filter === 'exported' ? !!record : !record);
            return matches && (!query || `${row.title ?? ''} ${row.key.conversationId}`.toLowerCase().includes(query));
        }).sort((a, b) => (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity));
    }
    keys() {
        return this.indexes.filter(row => this.selected.has(row.key.conversationId)).map(row => ({ ...row.key }));
    }
    selectVisible(): void { for (const row of this.visible()) this.selected.add(row.key.conversationId); }
}
