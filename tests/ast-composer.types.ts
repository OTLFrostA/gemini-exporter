import type { Account } from '../src/l2/accountRegistry.js';
import type { DomainConversation } from '../src/l2/conversation.js';
import type { ReadonlyDomain } from '../src/l2/runtimeValidation.js';
import type { DocumentAst } from '../src/l3b/ast/ast.js';
import { composeDomainDocument } from '../src/l3b/compose/composeDomainDocument.js';

// Compile-only checks: never execute composition with invented trust or absent bodies.
function composerContract(domain: ReadonlyDomain, indexOnly: DomainConversation, account: Readonly<Account>): DocumentAst {
    const document: DocumentAst = composeDomainDocument(domain, account);
    // @ts-expect-error Index-only Domain must be narrowed and admitted upstream.
    composeDomainDocument(indexOnly, account);
    // @ts-expect-error Composition returns the document without an envelope.
    document.document;
    // @ts-expect-error Composer does not return empty diagnostics.
    document.diagnostics;
    // @ts-expect-error L2 Index has no conversation URL fact.
    document.metadata.url;
    return document;
}
void composerContract;

// @ts-expect-error Disclosure titles are part of the reading tree, never a renderer fallback.
const missingDisclosureTitle: import('../src/l3b/ast/ast.js').DisplayBlock = { type: 'disclosure', kind: 'reasoning', blocks: [] };
void missingDisclosureTitle;
