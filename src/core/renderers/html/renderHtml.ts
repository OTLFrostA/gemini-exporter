import { blockText, inlineText, codeHeader, fileBadge, disclosureTitle, headerMetadata } from '../shared/backendPresentation.js';
import { getRendererStrings } from '../shared/renderStrings.js';
import type { HtmlRenderOptions } from '../shared/renderOptions.js';
import { visual } from '../shared/visualContract.js';
import { GEM_HTML_CSS, GEM_HTML_SCRIPT, sanitizeUrl } from './htmlTemplate.js';
import { renderMathHtml } from './htmlMath.js';
import type { DocumentDiagnostic } from '../../diagnostics/documentDiagnostic.js';
import type { DisplayBlock, DisplayInline, DisplayMessage, DocumentAst, ResourceBindings, SourceGroup } from '../../document/ast/ast.js';

const CANONICAL_EXTRA_CSS = `
.gem-unknown-block {
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  margin: var(--sp-block) 0;
  background: rgba(168, 199, 250, 0.04);
}
.gem-model-label {
  color: var(--text-muted);
  font-size: ${visual.type.metadata.size}px;
  margin-bottom: var(--sp-inline);
}
.gem-unknown-label {
  font-size: ${visual.type.metadata.size}px;
  line-height: ${visual.type.metadata.lineHeight};
  color: var(--text-muted);
  margin-bottom: var(--sp-inline);
}
.gem-unknown-text {
  font-size: ${visual.type.metadata.size}px;
  line-height: ${visual.type.metadata.lineHeight};
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.gem-att-caption, .gem-att-desc {
  font-size: ${visual.type.small.size}px;
  line-height: ${visual.type.small.lineHeight};
  color: var(--text-secondary);
  padding: 0 12px 10px;
}
.gem-code-meta {
  font-size: ${visual.type.metadata.size}px;
  line-height: ${visual.type.metadata.lineHeight};
  color: var(--text-muted);
  margin-left: 8px;
}
.gem-figure { margin: var(--sp-block) 0; }
.gem-figure figcaption {
  font-size: ${visual.type.small.size}px;
  line-height: ${visual.type.small.lineHeight};
  color: var(--text-secondary);
  margin-top: var(--sp-inline);
}
.gem-image-block {
  margin: var(--sp-block) 0;
  text-align: center;
}
.gem-image-block img {
  display: block;
  margin: 0 auto;
}
.gem-missing-asset {
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  padding: 12px 14px;
  margin: var(--sp-block) 0;
  color: var(--text-secondary);
  font-size: ${visual.type.small.size}px;
  line-height: ${visual.type.small.lineHeight};
}
.gem-inline-img {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  vertical-align: middle;
}
.gem-missing-inline {
  display: inline-block;
  margin: 0 4px;
  padding: 2px 8px;
}
.gem-citation-group { margin: var(--sp-block) 0; }
.gem-citation-group-title {
  font-size: ${visual.type.small.size}px;
  line-height: ${visual.type.small.lineHeight};
  color: var(--text-secondary);
  margin-bottom: var(--sp-inline);
}
.gem-citation-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.gem-citation-chip {
  display: inline-block;
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: ${visual.type.small.size}px;
  line-height: ${visual.type.small.lineHeight};
  color: var(--text-secondary);
  text-decoration: none;
}
a.gem-citation-chip { color: var(--accent-blue); }
.gem-math-inline math { font-size: 1.05em; }
.gem-math-block math { font-size: 1.15em; }
.gem-math-block annotation, .gem-math-inline annotation { display: none; }
.gem-math-unsupported {
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  margin: var(--sp-block) 0;
  background: rgba(168, 199, 250, 0.04);
  text-align: left;
}
.gem-math-fallback-label {
  font-size: ${visual.type.metadata.size}px;
  line-height: ${visual.type.metadata.lineHeight};
  color: var(--text-muted);
  margin-bottom: var(--sp-inline);
}
.gem-math-fallback-source {
  font-size: ${visual.type.small.size}px;
  line-height: ${visual.type.small.lineHeight};
  margin: 0;
  background: transparent;
  padding: 0;
  border: none;
  font-family: var(--font-mono, monospace);
  white-space: pre-wrap;
  word-break: break-word;
}
.gem-math-inline-fallback {
  font-size: 0.9em;
  padding: 1px 4px;
}
`;


function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const OPEN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';
const FILE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
const THOUGHT_SVG = '<svg class="gem-thought-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12c0 2.85 1.2 5.41 3.11 7.24.38.36.61.88.61 1.42V21c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-.34c0-.54.23-1.06.61-1.42C20.8 17.41 22 14.85 22 12c0-5.52-4.48-10-10-10zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>';
const CHEVRON_SVG = '<svg class="gem-thought-chevron" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>';


/** Pure backend: only the presentation tree and prepared resource bindings. */
export function renderDocumentHtml(document: DocumentAst, resources: ResourceBindings, options: HtmlRenderOptions = {}): { html: string; diagnostics: DocumentDiagnostic[] } {
    const locale = options.locale ?? 'zh';
    const strings = getRendererStrings(locale);
    const isEn = locale === 'en';
    const unavailableText = (kind: 'image' | 'file', label: string, inline = false) => `${isEn ? inline && kind === 'image' ? 'Image missing' : 'Attachment missing' : inline && kind === 'image' ? '图片缺失' : '附件缺失'} · ${label}`;
    const available = (id: string) => Boolean(resources[id] && sanitizeUrl(resources[id], true) !== '#');
    const missing = (id: string) => diagnostics.push({ severity: 'warning', code: 'HTML_ASSET_UNRESOLVED', message: `Resource ${id} has no prepared safe URL` });
    const diagnostics: DocumentDiagnostic[] = [];
    // The shared URL sanitizer already escapes the attribute value.
    const url = (value: string): string => sanitizeUrl(value, false);
    const resource = (id: string): string => {
        const value = resources[id];
        if (!value) throw new TypeError(`Missing prepared resource binding: ${id}`);
        return sanitizeUrl(value, true);
    };
    const math = (source: string, display: boolean): string => {
        const result = renderMathHtml(source, display, strings.mathFallback);
        if (result.diagnostic) diagnostics.push(result.diagnostic);
        return result.html;
    };
    const inline = (node: DisplayInline): string => {
        switch (node.type) {
            case 'text': return escapeHtml(node.text);
            case 'strong': return `<strong>${inlines(node.children)}</strong>`;
            case 'emphasis': return `<em>${inlines(node.children)}</em>`;
            case 'strikethrough': return `<del>${inlines(node.children)}</del>`;
            case 'inlineCode': return `<code class="gem-inline-code">${escapeHtml(node.code)}</code>`;
            case 'link': return `<a href="${url(node.href)}" target="_blank" rel="noopener noreferrer" class="gem-link"${node.title ? ` title="${escapeHtml(node.title)}"` : ''}>${inlines(node.children)}</a>`;
            case 'citation': {
                const attrs = `class="gem-link gem-citation-ref" data-citation-id="${escapeHtml(node.id)}"`;
                return node.href ? `<a ${attrs} href="${url(node.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(node.label)}</a>` : `<span ${attrs}>${escapeHtml(node.label)}</span>`;
            }
            case 'lineBreak': return '<br>';
            case 'inlineMath': return math(node.source, false);
            case 'image':
                if (!available(node.resourceId)) { return inline({ type: 'placeholder', resourceId: node.resourceId, kind: 'image', text: node.alt || node.resourceId }); }
                return `<img class="gem-inline-img" src="${resource(node.resourceId)}" alt="${escapeHtml(node.alt)}" loading="lazy"${node.title ? ` title="${escapeHtml(node.title)}"` : ''}>`;
            case 'placeholder':
                missing(node.resourceId ?? node.text);
                return `<span class="gem-missing-asset gem-missing-inline">${escapeHtml(unavailableText(node.kind, node.text, true))}</span>`;
        }
    };
    const inlines = (nodes: DisplayInline[]): string => nodes.map(inline).join('');
    const blocks = (nodes: DisplayBlock[]): string => nodes.map(block).join('\n');
    const block = (node: DisplayBlock): string => {
        switch (node.type) {
            case 'paragraph': return `<p class="gem-paragraph">${inlines(node.children)}</p>`;
            case 'heading': return `<h${node.level} class="gem-heading">${inlines(node.children)}</h${node.level}>`;
            case 'list': {
                const tag = node.ordered ? 'ol' : 'ul';
                return `<${tag} class="gem-list"${node.start !== undefined ? ` start="${node.start}"` : ''}>${node.items.map(item => `<li>${blocks(item.blocks)}</li>`).join('')}</${tag}>`;
            }
            case 'quote': return `<blockquote class="gem-blockquote">${blocks(node.blocks)}</blockquote>`;
            case 'code': return `<div class="gem-code-block">${node.showHeader ? `<div class="gem-code-header"><span class="gem-code-lang">${escapeHtml(codeHeader(node, 'html'))}</span>${node.meta ? `<span class="gem-code-meta"> · ${escapeHtml(node.meta)}</span>` : ''}
${options.copyCode !== false ? `<button class="gem-copy-btn" onclick="copyCode(this)" title="${isEn ? 'Copy Code' : '复制代码'}">${COPY_SVG}<span class="copy-text">${isEn ? 'Copy' : '复制'}</span></button>` : ''}</div>` : ''}<pre><code class="language-${escapeHtml(node.language || 'text')}">${escapeHtml(node.code)}</code></pre></div>`;
            case 'math': return math(node.source, true);
            case 'table': {
                const row = (cells: typeof node.rows[number], tag: 'th' | 'td') => `<tr>${cells.map(cell => `<${tag}${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ''}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ''}${cell.align !== 'default' ? ` style="text-align:${cell.align}"` : ''}>${inlines(cell.children)}</${tag}>`).join('')}</tr>`;
                return `<div class="gem-table-wrapper"><table class="gem-table">${node.caption ? `<caption class="gem-table-caption">${inlines(node.caption)}</caption>` : ''}${node.headerRows.length ? `<thead>${node.headerRows.map(cells => row(cells, 'th')).join('')}</thead>` : ''}<tbody>${node.rows.map(cells => row(cells, 'td')).join('')}</tbody></table></div>`;
            }
            case 'image':
                if (!available(node.resourceId)) { return block({ type: 'placeholder', resourceId: node.resourceId, kind: 'image', text: node.caption?.length ? node.caption.map(inlineText).join('') : node.alt, details: node.caption?.length === 1 && node.caption[0].type === 'text' ? undefined : node.caption }); }
                return `<figure class="gem-figure gem-image-block" data-asset-id="${escapeHtml(node.resourceId)}"><a href="${resource(node.resourceId)}" target="_blank" rel="noopener noreferrer" class="gem-img-link"><img class="gem-msg-img" src="${resource(node.resourceId)}" alt="${escapeHtml(node.alt)}" loading="lazy"></a>${node.caption ? `<figcaption class="gem-image-caption">${inlines(node.caption)}</figcaption>` : ''}</figure>`;
            case 'file':
                if (!available(node.resourceId)) { return block({ type: 'placeholder', resourceId: node.resourceId, kind: 'file', text: node.label, details: node.description }); }
                return `<a class="gem-att-card gem-att-file" href="${resource(node.resourceId)}" target="_blank" download="${escapeHtml(node.label)}" title="${escapeHtml(`${isEn ? 'Open or download' : '点击打开或下载'} ${node.label}`)}"><div class="gem-att-icon">${FILE_SVG}</div><div class="gem-att-info"><span class="gem-att-name">${escapeHtml(node.label)}</span><span class="gem-att-badge">${escapeHtml(fileBadge(node))}</span></div>${node.description ? `<div class="gem-att-desc">${inlines(node.description)}</div>` : ''}<div class="gem-att-open-btn">${OPEN_SVG}</div></a>`;
            case 'disclosure': return `<details class="gem-thoughts"${node.initiallyCollapsed ?? options.thoughtInitiallyCollapsed ?? false ? '' : ' open'}><summary class="gem-thoughts-summary"><div class="gem-thoughts-header">${THOUGHT_SVG}<span>${escapeHtml(disclosureTitle(node, { ...options, locale }))}</span>${CHEVRON_SVG}</div></summary><div class="gem-thoughts-content">${blocks(node.blocks)}</div></details>`;
            case 'thematicBreak': return '<hr class="gem-hr">';
            case 'placeholder':
                missing(node.resourceId ?? node.text);
                return `<div class="gem-missing-asset">${escapeHtml(unavailableText(node.kind, node.text))} <span class="gem-att-badge">${'MISSING'}</span>
${node.details ? `<div>${inlines(node.details)}</div>` : ''}</div>`;
            case 'unsupported':
                diagnostics.push({ severity: 'info', code: 'HTML_UNKNOWN_BLOCK', message: `Unsupported block ${node.sourceType}` });
                return `<section class="gem-unknown-block" data-source-type="${escapeHtml(node.sourceType)}"><div class="gem-unknown-label">${escapeHtml(`${isEn ? 'Unsupported' : strings.unsupportedContent} · ${node.sourceType}`)}</div><pre class="gem-unknown-text">${escapeHtml(node.text)}</pre></section>`;
        }
    };
    const sources = (group: SourceGroup | undefined): string => group ? `<section class="gem-citation-group"><div class="gem-citation-chips">${group.items.map(item => item.href ? `<a class="gem-citation-chip" href="${url(item.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.label)}</a>` : `<span class="gem-citation-chip">${escapeHtml(item.label)}</span>`).join('')}</div></section>` : '';
    const message = (node: DisplayMessage, index: number): string => {
        const anchor = `turn-${node.variant === 'bubble' ? 'user' : 'model'}-${index}`;
        const body = (node.modelLabel ? `<div class="gem-model-label">${escapeHtml(node.modelLabel)}</div>` : '') + blocks(node.blocks);
        const footer = sources(node.sources);
        if (node.variant === 'flow') return `<section class="gem-turn gem-turn-model" id="${escapeHtml(anchor)}"><div class="gem-model-content">${body}${footer}</div></section>`;
        const plain = node.blocks.map(blockText).join('\n');
        const folding = options.foldLongPrompts !== false && (plain.length > 280 || plain.split('\n').length > 5) ? { initiallyCollapsed: true, moreLabel: isEn ? 'Show more' : '展开', lessLabel: isEn ? 'Show less' : '收起' } : undefined;
        return `<section class="gem-turn gem-turn-user" id="${escapeHtml(anchor)}"><div class="gem-user-bubble"><div class="gem-prompt-content${folding?.initiallyCollapsed ? ' collapsed' : ''}" id="prompt-${escapeHtml(anchor)}">${body}</div>${folding ? `<button class="gem-prompt-toggle" data-more="${escapeHtml(folding.moreLabel)}" data-less="${escapeHtml(folding.lessLabel)}" onclick="togglePrompt(this, this.dataset.more, this.dataset.less)"><span class="toggle-text">${escapeHtml(folding.initiallyCollapsed ? folding.moreLabel : folding.lessLabel)}</span>${CHEVRON_SVG}</button>` : ''}</div>${footer}</section>`;
    };
    const title = escapeHtml(document.header.title);
    const html = `<!DOCTYPE html>
<html${document.documentLanguage ? ` lang="${escapeHtml(document.documentLanguage)}"` : ''}>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="generator" content="Gemini Exporter"><title>${title}</title><style>${GEM_HTML_CSS}\n${CANONICAL_EXTRA_CSS}</style></head>
<body class="${options.theme === 'light' ? 'light-theme' : ''}"><main class="gem-container"><header class="gem-conversation-header"><h1 class="gem-conversation-title">${title}</h1><p class="gem-conversation-metadata">${escapeHtml(headerMetadata(document, locale))}</p></header>${document.messages.map(message).join('\n')}${!document.messages.length ? `<div class="gem-empty-notice">${escapeHtml(document.emptyNotice ?? (isEn ? 'Empty conversation or fetch failed.' : '暂无对话记录或拉取失败。'))}</div>` : ''}</main><script>${GEM_HTML_SCRIPT}</script></body></html>`;
    return { html, diagnostics };
}
