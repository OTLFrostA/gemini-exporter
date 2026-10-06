import type { CanonicalSemanticMessage } from '../src/core/export/canonical/messageInput.js';
const semantic: CanonicalSemanticMessage = { role: 'assistant', content: [] };
// @ts-expect-error Shared Canonical packaging accepts semantic AST, never raw Markdown.
const raw: CanonicalSemanticMessage = { role: 'assistant', content: '# raw' };
// @ts-expect-error Shared Canonical packaging cannot accept provider body structure.
const provider: CanonicalSemanticMessage = { role: 'assistant', content: [], structuredContent: {} };
void semantic;
void raw;
void provider;
