import type { Conversation, ChatMessage, Attachment } from '../../../types/conversation.js';
import type { DomainConversationDetail, DomainMessage, DomainAsset } from '../../domain/conversationDetail.js';
import type { BlockNode } from '../../domain/content/blocks.js';
import type { InlineNode } from '../../domain/content/inline.js';
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import { assertDomainClosure } from '../../domain/closure.js';
import { highResVariant } from '../gemini/attachments.js';
import type { ResourceAcquisitionHints } from '../../parsers/shared/resources/resourceAcquisitionHints.js';
import { sanitizeFileName, shortScope } from '../../utils/pathUtils.js';

/** Runtime sidecar only. This property is never a field of a persisted record. */
export interface ParsedConversationView extends Conversation { messages: ChatMessage[]; createdAt: number | null; updatedAt: number | null; chatTime?: number; parsed: ResourceConversationParseResult }

/** Existing records keep their string body format; new source input is already Domain. */
function messageMarkdown(message: DomainMessage, assets: Map<string, DomainAsset>, blocks = message.content): string {
    const assetUri = (id: string): string => assets.get(id)?.source?.uri ?? '';
    const inline = (nodes: InlineNode[]): string => nodes.map(node => {
        switch (node.type) {
            case 'text': return node.text.replace(/[\\`*_\[\]<>$#]/g, character => `\\${character}`);
            case 'strong': return `**${inline(node.children)}**`;
            case 'emphasis': return `*${inline(node.children)}*`;
            case 'strikethrough': return `~~${inline(node.children)}~~`;
            case 'inlineCode': { const fence = '`'.repeat(Math.max(1, ...(node.code.match(/`+/g) ?? []).map(s => s.length + 1))); return `${fence}${node.code}${fence}`; }
            case 'link': return `[${inline(node.children)}](<${node.href}>)`;
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
            case 'table': { const rows = [...(node.headerRows ?? []), ...node.rows].map(row => `| ${row.cells.map(cell => inline(cell.children).replace(/\|/g, '\\|').replace(/\n/g, '<br>')).join(' | ')} |`); const columns = (node.headerRows?.[0] ?? node.rows[0])?.cells.length ?? 0; rows.splice(node.headerRows?.length ?? 1, 0, `| ${Array.from({ length: columns }, (_, i) => node.columns?.[i]?.align === 'center' ? ':---:' : node.columns?.[i]?.align === 'right' ? '---:' : '---').join(' | ')} |`); return [node.caption ? inline(node.caption) : '', ...rows].filter(Boolean).join('\n'); }
            case 'image': return `![${node.alt ?? ''}](<${assetUri(node.assetId)}>)${node.caption ? `\n\n${inline(node.caption)}` : ''}`;
            case 'file': return `[${node.label ?? assets.get(node.assetId)?.name ?? 'File'}](<${assetUri(node.assetId)}>)${node.description ? `\n\n${inline(node.description)}` : ''}`;
            case 'thematicBreak': return '---';
            case 'unknown': return node.text;
        }
    };
    return blocks.map(block).join('\n\n');
}

/** One-way output projection for existing storage/JSON consumers. It never parses source syntax. */
export function projectDomainRecord(domain: DomainConversationDetail, paths: Readonly<Record<string, string>> = {}, acquisitionHints: ResourceAcquisitionHints = {}): Conversation {
    assertDomainClosure(domain);
    const assets = new Map(domain.assets.map(asset => [asset.id, asset]));
    const attachment = (asset: DomainAsset): Attachment => ({ type: asset.kind === 'image' ? 'image' : 'file',
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

/** Allocate old export destinations outside parsers, preserving the native result as a sidecar. */
export function createParsedConversationView(result: ResourceConversationParseResult): ParsedConversationView {
    const paths: Record<string, string> = {};
    const names = new Set<string>();
    for (const asset of result.conversation.assets) {
        const fallback = `${asset.id}.${asset.kind === 'image' ? 'jpg' : asset.document?.contentMarkdown ? 'md' : 'bin'}`;
        const sanitized = sanitizeFileName(asset.name || fallback, fallback);
        const name = asset.document?.contentMarkdown && !/\.md$/i.test(sanitized) ? `${sanitized}.md` : sanitized;
        let path = result.resourceHints[asset.id]?.archivePath ?? `${asset.kind === 'image' ? 'assets' : 'files'}/${shortScope(result.conversation.id)}${name}`;
        const original = path; let i = 2;
        while (names.has(path)) path = `${original.replace(/(\.[^/.]+)?$/, `_${i++}$1`)}`;
        names.add(path); paths[asset.id] = path;
    }
    const resourceHints = { ...result.resourceHints };
    for (const [id, archivePath] of Object.entries(paths)) resourceHints[id] = { ...resourceHints[id], archivePath };
    const acquisitionHints = { ...result.acquisitionHints };
    for (const asset of result.conversation.assets) acquisitionHints[asset.id] = { ...acquisitionHints[asset.id], ...(asset.kind === 'image' && /^https?:/.test(asset.source?.uri ?? '') ? { resolvedUrl: acquisitionHints[asset.id]?.resolvedUrl || highResVariant(asset.source!.uri) } : {}), localName: paths[asset.id], fileName: paths[asset.id].split('/').pop(), ...(asset.name ? { name: asset.name } : {}) };
    const parsed: ResourceConversationParseResult = { conversation: result.conversation, diagnostics: result.diagnostics, acquisitionHints, resourceHints };
    const record = projectDomainRecord(result.conversation, paths, acquisitionHints);
    return { ...record, messages: record.messages ?? [], createdAt: typeof record.createdAt === 'number' ? record.createdAt : null, updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : null, chatTime: result.conversation.timestamp ?? undefined, parsed };
}

/** Accept native runtime input; malformed sidecars must fail instead of silently reparsing a snapshot. */
export function readParsedConversation(value: unknown): ResourceConversationParseResult | undefined {
    if (!value || typeof value !== 'object' || !('parsed' in value) || value.parsed === undefined) return undefined;
    const parsed = value.parsed;
    if (!parsed || typeof parsed !== 'object' || !('conversation' in parsed) || !('resourceHints' in parsed) || !('acquisitionHints' in parsed) || !('diagnostics' in parsed)) throw new TypeError('Malformed native conversation result');
    if (!Array.isArray(parsed.diagnostics) || !parsed.resourceHints || typeof parsed.resourceHints !== 'object' || Array.isArray(parsed.resourceHints) || !parsed.acquisitionHints || typeof parsed.acquisitionHints !== 'object' || Array.isArray(parsed.acquisitionHints)) throw new TypeError('Malformed native conversation sidecars');
    const result = parsed as ResourceConversationParseResult;
    assertDomainClosure(result.conversation);
    return result;
}
