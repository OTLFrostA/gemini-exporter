/**
 * P1-G type regression contracts.
 *
 * Compile-time contracts are checked by 'npm run type-check', not by the
 * Node test runner. Keep them in an uncalled function so no tautological
 * runtime tests ("assign a value, then read it back") inflate test counts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { historicalFixture } from './helpers/nativeFixture.js';
import type { HistoricalConversation as Conversation } from './helpers/historicalConversation.js';
import type { ChatMessage, Attachment } from './helpers/historicalConversation.js';
import type { MessageAction } from '../src/types/messages.js';

// P1-090, 091, 092, 093, 098, 099, 100 are type-check contracts.
// The @ts-expect-error directives fail compilation if forbidden types
// become legal again, so they are intentionally not runtime assertions.
function typecheckContracts(): void {
    const fromParser: ChatMessage = { role: 'model', content: 'hi', thoughts: 'joined thoughts' };
    const fromOtherProvider: ChatMessage = { role: 'model', content: 'hi', thoughts: ['a', 'b'] };

    // P1-091: core types must reject undeclared fields.
    // @ts-expect-error - arbitrary Conversation fields must not be legal
    type _NoConversationIndex = Conversation['someUndeclaredProp'];
    // @ts-expect-error - arbitrary ChatMessage fields must not be legal
    type _NoMessageIndex = ChatMessage['anotherUndeclaredProp'];

    const message: ChatMessage = {
        role: 'model', content: 'x',
        images: [{ type: 'image', fileName: 'a.png', localName: 'assets/a.png' }],
        thinking: 'legacy thought text',
        attachmentCount: 2,
    };
    const conversation: Conversation = {
        id: 'c_1', title: 't', timestamp: 123,
        attachmentCount: 2, messageCount: 5,
        href: 'https://gemini.google.com/app/c_1',
        hasExplicitPrompt: true,
    };
    const attachment: Attachment = {
        type: 'image', name: 'alt', isGenerated: true,
        isImage: true, subDir: 'assets', source: 'takeout'
    };

    // P1-092: supported actions remain valid without freezing the total
    // number of actions when ChatGPT/Claude support is added.
    const actions: MessageAction[] = [
        'openOptions', 'getAccountContext', 'getFileBlob', 'getImageBlob',
        'ensureV2Ready', 'domainIngest', 'getLocalIndexCount', 'runLiveSave',
    ];
    // @ts-expect-error - the deleted ghost action cannot be reintroduced
    const invalidAction: MessageAction = 'startExport';

    type IsAny<T> = 0 extends (1 & T) ? true : false;

    // P1-099: removed ambient globals must stay gone and the one retained
    // global API client declaration must not revert to any.
    // @ts-expect-error - removed global must not become ambient again
    type _NoBadgeView = typeof BadgeView;
    const clientMustBeTyped: IsAny<typeof GeminiAPIClient> = false;

    // P1-100: these model types must not reappear in the public API.
    // @ts-expect-error - deleted public type
    type _NoThoughtBlock = import('./helpers/historicalConversation.js').ThoughtBlock;
    // @ts-expect-error - deleted public type
    type _NoCitationSource = import('./helpers/historicalConversation.js').CitationSource;

    void fromParser; void fromOtherProvider;
    void message; void conversation; void attachment; void actions;
    void invalidAction;
    void clientMustBeTyped;
}
void typecheckContracts;

// P1-094 is a real runtime invariant: consumers rely on this hierarchy.
test('P1-094: live error subclasses extend GeminiError and dead class stays absent', () => {
    const errors = require('../src/types/errors.js');
    assert.equal(errors.GeminiRpcError, undefined);
    assert.equal(typeof errors.GeminiError, 'function');
    for (const name of ['ExportPipelineError', 'TakeoutParseError', 'StorageError']) {
        assert.ok(new errors[name]('x') instanceof errors.GeminiError, name);
    }
});

// P1-097: a removed unused file is not a runtime contract; deleted.
// P1-101: a particular unused import is not runtime behavior; deleted.
