import type { Account } from '../../../src/l2/accountRegistry.js';
import type { BlockNode } from '../../../src/l2/content/blocks.js';
import type { InlineNode } from '../../../src/l2/content/inline.js';
import type { DomainConversationDetail, DomainMessage, DomainMessageRole } from '../../../src/l2/conversationDetail.js';
import {
    encodePortableCloudConversation,
    type PortableCloudConversation,
} from '../../../src/l2/cloudPayload.js';

const SYNTHETIC_MCP_ACCOUNT_UUID = '00000000-0000-4000-8000-000000000001';

function renderInlines(nodes: readonly InlineNode[]): string {
    let out = '';
    for (const n of nodes) {
        switch (n.type) {
            case 'text':
                out += n.text;
                break;
            case 'strong':
                out += `**${renderInlines(n.children)}**`;
                break;
            case 'emphasis':
                out += `*${renderInlines(n.children)}*`;
                break;
            case 'strikethrough':
                out += `~~${renderInlines(n.children)}~~`;
                break;
            case 'inlineCode':
                out += `\`${n.code}\``;
                break;
            case 'link':
                out += `[${renderInlines(n.children)}](${n.href})`;
                break;
            case 'image':
                out += `![${n.alt ?? 'image'}](asset:${n.assetId})`;
                break;
            case 'inlineMath':
                out += `$${n.source}$`;
                break;
            case 'citationRef':
                out += `[${n.label ?? n.citationId}]`;
                break;
            case 'lineBreak':
                out += n.kind === 'hard' ? '  \n' : '\n';
                break;
        }
    }
    return out;
}

function renderBlocks(blocks: readonly BlockNode[], indent = ''): string {
    const parts: string[] = [];
    for (const b of blocks) {
        switch (b.type) {
            case 'paragraph':
                parts.push(`${indent}${renderInlines(b.children)}`);
                break;
            case 'heading':
                parts.push(`${indent}${'#'.repeat(b.level)} ${renderInlines(b.children)}`);
                break;
            case 'code': {
                const fence = '```';
                const lang = b.language ?? '';
                const body = b.code
                    .split('\n')
                    .map(line => `${indent}${line}`)
                    .join('\n');
                parts.push(`${indent}${fence}${lang}\n${body}\n${indent}${fence}`);
                break;
            }
            case 'math':
                parts.push(`${indent}$$\n${b.source}\n${indent}$$`);
                break;
            case 'quote': {
                const quoted = renderBlocks(b.blocks)
                    .split('\n')
                    .map(line => `${indent}> ${line}`)
                    .join('\n');
                parts.push(quoted);
                break;
            }
            case 'list': {
                const lines: string[] = [];
                const startNum = b.start ?? 1;
                b.items.forEach((item, idx) => {
                    const bullet = b.ordered ? `${startNum + idx}. ` : '- ';
                    const rendered = renderBlocks(item.blocks);
                    const itemLines = rendered.split('\n');
                    lines.push(`${indent}${bullet}${itemLines[0] ?? ''}`);
                    for (let i = 1; i < itemLines.length; i++) {
                        lines.push(`${indent}  ${itemLines[i]}`);
                    }
                });
                parts.push(lines.join('\n'));
                break;
            }
            case 'table': {
                const escapeCell = (raw: string): string =>
                    raw.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
                const tableLines: string[] = [];
                const header = b.headerRows?.[0];
                if (header) {
                    const cells = header.cells.map(c => escapeCell(renderInlines(c.children)));
                    tableLines.push(`${indent}| ${cells.join(' | ')} |`);
                    tableLines.push(`${indent}| ${cells.map(() => '---').join(' | ')} |`);
                }
                for (const row of b.rows) {
                    const cells = row.cells.map(c => escapeCell(renderInlines(c.children)));
                    tableLines.push(`${indent}| ${cells.join(' | ')} |`);
                }
                parts.push(tableLines.join('\n'));
                break;
            }
            case 'image':
                parts.push(`${indent}![${b.alt ?? 'image'}](asset:${b.assetId})`);
                break;
            case 'file':
                parts.push(`${indent}[File: ${b.label ?? b.assetId}]`);
                break;
            case 'thematicBreak':
                parts.push(`${indent}---`);
                break;
            case 'unknown':
                parts.push(`${indent}${b.text}`);
                break;
        }
    }
    return parts.join('\n\n');
}

function roleHeading(role: DomainMessageRole, model?: string): string {
    if (role === 'user') return '### User';
    if (role === 'assistant') return model ? `### Assistant (${model})` : '### Assistant';
    if (role === 'system') return '### System';
    if (role === 'developer') return '### Developer';
    return '### Message';
}

export function renderPortableConversationMarkdown(conv: PortableCloudConversation): string {
    const title = conv.index.title || conv.conversationId;
    const updatedIso = conv.index.updatedAt
        ? new Date(conv.index.updatedAt).toISOString()
        : 'unknown';
    const accountLabel = conv.account.email ?? conv.account.displayName ?? conv.account.providerAccountId;
    const headerLines = [
        `# ${title}`,
        '',
        `- **Platform**: \`${conv.account.providerId}\``,
        `- **Account**: \`${accountLabel}\``,
        `- **Conversation ID**: \`${conv.conversationId}\``,
        `- **Updated At**: ${updatedIso}`,
        '',
        '---',
        '',
    ];

    if (!conv.detail) {
        headerLines.push(
            '> *Note: Only catalog metadata (Index) is currently stored for this conversation. ' +
            'Enable "Sync full message bodies" in the browser extension Vault settings to sync message content.*',
        );
        return headerLines.join('\n');
    }

    const turns = conv.detail.messages.map(msg => {
        const heading = roleHeading(msg.role, msg.model);
        const body = renderBlocks(msg.content);
        return `${heading}\n\n${body}`;
    });
    return headerLines.join('\n') + turns.join('\n\n---\n\n');
}

export function extractSearchableText(conv: PortableCloudConversation): string {
    const chunks: string[] = [
        conv.index.title ?? '',
        conv.account.providerId,
        conv.account.email ?? '',
        conv.account.displayName ?? '',
    ];
    if (conv.detail) {
        for (const msg of conv.detail.messages) {
            chunks.push(renderBlocks(msg.content));
        }
    }
    return chunks.join('\n');
}

export interface McpInputMessage {
    readonly role: 'user' | 'assistant' | 'system';
    readonly content: string;
}

function markdownTextToBlocks(rawText: string): BlockNode[] {
    const trimmed = rawText.trim();
    if (!trimmed) {
        return [{ type: 'paragraph', children: [{ type: 'text', text: '' }] }];
    }
    // Split fenced code blocks cleanly from prose paragraphs
    const blocks: BlockNode[] = [];
    const fenceRegex = /```([^\n`]*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    for (;;) {
        const match = fenceRegex.exec(trimmed);
        if (!match) break;
        const before = trimmed.slice(lastIndex, match.index).trim();
        if (before) {
            for (const para of before.split(/\n{2,}/)) {
                blocks.push({ type: 'paragraph', children: [{ type: 'text', text: para }] });
            }
        }
        const lang = (match[1] ?? '').trim();
        const code = (match[2] ?? '').replace(/\n$/, '');
        blocks.push({
            type: 'code',
            code,
            ...(lang ? { language: lang } : {}),
        });
        lastIndex = match.index + match[0].length;
    }
    const tail = trimmed.slice(lastIndex).trim();
    if (tail) {
        for (const para of tail.split(/\n{2,}/)) {
            blocks.push({ type: 'paragraph', children: [{ type: 'text', text: para }] });
        }
    }
    return blocks.length > 0
        ? blocks
        : [{ type: 'paragraph', children: [{ type: 'text', text: trimmed }] }];
}

export function buildValidatedPortableConversationJson(input: {
    readonly providerId: string;
    readonly providerAccountId: string;
    readonly displayName?: string;
    readonly conversationId: string;
    readonly title: string;
    readonly messages: readonly McpInputMessage[];
    readonly nowMs: number;
}): string {
    const account: Account = {
        id: SYNTHETIC_MCP_ACCOUNT_UUID,
        providerId: input.providerId,
        providerAccountId: input.providerAccountId,
        ...(input.displayName ? { displayName: input.displayName } : {}),
    };
    const key = {
        accountId: SYNTHETIC_MCP_ACCOUNT_UUID,
        conversationId: input.conversationId,
    };
    const domainMessages: DomainMessage[] = input.messages.map((m, idx) => ({
        id: `mcp-msg-${idx + 1}`,
        role: m.role,
        content: markdownTextToBlocks(m.content),
        timestamp: input.nowMs,
    }));
    const detail: DomainConversationDetail = {
        key,
        savedAt: input.nowMs,
        quality: { status: 'complete', sourceTurn: 'finished' },
        assets: [],
        messages: domainMessages,
    };
    return encodePortableCloudConversation(account, {
        index: {
            key,
            title: input.title,
            titleSource: 'user',
            createdAt: input.nowMs,
            updatedAt: input.nowMs,
        },
        detail,
    });
}
