import type { ConversationParseContext } from '../../contracts.js';
import type { DomainConversationDetail, DomainMessage } from '../../../domain/conversationDetail.js';
import type { Diagnostic } from '../../../diagnostics/contentDiagnostic.js';
import type { ResourceConversationParseResult } from '../../parsingResult.js';
import { parseDomContent } from './content.js';
import { closeDomainResources } from '../../shared/resources/domainResourceAdapter.js';
import type { ResourceEvidence } from '../../shared/resources/resourceEvidence.js';
import { assertDomainClosure } from '../../../domain/closure.js';

export interface GeminiDomRaw { document: Document; id: string; url?: string }
export interface GeminiDomParseResult extends ResourceConversationParseResult {
    transport: { fallbackUsed: string | null; nodeCount: number; htmlLen: number };
}
const fallbackSelectors = ['[data-test-id*="user-query"]', '[data-test-id*="model-response"]', '[data-message-author-role="user"]', '[data-message-author-role="model"]', '[data-message-author-role="assistant"]', 'div[data-test-id="conversation-turn"]', 'div[role="article"]'];
const roleOf = (node: Element): 'user' | 'assistant' | undefined => {
    const role = node.getAttribute?.('data-message-author-role');
    if (node.tagName.toLowerCase() === 'user-query' || role === 'user' || node.getAttribute?.('data-test-id')?.includes('user-query')) return 'user';
    if (node.tagName.toLowerCase() === 'model-response' || role === 'model' || role === 'assistant' || node.getAttribute?.('data-test-id')?.includes('model-response')) return 'assistant';
    if (node.querySelector('.query-text-line, .query-text, [data-test-id="query-text"]')) return 'user';
    if (node.querySelector('.markdown, message-content')) return 'assistant';
    return undefined;
};

/** A visible DOM fragment is source evidence; it never proves full conversation coverage. */
export function parseGeminiDomConversation(raw: GeminiDomRaw, context: ConversationParseContext): GeminiDomParseResult {
    if (context.providerId !== 'gemini') throw new TypeError('Gemini DOM parser requires providerId gemini');
    if (!raw.document || typeof raw.document.querySelectorAll !== 'function') throw new TypeError('Gemini DOM parser requires a source Document');
    const id = raw.id.trim();
    if (!id) throw new TypeError('Gemini DOM parser requires a conversation identity');
    const doc = raw.document;
    let nodes = Array.from(doc.querySelectorAll('user-query, model-response'));
    let fallbackUsed: string | null = null;
    if (!nodes.length) {
        const found: Element[] = [];
        for (const selector of fallbackSelectors) {
            const values = Array.from(doc.querySelectorAll(selector));
            if (values.length && !fallbackUsed) fallbackUsed = selector;
            found.push(...values);
        }
        const unique = [...new Set(found)];
        // Prefer explicitly authored message nodes over aggregate turn/article wrappers.
        nodes = unique.filter(node => !unique.some(child => child !== node && typeof node.contains === 'function' && node.contains(child) && roleOf(child)));
    }
    nodes.sort((a, b) => (a.compareDocumentPosition(b) & 4) ? -1 : 1);
    const diagnostics: Diagnostic[] = [];
    const messages: DomainMessage[] = [];
    const groups: Array<{ input: { attachments: ResourceEvidence[] } }> = [];
    for (const node of nodes) {
        const role = roleOf(node);
        if (!role) continue;
        const body = role === 'user' ? node.querySelector('.query-text, [data-test-id="query-text"]') ?? node
            : node.querySelector('.markdown, message-content, [data-test-id="model-response-content"]') ?? node;
        const markup = typeof body.innerHTML === 'string' ? body.innerHTML : (body.textContent ?? '');
        const attachments: ResourceEvidence[] = Array.from(node.querySelectorAll('img')).filter(img => img.getAttribute?.('aria-hidden') !== 'true' && img.getAttribute?.('role') !== 'presentation').flatMap(img => {
            const original = img.getAttribute?.('src') ?? '';
            const uri = (img as HTMLImageElement).src || original;
            if (!uri) return [];
            const alt = img.getAttribute?.('alt') ?? '';
            return [{ type: 'image', url: original || uri, sourceUrl: uri, ...(alt ? { name: alt } : {}), source: 'dom' }];
        });
        for (const link of Array.from(node.querySelectorAll('a[download], a[data-file-name], audio, video'))) {
            const media = link.tagName.toLowerCase();
            const source = media === 'audio' || media === 'video' ? link.querySelector('source[src]') : null;
            const original = link.getAttribute(media === 'a' ? 'href' : 'src') || source?.getAttribute('src');
            if (!original) continue;
            const uri = media === 'a' ? (link as HTMLAnchorElement).href : (link as HTMLMediaElement).currentSrc || (link as HTMLMediaElement).src || (source as HTMLSourceElement | null)?.src;
            const name = link.getAttribute('download') || link.getAttribute('data-file-name') || link.textContent?.trim();
            const mimeType = link.getAttribute('type') || source?.getAttribute('type');
            attachments.push({ type: media === 'audio' || media === 'video' ? media : 'file', url: original, sourceUrl: uri || original,
                ...(name ? { name } : {}), ...(mimeType ? { mimeType } : {}), source: 'dom' });
        }
        if (!markup.trim() && !attachments.length) continue;
        const sourceId = node.getAttribute?.('data-message-id');
        const time = node.querySelector('time[datetime]')?.getAttribute('datetime') ?? node.getAttribute?.('data-timestamp-ms');
        const timestamp = time ? (Number.isFinite(Number(time)) ? Number(time) : Date.parse(time)) : undefined;
        const model = node.getAttribute?.('data-model-name') ?? node.querySelector('[data-model-name]')?.getAttribute('data-model-name');
        messages.push({ role, ...(sourceId ? { id: sourceId } : {}), ...(model ? { model } : {}),
            ...(timestamp !== undefined && Number.isFinite(timestamp) ? { timestamp } : {}),
            content: parseDomContent(body) });
        groups.push({ input: { attachments } });
    }
    const resources = closeDomainResources('gemini', messages, groups, { sourceReferences: true });
    const dates = messages.flatMap(m => m.timestamp === undefined ? [] : [m.timestamp]);
    const title = (doc.title ?? doc.querySelector('title')?.textContent ?? '').trim().replace(/\s*[-–|]\s*(?:Google\s+)?Gemini$/i, '').trim();
    const authoredTitle = title && !/^(?:Google\s+)?(?:Gemini|Bard)$/i.test(title);
    const conversation: DomainConversationDetail = { providerId: 'gemini', id, title: authoredTitle ? title : id,
        titleSource: authoredTitle ? 'dom' : 'default', titles: authoredTitle ? { dom: title } : {},
        provenance: { source: 'gemini-dom' }, completeness: { status: 'partial', reason: 'DOM observation contains only the currently available page fragment' },
        timestamp: dates.length ? Math.max(...dates) : null, createdAt: dates.length ? Math.min(...dates) : null, updatedAt: dates.length ? Math.max(...dates) : null,
        url: raw.url ?? `https://gemini.google.com/app/${id}`, messages: resources.messages, assets: resources.assets };
    assertDomainClosure(conversation);
    return { conversation, resourceHints: {}, acquisitionHints: resources.acquisitionHints,
        diagnostics: diagnostics.map(d => ({ severity: d.severity, code: d.code, message: d.message, path: d.path })),
        transport: { fallbackUsed, nodeCount: nodes.length, htmlLen: doc.documentElement?.outerHTML?.length ?? 0 } };
}
