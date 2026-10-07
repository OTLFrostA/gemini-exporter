import type { DisplayBlock, DisplayCell, DisplayInline, DocumentAst, ResourceBindings } from './ast.js';

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

/** Encodes an already composed Markdown profile; no semantic registry or clock. */
export function renderDocumentMarkdown(document: DocumentAst, resources: ResourceBindings): string {
    if (document.profile.id !== 'markdown') throw new TypeError('Expected a Markdown document profile');
    const resource = (id: string): string => {
        const value = resources[id];
        const ref = value && destination(value);
        if (!ref) throw new TypeError(`Missing prepared resource binding: ${id}`);
        return ref;
    };
    const placeholder = (node: { text: string; enclosure?: 'brackets' }): string => node.enclosure === 'brackets' ? `[${escapeText(node.text)}]` : escapeText(node.text);
    const image = (id: string, alt: string): string => `![${escapeText(alt)}](${resource(id)})`;
    const citation = (node: { label: string; href?: string }): string => {
        const url = node.href && destination(node.href);
        return url ? `[${escapeText(node.label)}](${url})` : `[${escapeText(node.label)}]`;
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
            case 'inlineMath': return `$${node.source}$`;
            case 'citation': return citation(node);
            case 'placeholder': return placeholder(node);
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
                const label = node.header;
                const language = (node.language ?? '').replace(/[\r\n`]/g, '');
                return `${label ? `**${escapeText(label)}**\n\n` : ''}${fence}${language}\n${node.code}\n${fence}`;
            }
            case 'math': return `$$\n${node.source}\n$$`;
            case 'table': {
                const row = (cells: DisplayCell[]): string => `| ${cells.map(cell => inlines(cell.children, true).split('|').join('\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`;
                const separator = `| ${node.columnAlignments.map(align => align === 'left' ? ':---' : align === 'center' ? ':---:' : align === 'right' ? '---:' : '---').join(' | ')} |`;
                return [node.caption ? inlines(node.caption) + '\n' : undefined, ...node.headerRows.map(row), separator, ...node.rows.map(row)].filter(value => value !== undefined).join('\n');
            }
            case 'image': {
                return [image(node.resourceId, node.alt), node.caption && inlines(node.caption)].filter(Boolean).join('\n\n');
            }
            case 'file': return [`[${escapeText(node.label)}](${resource(node.resourceId)})`, node.description && inlines(node.description)].filter(Boolean).join('\n\n');
            case 'disclosure': return `<details${node.initiallyCollapsed ? '' : ' open'}>\n<summary>${escapeText(node.title)}</summary>\n\n${blocks(node.blocks)}\n\n</details>`;
            case 'placeholder': return [placeholder(node), node.details && inlines(node.details)].filter(Boolean).join('\n\n');
            case 'thematicBreak': return '---';
            case 'unsupported': return `${escapeText(node.label)}\n\n${escapeText(node.text)}`;
        }
    };
    const yaml = document.frontMatter?.map(entry => {
        if (!/^[a-z][a-z\d_-]*$/i.test(entry.key)) throw new TypeError('Invalid front matter key');
        return Array.isArray(entry.value)
        ? `${entry.key}:\n${entry.value.map(value => `  - ${/^[a-z][a-z\d_-]*$/i.test(value) ? value : JSON.stringify(value)}`).join('\n')}`
        : `${entry.key}: ${JSON.stringify(entry.value)}`;
    }).join('\n');
    const header = [yaml !== undefined ? `---\n${yaml}\n---\n` : undefined, `# ${escapeText(document.header.title)}`].filter(value => value !== undefined).join('\n');
    const messages = document.messages.map(message => {
        const heading = message.heading && `${'#'.repeat(message.heading.level)} ${escapeText(message.heading.text)}`;
        const sources = message.sources && [message.sources.heading && `> ${inlines(message.sources.heading)}`, ...message.sources.items.map(item => `> ${item.prefix ? escapeText(item.prefix).replace(/\\([\[\]])/g, '$1') + ' ' : ''}${citation(item)}`)].filter(Boolean).join('\n');
        return [heading, blocks(message.blocks), sources].filter(Boolean).join('\n\n');
    });
    return [header, ...messages].join('\n\n') + '\n';
}
