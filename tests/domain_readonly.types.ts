import { fixtureAccountFor } from './helpers/domainFixture.js';
import type { DomainConversationWithDetail } from '../src/core/domain/conversation.js';
import type { ReadonlyDomain, TrustedDomain } from '../src/core/domain/runtimeValidation.js';
import { composeDomainDocument } from '../src/core/document/compose/composeDomainDocument.js';
import { serializeDomainJson } from '../src/core/renderers/json/serializeDomainJson.js';
import { contentComposer } from '../src/core/document/compose/composeContent.js';

// These checks exercise the actual consumer signatures, including their nested fields.
function consumerContract(input: Parameters<typeof composeDomainDocument>[0]) {
    // @ts-expect-error Consumers cannot rewrite metadata.
    input.index.title = 'changed';
    // @ts-expect-error Consumers cannot replace the body.
    input.detail = { quality: { status: 'complete' }, messages: [], assets: [] };
    // @ts-expect-error Consumers cannot append messages.
    input.detail.messages.push({ role: 'assistant', content: [] });
    // @ts-expect-error Consumers cannot edit message-owned references.
    input.detail.messages[0].attachmentIds?.push('missing');
    // @ts-expect-error Consumers cannot rewrite nested resource provenance.
    input.detail.assets[0].generation!.prompt = 'changed';
    // @ts-expect-error Consumers cannot mutate nested Content AST nodes.
    input.detail.messages[0].content[0].type = 'math';
    // @ts-expect-error Consumers cannot recover a mutable builder by assignment.
    const builder: DomainConversationWithDetail = input;
    const html: Parameters<typeof serializeDomainJson>[0] = input;
    const markdown: Parameters<typeof composeDomainDocument>[0] = input;
    // @ts-expect-error Export entry points also expose only read-only views.
    html.detail.assets[0].id = 'changed';
    // @ts-expect-error Export entry points also expose only read-only arrays.
    markdown.detail.messages[0].content.splice(0);
    void builder;
}
function contentContract(nodes: Parameters<ReturnType<typeof contentComposer>>[0]) {
    const node = nodes[0];
    if (node.type === 'paragraph') {
        // @ts-expect-error Read-only reaches arrays inside Content AST nodes.
        node.children.push({ type: 'text', text: 'changed' });
        if (node.children[0].type === 'text') {
            // @ts-expect-error Read-only reaches leaf values too.
            node.children[0].text = 'changed';
        }
    }
}
function producerContract(builder: DomainConversationWithDetail, trusted: TrustedDomain) {
    builder.detail.messages.push({ role: 'assistant', content: [] });
    const view: ReadonlyDomain = trusted;
    composeDomainDocument(view, fixtureAccountFor(view));
    void exportDomainHtml(view, fixtureAccountFor(view)); void exportDomainMarkdown(view, fixtureAccountFor(view));
}
void [consumerContract, contentContract, producerContract];
