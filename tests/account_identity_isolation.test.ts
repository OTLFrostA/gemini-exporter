import { withRegistry } from './helpers/registryMock.js';
import { bindTabAccounts } from './helpers/tabAccounts.js';
export {};
const test = require('node:test');
const assert = require('node:assert');

const { __setModuleOverride, __getModuleOverride } = require('../src/core/utils/moduleOverrides.js');

const {
    extractEmailFromText,
    extractNameFromLabel,
    sniffUserProfileFromDom
} = require('../src/content/accountSniffer.js');

const { resolveCred } = require('../src/core/api/client/credentialManager.js');
const TabService = require('../src/core/utils/tabService.js').default || require('../src/core/utils/tabService.js');
const ConversationsStore = require('../src/ui/state/conversationsStore.js');
const AccountView = require('../src/ui/views/accountView.js').default || require('../src/ui/views/accountView.js');

// ---------------------------------------------------------------------------
// 1. Account Sniffer Tests
// ---------------------------------------------------------------------------
test('accountSniffer - extractEmailFromText', () => {
    assert.strictEqual(extractEmailFromText('test.user+tag@gmail.com'), 'test.user+tag@gmail.com');
    assert.strictEqual(extractEmailFromText('Google Account: Alice (ALICE@GMAIL.COM)'), 'alice@gmail.com');
    assert.strictEqual(extractEmailFromText('no-email-here'), null);
    assert.strictEqual(extractEmailFromText(null), null);
    assert.strictEqual(extractEmailFromText(''), null);
});

test('accountSniffer - extractNameFromLabel', () => {
    assert.strictEqual(
        extractNameFromLabel('Google Account: John Doe (john@gmail.com)', 'john@gmail.com'),
        'John Doe'
    );
    assert.strictEqual(
        extractNameFromLabel('Google 帐号：张三 (zhangsan@gmail.com)', 'zhangsan@gmail.com'),
        '张三'
    );
    assert.strictEqual(
        extractNameFromLabel('Alice Smith\nalice@example.com', 'alice@example.com'),
        'Alice Smith'
    );
    assert.strictEqual(
        extractNameFromLabel('Bob Ross - bob@example.com', 'bob@example.com'),
        'Bob Ross'
    );
});

test('accountSniffer - sniffUserProfileFromDom DOM and global context', () => {
    // A: DOM button with aria-label
    const mockDoc1 = {
        querySelectorAll: (selector: string) => [
            {
                getAttribute: (attr: string) => {
                    if (attr === 'aria-label') return 'Google Account: Alice Wonderland (alice@example.com)';
                    return null;
                }
            }
        ],
        defaultView: {}
    } as any;

    const profile1 = sniffUserProfileFromDom(mockDoc1);
    assert.ok(profile1);
    assert.strictEqual(profile1?.email, 'alice@example.com');
    assert.strictEqual(profile1?.name, 'Alice Wonderland');
    assert.strictEqual(profile1?.email, 'alice@example.com');

    // B: DOM element with data-email attribute
    const mockDoc2 = {
        querySelectorAll: (selector: string) => [
            {
                getAttribute: (attr: string) => {
                    if (attr === 'data-email') return 'bob@corp.com';
                    return null;
                }
            }
        ],
        defaultView: {}
    } as any;

    const profile2 = sniffUserProfileFromDom(mockDoc2);
    assert.ok(profile2);
    assert.strictEqual(profile2?.email, 'bob@corp.com');
    assert.strictEqual(profile2?.name, undefined);
    assert.strictEqual(profile2?.email, 'bob@corp.com');

    // C: Gaia ID from window._WIZ_global_data
    const mockDoc3 = {
        querySelectorAll: () => [],
        defaultView: {
            _WIZ_global_data: {
                qDCSke: '10987654321'
            }
        }
    } as any;

    const profile3 = sniffUserProfileFromDom(mockDoc3);
    assert.ok(profile3);
    assert.strictEqual(profile3?.gaiaId, '10987654321');
    assert.strictEqual(profile3?.email, undefined);

    // D: Empty doc returns null
    const mockDoc4 = {
        querySelectorAll: () => [],
        defaultView: {}
    } as any;
    assert.strictEqual(sniffUserProfileFromDom(mockDoc4), null);
});

// ---------------------------------------------------------------------------
// 2. Credential Isolation Tests
// ---------------------------------------------------------------------------
test('credentialManager - resolveCred prevents cross-account token theft', async () => {
    const origChrome = (global as any).chrome;
    try {
        const credMap = {
            sid_u0: {
                sid: 'sid_u0',
                at: 'SECRET_TOKEN_U0',
                accountSlot: 'u0',
                lastUsed: 1000
            }
        };

        (global as any).chrome = {
            storage: {
                session: {
                    get: async () => ({ gemini_credentials_map: credMap }),
                    set: async () => {}
                },
                local: {
                    get: async () => ({ gemini_credentials_map: credMap }),
                    set: async () => {}
                }
            }
        };

        // When u1 credentials do not exist, resolveCred for u1 MUST NOT return SECRET_TOKEN_U0!
        const resultU1 = await resolveCred(null, { accountSlot: 'u1' });
        assert.strictEqual(resultU1.accountSlot, 'u1');
        assert.strictEqual(resultU1.at, '', 'Must not leak u0 token to u1');

        // When u0 credentials exist, resolving for u0 returns the u0 token
        const resultU0 = await resolveCred(null, { accountSlot: 'u0' });
        assert.strictEqual(resultU0.accountSlot, 'u0');
        assert.strictEqual(resultU0.at, 'SECRET_TOKEN_U0');
    } finally {
        (global as any).chrome = origChrome;
    }
});

// ---------------------------------------------------------------------------
// 3. Strict Tab Routing Tests
// ---------------------------------------------------------------------------
test('tabService - getGeminiTab and sendToGeminiTab enforce strict slot matching', async () => {
    const origChrome = (global as any).chrome;
    try {
        const mockTabs = [
            { id: 101, url: 'https://gemini.google.com/u/0/app', active: true },
            { id: 102, url: 'https://gemini.google.com/u/1/app', active: false }
        ];

        (global as any).chrome = {
            tabs: {
                query: async (q: any) => mockTabs,
                sendMessage: (tabId: number, msg: any, cb: (res: any) => void) => {
                    cb({ ok: true, tabId, receivedMsg: msg });
                }
            },
            runtime: {}
        };

        bindTabAccounts({101: '10000000-0000-4000-8000-000000000001', 102: '10000000-0000-4000-8000-000000000002'});
        // getGeminiTab('10000000-0000-4000-8000-000000000001') returns tab 101
        const tabU0 = await TabService.getGeminiTab('10000000-0000-4000-8000-000000000001');
        assert.strictEqual(tabU0?.id, 101);

        // getGeminiTab('10000000-0000-4000-8000-000000000002') returns tab 102
        const tabU1 = await TabService.getGeminiTab('10000000-0000-4000-8000-000000000002');
        assert.strictEqual(tabU1?.id, 102);

        // getGeminiTab('10000000-0000-4000-8000-000000000003') returns null because no tab matches u2
        const tabU2 = await TabService.getGeminiTab('10000000-0000-4000-8000-000000000003');
        assert.strictEqual(tabU2, null, 'Must return null when requested slot tab is absent');

        // sendToGeminiTab('10000000-0000-4000-8000-000000000002') sends message to tab 102
        const resU1 = await TabService.sendToGeminiTab({ action: 'ping' }, '10000000-0000-4000-8000-000000000002');
        assert.strictEqual(resU1.tabId, 102);

        // sendToGeminiTab('10000000-0000-4000-8000-000000000003') throws error instead of silently targeting u0 or u1
        await assert.rejects(
            async () => {
                await TabService.sendToGeminiTab({ action: 'ping' }, '10000000-0000-4000-8000-000000000003');
            },
            /matches the selected account/
        );
    } finally {
        (global as any).chrome = origChrome;
    }
});

// ---------------------------------------------------------------------------
// 4. Conversations Store Empty Slot Isolation Tests
// ---------------------------------------------------------------------------
test('conversationsStore - loadStore does not hijack empty slot', async () => {
    const origChrome = (global as any).chrome;
    (global as any).chrome = withRegistry({});
    try {
        const mockStorage = {
            listAccounts: async () => ([{id:'10000000-0000-4000-8000-000000000001',providerId:'gemini',providerAccountId:'main'},{id:'10000000-0000-4000-8000-000000000002',providerId:'gemini',providerAccountId:'empty'}]),
            listIndexes: async (slot: string) => {
                if (slot === '10000000-0000-4000-8000-000000000001') return [{ id: 'c1', title: 'Chat 1' }];
                return [];
            },
            listExportRecords: async () => ({})
        };

        const origStorage = __getModuleOverride('StorageService');
        __setModuleOverride('StorageService', mockStorage);

        // When explicitly loading slot '10000000-0000-4000-8000-000000000002', even if incoming is empty, it MUST stay on '10000000-0000-4000-8000-000000000002'!
        const result = await ConversationsStore.loadStore('10000000-0000-4000-8000-000000000002');
        assert.strictEqual(result.accountId, '10000000-0000-4000-8000-000000000002', 'Should stay on u1 even if u1 has 0 conversations');
        assert.strictEqual(result.conversations.length, 0);
        assert.strictEqual(ConversationsStore.getCurrentAccountId(), '10000000-0000-4000-8000-000000000002');
    } finally {
        __setModuleOverride('StorageService', undefined as any);
        (global as any).chrome = origChrome;
    }
});

// ---------------------------------------------------------------------------
// 5. Account View Display Name & Email Tests
// ---------------------------------------------------------------------------
test('accountView - renders user email and name accurately in dropdown', () => {
    const mockSelect: any = {
        id: 'accountIdSelect',
        style: {},
        innerHTML: '',
        children: [] as any[],
        replaceChildren() { this.children = []; },
        appendChild(el: any) { this.children.push(el); }
    };

    const origDoc = (global as any).document;
    try {
        (global as any).document = {
            getElementById: (id: string) => id === 'accountIdSelect' ? mockSelect : null,
            createElement: (tag: string) => ({
                tagName: tag.toUpperCase(),
                value: '',
                selected: false,
                textContent: ''
            })
        };

        AccountView.render([{ id:'10000000-0000-4000-8000-000000000001',providerId:'gemini',providerAccountId:'one',displayName:'张三',email:'zhangsan@gmail.com'},{id:'10000000-0000-4000-8000-000000000002',providerId:'gemini',providerAccountId:'two',email:'lisi@gmail.com'}], '10000000-0000-4000-8000-000000000002');

        assert.strictEqual(mockSelect.children.length, 2);
        assert.strictEqual(mockSelect.children[0].value, '10000000-0000-4000-8000-000000000001');
        assert.strictEqual(mockSelect.children[0].textContent, '张三 (zhangsan@gmail.com) · gemini');
        assert.strictEqual(mockSelect.children[1].value, '10000000-0000-4000-8000-000000000002');
        assert.strictEqual(mockSelect.children[1].textContent, 'lisi@gmail.com · gemini');
        assert.strictEqual(mockSelect.children[1].selected, true);
    } finally {
        (global as any).document = origDoc;
    }
});

test('credentialManager - concurrent resolveCred calls serialize safely without race condition', async () => {
    const origChrome = (global as any).chrome;
    try {
        let activeOps = 0;
        let maxActiveOps = 0;
        const credStore: any = {
            gemini_credentials_map: {
                sid_u0: {
                    sid: 'sid_u0',
                    at: 'TOKEN_U0',
                    accountSlot: 'u0',
                    lastUsed: 1000
                }
            }
        };

        (global as any).chrome = {
            storage: {
                session: {
                    get: async () => {
                        activeOps++;
                        if (activeOps > maxActiveOps) maxActiveOps = activeOps;
                        await new Promise(r => setTimeout(r, 10));
                        activeOps--;
                        return JSON.parse(JSON.stringify(credStore));
                    },
                    set: async (obj: any) => {
                        activeOps++;
                        if (activeOps > maxActiveOps) maxActiveOps = activeOps;
                        await new Promise(r => setTimeout(r, 10));
                        Object.assign(credStore, JSON.parse(JSON.stringify(obj)));
                        activeOps--;
                    }
                },
                local: {
                    get: async () => ({}),
                    set: async () => {},
                    remove: async () => {}
                }
            }
        };

        const results = await Promise.all([
            resolveCred('sid_u0'),
            resolveCred('sid_u0'),
            resolveCred('sid_u0'),
            resolveCred('sid_u0'),
            resolveCred('sid_u0'),
        ]);

        for (const res of results) {
            assert.strictEqual(res.sid, 'sid_u0');
            assert.strictEqual(res.at, 'TOKEN_U0');
        }
        assert.strictEqual(maxActiveOps, 1, 'Concurrent resolveCred calls must be serialized (maxActiveOps === 1)');
    } finally {
        (global as any).chrome = origChrome;
    }
});

test('accountSniffer - current Gemini Wiz tuple wins over another account DOM label', () => {
    const doc = {
        querySelectorAll: () => [{ getAttribute: (key: string) => key === 'aria-label' ? 'Google Account: Other (other@example.com)' : null }],
        defaultView: { WIZ_global_data: { qDCSke: '109876543210987654321', oPEP7c: 'ACTIVE@EXAMPLE.COM' } }
    } as unknown as Document;
    const profile = sniffUserProfileFromDom(doc);
    assert.equal(profile?.gaiaId, '109876543210987654321');
    assert.equal(profile?.email, 'active@example.com');
    assert.equal(profile?.name, undefined);
    assert.equal(profile?.email, 'active@example.com');
    assert.equal('accountId' in (profile || {}), false);
});

test('accountSniffer - obsolete or malformed Wiz fields do not become provider account IDs', () => {
    for (const wiz of [{ oTI7oc: '10987654321' }, { qDCSke: 'not-a-gaia-id' }, { qDCSke: 10987654321 }]) {
        const doc = { querySelectorAll: () => [], defaultView: { WIZ_global_data: wiz } } as unknown as Document;
        assert.equal(sniffUserProfileFromDom(doc), null);
    }
});
