import type { Conversation, ChatMessage, Attachment } from '../../../types/conversation.js';
import type { DomainConversationDetail, DomainMessage, DomainAsset } from '../../domain/conversationDetail.js';
import type { BlockNode } from '../../domain/content/blocks.js';
import type { InlineNode } from '../../domain/content/inline.js';
import { assertDomainClosure } from '../../domain/closure.js';
import type { ResourceAcquisitionHints } from '../../parsers/shared/resources/resourceAcquisitionHints.js';

/** External record serialization converts native blocks into message strings. */
function messageMarkdown(message: DomainMessage, assets: Map<string, DomainAsset>, blocks = message.content): string {
    const assetUri = (id: string): string => assets.get(id)?.source?.uri ?? '';
    const inline = (nodes: InlineNode[], tableCell = false): string => nodes.map(node => {
        switch (node.type) {
            case 'text': return node.text.replace(/[\\`*_\[\]<>$#]/g, character => `\\${character}`);
            case 'strong': return `**${inline(node.children, tableCell)}**`;
            case 'emphasis': return `*${inline(node.children, tableCell)}*`;
            case 'strikethrough': return `~~${inline(node.children, tableCell)}~~`;
            case 'inlineCode': {
                // GFM treats even backslash runs before a pipe as a column boundary,
                // including inside code spans. Encode that literal code as inline HTML.
                if (tableCell && /\\+\|/.test(node.code)) return `<code>${node.code.replace(/[&<>\\|`*_{}\[\]]/g, character => `&#${character.charCodeAt(0)};`)}</code>`;
                const fence = '`'.repeat(Math.max(1, ...(node.code.match(/`+/g) ?? []).map(s => s.length + 1)));
                return `${fence}${node.code}${fence}`;
            }
            case 'link': return `[${inline(node.children, tableCell)}](<${node.href}>)`;
            case 'image': return `![${node.alt ?? ''}](<${assetUri(node.assetId)}>)`;
            case 'inlineMath': return `$${node.source}$`;
            case 'citationRef': { const citation = message.citations?.find(c => c.id === node.citationId); return citation?.url ? `[${node.label ?? citation.title ?? citation.number ?? node.citationId}](<${citation.url}>)` : node.label ?? `[${node.citationId}]`; }
            case 'lineBreak': return node.kind === 'hard' ? '  \n' : '\n';
        }
    }).join('');
    const block = (node: BlockNode): string => {
        switch (node.type) {
            case 'paragraph': return inline(node.children);
            case 'heading': return `${'#'.repeat(node.level)} ${inline(node.children)}`;
            case 'code': { const fence = '`'.repeat(Math.max(3, ...(node.code.match(/`+/g) ?? []).map(s => s.length + 1))); return `${fence}${node.language ?? ''}\n${node.code}\n${fence}`; }
            case 'math': return `$$\n${node.source}\n$$`;
            case 'list': return node.items.map((item, i) => `${node.ordered ? `${(node.start ?? 1) + i}.` : '-'} ${item.blocks.map(block).join('\n\n').replace(/\n/g, '\n  ')}`).join('\n');
            case 'quote': return node.blocks.map(block).join('\n\n').split('\n').map(line => `> ${line}`).join('\n');
            case 'thought': return node.blocks.map(block).join('\n\n');
            case 'table': { const rows = [...(node.headerRows ?? []), ...node.rows].map(row => `| ${row.cells.map(cell => inline(cell.children, true).split('|').join('\\|').replace(/\n/g, '<br>')).join(' | ')} |`); const columns = (node.headerRows?.[0] ?? node.rows[0])?.cells.length ?? 0; rows.splice(node.headerRows?.length ?? 1, 0, `| ${Array.from({ length: columns }, (_, i) => node.columns?.[i]?.align === 'center' ? ':---:' : node.columns?.[i]?.align === 'right' ? '---:' : '---').join(' | ')} |`); return [node.caption ? inline(node.caption) : '', ...rows].filter(Boolean).join('\n'); }
            case 'image': return `![${node.alt ?? ''}](<${assetUri(node.assetId)}>)${node.caption ? `\n\n${inline(node.caption)}` : ''}`;
            case 'file': return `[${node.label ?? assets.get(node.assetId)?.name ?? 'File'}](<${assetUri(node.assetId)}>)${node.description ? `\n\n${inline(node.description)}` : ''}`;
            case 'thematicBreak': return '---';
            case 'unknown': return node.text;
        }
    };
    return blocks.map(block).join('\n\n');
}

/** One-way output projection for the final OpenAI JSON serializer. It never parses source syntax. */
export function projectDomainRecord(domain: DomainConversationDetail, paths: Readonly<Record<string, string>> = {}, acquisitionHints: ResourceAcquisitionHints = {}): Conversation {
    assertDomainClosure(domain);
    const assets = new Map(domain.assets.map(asset => [asset.id, asset]));
    const attachment = (asset: DomainAsset): Attachment => ({ assetId: asset.id, type: asset.kind === 'image' ? 'image' : 'file',
        ...(asset.source?.uri ? { url: asset.source.uri, sourceUrl: asset.source.uri, src: asset.source.uri } : {}),
        ...(asset.name ? { name: asset.name, fileName: asset.name } : {}),
        ...(paths[asset.id] ? { localName: paths[asset.id] } : {}),
        ...(acquisitionHints[asset.id]?.resolvedUrl ? { resolvedUrl: acquisitionHints[asset.id].resolvedUrl } : {}),
        ...(asset.mediaType ? { mimeType: asset.mediaType } : {}),
        ...(asset.byteLength !== undefined ? { size: asset.byteLength } : {}),
        ...(asset.dataBase64 ? { dataBase64: asset.dataBase64 } : {}),
        ...(asset.generated ? { isGenerated: true } : {}),
        ...(asset.generation?.generationOrdinal !== undefined && asset.generation.chatId ? { generation: { ...asset.generation, generationOrdinal: asset.generation.generationOrdinal, chatId: asset.generation.chatId }, providerRequestId: asset.generation.providerRequestId, imageOrdinal: asset.generation.imageOrdinal } : {}),
        ...(asset.document ? { ...asset.document } : {}), source: domain.provenance?.source });
    const messages: ChatMessage[] = domain.messages.map(message => {
        const refs = new Set(message.attachmentIds ?? []);
        const scan = (value: unknown): void => { if (!value || typeof value !== 'object') return; if (Array.isArray(value)) { value.forEach(scan); return; } for (const [key, child] of Object.entries(value)) { if (key === 'assetId' && typeof child === 'string') refs.add(child); else scan(child); } };
        scan(message.content); scan(message.reasoning);
        const attachments = [...refs].map(id => attachment(assets.get(id)!));
        return { ...(message.id ? { id: message.id } : {}), role: message.role === 'assistant' ? 'model' : message.role === 'system' ? 'system' : 'user', content: messageMarkdown(message, assets),
            ...(message.model ? { model: message.model } : {}), ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
            ...(message.provenance?.providerRequestId ? { providerRequestId: message.provenance.providerRequestId } : {}),
            ...(message.reasoning ? { thoughts: messageMarkdown(message, assets, message.reasoning) } : {}),
            ...(message.citations ? { citations: message.citations.flatMap(c => c.url ? [{ url: c.url, ...(c.title ? { title: c.title } : {}) }] : []) } : {}),
            ...(attachments.length ? { attachments, images: attachments.filter(a => a.type === 'image'), attachmentCount: attachments.length } : {}) };
    });
    return { id: domain.id, title: domain.title, timestamp: domain.timestamp, createdAt: domain.createdAt, updatedAt: domain.updatedAt, chatTime: domain.timestamp ?? undefined,
        titleSource: domain.titleSource, titles: { ...domain.titles }, source: domain.provenance?.source, url: domain.url ?? domain.href,
        messages, messageCount: messages.length, attachmentCount: messages.reduce((sum, m) => sum + (m.attachments?.length ?? 0), 0) };
}
