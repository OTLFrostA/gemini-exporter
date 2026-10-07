import type { DomainMessage } from '../src/core/domain/conversationDetail.js';
const semantic: DomainMessage = { role: 'assistant', content: [] };
// @ts-expect-error Domain accepts semantic AST, never raw Markdown.
const raw: DomainMessage = { role: 'assistant', content: '# raw' };
// @ts-expect-error Domain cannot accept provider body structure.
const provider: DomainMessage = { role: 'assistant', content: [], structuredContent: {} };
void semantic;
void raw;
void provider;
