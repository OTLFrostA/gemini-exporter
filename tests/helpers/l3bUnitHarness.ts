import Module from 'node:module';
import { readAccount as realReadAccount, type Account } from '../../src/l2/accountRegistry.js';
import type { DomainConversationWithDetail } from '../../src/l2/conversation.js';
import { sameConversationKey as realSameConversationKey } from '../../src/l2/conversationKey.js';
import type { ReadonlyDomain } from '../../src/l2/runtimeValidation.js';
import { tableCellPlacements as realTableCellPlacements } from '../../src/l2/content/tableLayout.js';

type L2TablePlacements = typeof realTableCellPlacements;

export function mockAccount(providerId = 'chatgpt', id = '10000000-0000-4000-8000-000000000004'): Account {
    return { id, providerId, providerAccountId: 'fixture-user' };
}

/** Upstream has already admitted these typed Domain facts; L3b does not revalidate them. */
export function givenReadonlyDomain(value: DomainConversationWithDetail): ReadonlyDomain {
    return value;
}

export const mockedL2Calls: {
    accounts: unknown[];
    keys: Array<Parameters<typeof realSameConversationKey>>;
    tables: Array<Parameters<L2TablePlacements>[0]>;
} = { accounts: [], keys: [], tables: [] };

const readAccount: typeof realReadAccount = value => {
    mockedL2Calls.accounts.push(value);
    return realReadAccount(value);
};

const sameConversationKey: typeof realSameConversationKey = (left, right) => {
    mockedL2Calls.keys.push([left, right]);
    return realSameConversationKey(left, right);
};

const tableCellPlacements: L2TablePlacements = function* (table) {
    mockedL2Calls.tables.push(table);
    yield* realTableCellPlacements(table);
};

type Loader = { _load(request: string, parent?: NodeModule | null, isMain?: boolean): unknown };
const loader = Module as unknown as Loader;
const originalLoad = loader._load;
let composer: typeof import('../../src/l3b/compose/composeDomainDocument.js');
loader._load = (request, parent, isMain) => {
    const caller = parent?.filename.replace(/\\/g, '/') ?? '';
    if (caller.includes('/src/l3b/') && request.includes('/l2/')) {
        if (request === '../../l2/accountRegistry.js') return { readAccount };
        if (request === '../../l2/conversationKey.js') return { sameConversationKey };
        if (request === '../../l2/content/tableLayout.js') return { tableCellPlacements };
    }
    return originalLoad.call(loader, request, parent, isMain);
};
try {
    composer = require('../../src/l3b/compose/composeDomainDocument.js') as typeof import('../../src/l3b/compose/composeDomainDocument.js');
} finally {
    loader._load = originalLoad;
}

export const composeDomainDocument = composer.composeDomainDocument;
