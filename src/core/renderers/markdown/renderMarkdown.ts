import { codeHeader, messageLabel, sourceNumberPrefix, unavailableResourceText } from '../shared/backendPresentation.js';
import { getRendererStrings } from '../shared/renderStrings.js';
import { isResourcePath } from '../shared/resourcePath.js';
import type { MarkdownRenderOptions } from '../shared/renderOptions.js';
import type { DisplayBlock, DisplayCell, DisplayInline, DocumentAst } from '../../document/ast/ast.js';
import type { ResourceBindings } from '../../export/packaging/resourceBindings.js';
import { inlineMathMarkdown } from '../../utils/markdownMath.js';

function escapeText(text: string): string {
    return text.replace(/\\/g, '\\\\').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
        .replace(/([`*_\[\]#~$])/g, '\\$1').replace(/^(\s*)([-+] |\d+[.)] )/gm, (_, space: string, marker: string) => space + marker.replace(/[-+.)]/, '\\$&'));
}

function destination(value: string): string | undefined {
    if (/^[\s]*([a-z][a-z\d+.-]*):/i.test(value) && !/^(https?:|mailto:)/i.test(value)) return undefined;
    return value.replace(/[\s()<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

function codeSpan(value: string): string {
    const fence = '`'.repeat(Math.max(0, ...(value.match(/`+/g) ?? []).map((run) => run.length)) + 1);
    const pad = /(^`|`$|^ .* $)/.test(value) ? ' ' : '';
    return `${fence}${pad}${value}${pad}${fence}`;
}

/** Projects and encodes a format-neutral document as GFM; no source registry or clock. */
export function renderDocumentMarkdown(document: DocumentAst, resources: ResourceBindings, options: MarkdownRenderOptions = {}): string {
    const locale = options.locale ?? 'en';
    const strings = getRendererStrings(locale);
    const available = (id: string) => isResourcePath(resources[id]);
    const resource = (id: string): string => {
        const value = resources[id];
        const ref = value && destination(value);
        if (!ref) throw new TypeError(`Missing prepared resource binding: ${id}`);
        return ref;
    };
    const placeholder = (node: { text: string; kind: 'image' | 'file' }): string => `[${escapeText(unavailableResourceText(node.kind, node.text, locale))}]`;
    const image = (id: string, alt: string): string => available(id) ? `![${escapeText(alt)}](${resource(id)})` : placeholder({ kind: 'image', text: alt || id });
    const citation = (node: { label: string; href?: string }): string => {
        const url = node.href && destination(node.href);
        return url ? `[${escapeText(node.label)}](${url})` : /^\[\d+\]$/.test(node.label) ? escapeText(node.label) : `[${escapeText(node.label)}]`;
    };
    const inline = (node: DisplayInline, tableCell = false): string => {
        switch (node.type) {
            case 'text': return escapeText(node.text);
            case 'strong': return `**${inlines(node.children, tableCell)}**`;
            case 'emphasis': return `*${inlines(node.children, tableCell)}*`;
            case 'strikethrough': return `~~${inlines(node.children, tableCell)}~~`;
            case 'inlineCode': {
                // GFM splits a pipe preceded by an even backslash run even inside code spans.
                // Use standard inline HTML only for that table-cell edge case.
                if (tableCell && /\\+\|/.test(node.code)) {
                    const text = node.code.replace(/[&<>\\|`*_{}\[\]]/g, (c) => `&#${c.charCodeAt(0)};`);
                    return `<code>${text}</code>`;
                }
                return codeSpan(node.code);
            }
            case 'link': {
                const url = destination(node.href);
                return url ? `[${inlines(node.children, tableCell)}](${url})` : inlines(node.children, tableCell);
            }
            case 'image': return image(node.resourceId, node.alt);
            case 'inlineMath': {
                // GFM escapes a pipe before inline math is parsed. Spell bars
                // as TeX commands in cells to preserve norms and table columns.
                const source = tableCell ? node.source.replace(/(\\*)\|/g, (_match, slashes: string) =>
                    slashes.length % 2 ? slashes.slice(0, -1) + '\\Vert{}' : slashes + '\\vert{}') : node.source;
                return inlineMathMarkdown(source);
            }
            case 'citation': return citation(node);
            case 'lineBreak': return node.kind === 'hard' ? '  \n' : '\n';
        }
    };
    const inlines = (nodes: DisplayInline[], tableCell = false): string => nodes.map((node) => inline(node, tableCell)).join('');
    const blocks = (nodes: DisplayBlock[]): string => nodes.map(block).join('\n\n');
    const block = (node: DisplayBlock): string => {
        switch (node.type) {
            case 'paragraph': return inlines(node.children);
            case 'heading': return `${'#'.repeat(node.level)} ${inlines(node.children)}`;
            case 'list': return node.items.map((item, index) => {
                const marker = node.ordered ? `${(node.start ?? 1) + index}. ` : '- ';
                const content = blocks(item.blocks).split('\n');
                return marker + content.map((line, n) => n ? ' '.repeat(marker.length) + line : line).join('\n');
            }).join('\n');
            case 'quote': return blocks(node.blocks).split('\n').map((line) => `> ${line}`).join('\n');
            case 'code': {
                const fence = '`'.repeat(Math.max(2, ...(node.code.match(/`+/g) ?? []).map((run) => run.length)) + 1);
                const label = codeHeader(node, 'markdown', options);
                const language = (node.language ?? '').replace(/[\r\n`]/g, '');
                const end = node.code.endsWith('\n') ? '' : '\n';
                return `${label ? `**${escapeText(label)}**\n\n` : ''}${fence}${language}\n${node.code}${end}${fence}`;
            }
            case 'math': return `$$\n${node.source}\n$$`;
            case 'table': {
                const row = (cells: DisplayCell[]): string => `| ${cells.map(cell => inlines(cell.children, true).split('|').join('\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`;
                const separator = `| ${node.columnAlignments.map(align => align === 'left' ? ':---' : align === 'center' ? ':---:' : align === 'right' ? '---:' : '---').join(' | ')} |`;
                const projected = projectedTable(node);
                return [node.caption ? inlines(node.caption) + '\n' : undefined, row(projected[0]), separator, ...projected.slice(1).map(row)].filter(value => value !== undefined).join('\n');
            }
            case 'image': {
                return [image(node.resourceId, node.alt), node.caption && inlines(node.caption)].filter(Boolean).join('\n\n');
            }
            case 'file': return [available(node.resourceId) ? `[${escapeText(node.label)}](${resource(node.resourceId)})` : placeholder({ kind: 'file', text: node.label }), node.description && inlines(node.description)].filter(Boolean).join('\n\n');
            case 'disclosure': return `<details${options.thoughtInitiallyCollapsed ?? true ? '' : ' open'}>\n<summary>${escapeText(node.title)}</summary>\n\n${blocks(node.blocks)}\n\n</details>`;
            case 'thematicBreak': return '---';
            case 'unsupported': return `${escapeText(`${strings.unsupportedContent} · ${node.sourceType}`)}\n\n${escapeText(node.text)}`;
        }
    };
    const metadata = document.metadata;
    if (options.includeFrontMatter && !metadata) throw new TypeError('Markdown document metadata is required');
    const entries: Array<{ key: string; value: string | string[] }> | undefined = options.includeFrontMatter ? [
        { key: 'title', value: document.title }, { key: 'id', value: metadata.id }, { key: 'provider', value: metadata.provider },
        ...(metadata.createdAt !== undefined ? [{ key: 'date', value: new Date(metadata.createdAt).toISOString() }] : []),
        ...(metadata.updatedAt !== undefined ? [{ key: 'updated', value: new Date(metadata.updatedAt).toISOString() }] : []),
        ...(options.exportedAt !== undefined ? [{ key: 'exported', value: new Date(options.exportedAt).toISOString() }] : []),
        { key: 'tags', value: [`${metadata.provider}-export`] },
    ] : undefined;
    const yaml = entries?.map(entry => {
        if (!/^[a-z][a-z\d_-]*$/i.test(entry.key)) throw new TypeError('Invalid front matter key');
        return Array.isArray(entry.value)
        ? `${entry.key}:\n${entry.value.map(value => `  - ${/^[a-z][a-z\d_-]*$/i.test(value) && !/^(?:null|true|false|yes|no|on|off)$/i.test(value) ? value : JSON.stringify(value)}`).join('\n')}`
        : `${entry.key}: ${JSON.stringify(entry.value)}`;
    }).join('\n');
    const header = [yaml !== undefined ? `---\n${yaml}\n---\n` : undefined, `# ${escapeText(document.title)}`].filter(value => value !== undefined).join('\n');
    const messages = document.messages.map(message => {
        const icons = { user: '👤', assistant: '🤖', system: '⚙️', developer: '🛠', unknown: '' };
        const heading = `## ${icons[message.role] ? icons[message.role] + ' ' : ''}${escapeText(messageLabel(message, locale))}`;
        const sources = message.sources && [`> 🌐 **${strings.sources}:**`, ...message.sources.map(item => {
            const prefix = sourceNumberPrefix(item);
            return `> ${!item.label && !item.href ? prefix.trimEnd() : !prefix && !item.href ? item.label : prefix + citation(item)}`;
        })].filter(Boolean).join('\n');
        return [heading, message.modelLabel && `*${escapeText(message.modelLabel)}*`, blocks(message.blocks), sources].filter(Boolean).join('\n\n');
    });
    return [header, ...messages, ...(!messages.length ? [strings.emptyConversation] : [])].join('\n\n') + '\n';
}

/** GFM supports one header row and no spans; project without changing the shared tree. */
function projectedTable(node: Extract<DisplayBlock, { type: 'table' }>): DisplayCell[][] {
    const width = node.columnAlignments.length;
    const blank = (column: number): DisplayCell => ({ column, colSpan: 1, rowSpan: 1, children: [] });
    const rows = [...node.headerRows, ...node.rows].map(row => {
        const cells = Array.from({ length: width }, (_, column) => blank(column));
        for (const cell of row) cells[cell.column] = { ...cell, colSpan: 1, rowSpan: 1 };
        return cells;
    });
    return node.headerRows.length ? rows : [Array.from({ length: width }, (_, column) => blank(column)), ...rows];
}
