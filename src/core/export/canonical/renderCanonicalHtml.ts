import type { Asset } from './assets.js';
import { collectReferencedAssetIds, collectCompanionPlacements } from './assetReferences.js';
import type { BlockNode, FileBlock, ImageBlock, ListBlock, TableBlock } from './blocks.js';
import type { Citation } from './citations.js';
import type { CanonicalConversationBundle, MessageNode } from './conversation.js';
import type { InlineNode } from './inline.js';
import { getRendererStrings } from './rendererStrings.js';
import { projectConversation } from './projection.js';
import type {
    CompanionResourcePlan,
    ConversationRenderer,
    ExportArtifact,
    RenderContext,
    RenderDiagnostic,
} from './rendering.js';
import {
    extractBlockText,
    resolveUnknownBlockFallback,
    unknownInlineFallbackText,
} from './unknownFallback.js';
import {
    GEM_HTML_CSS,
    GEM_HTML_SCRIPT,
    sanitizeUrl,
} from '../../engine/template/htmlTemplate.js';

export interface CanonicalHtmlOptions {
    lang?: 'zh' | 'en';
    theme?: 'dark' | 'light';
    assetUrl?: (asset: Asset) => string | undefined;
    thoughtInitiallyCollapsed?: boolean;
}

export interface CanonicalHtmlResult {
    html: string;
    diagnostics: RenderDiagnostic[];
    projectedMessageIds: string[];
}

interface RenderCtx {
    assets: Map<string, Asset>;
    citations: Map<string, Citation>;
    isEn: boolean;
    assetUrl?: (asset: Asset) => string | undefined;
    thoughtCollapsed: boolean;
    diagnostics: RenderDiagnostic[];
}

const CANONICAL_EXTRA_CSS = `
.gem-unknown-block {
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 1em 0;
  background: rgba(168, 199, 250, 0.04);
}
.gem-unknown-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 6px;
}
.gem-unknown-payload {
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}
.gem-att-caption, .gem-att-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  padding: 0 12px 10px;
}
.gem-code-meta {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 8px;
}
.gem-figure { margin: 1em 0; }
.gem-figure figcaption {
  font-size: 13px;
  color: var(--text-secondary);
  margin-top: 6px;
}
.gem-missing-asset {
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  padding: 12px 14px;
  margin: 1em 0;
  color: var(--text-secondary);
  font-size: 13.5px;
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
.gem-citation-group { margin: 1.2em 0; }
.gem-citation-group-title {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.gem-citation-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.gem-citation-chip {
  display: inline-block;
  padding: 4px 12px;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  font-size: 12.5px;
  color: var(--text-secondary);
  text-decoration: none;
}
a.gem-citation-chip { color: var(--accent-blue); }
`;

function escapeHtml(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function diag(ctx: RenderCtx, severity: RenderDiagnostic['severity'], code: string, message: string, path?: string): void {
    ctx.diagnostics.push({ severity, code, message, path });
}

function resolveAssetUrl(asset: Asset | undefined, ctx: RenderCtx): string | undefined {
    if (!asset) return undefined;
    const raw = ctx.assetUrl?.(asset) ?? asset.storageRef;
    if (!raw) return undefined;
    const safe = sanitizeUrl(raw, true);
    return safe === '#' ? undefined : safe;
}

function renderInline(node: InlineNode, ctx: RenderCtx): string {
    switch (node.type) {
        case 'text':
            return escapeHtml(node.text);
        case 'strong':
            return `<strong>${renderInlines(node.children, ctx)}</strong>`;
        case 'emphasis':
            return `<em>${renderInlines(node.children, ctx)}</em>`;
        case 'strikethrough':
            return `<del>${renderInlines(node.children, ctx)}</del>`;
        case 'inlineCode':
            return `<code class="gem-inline-code">${escapeHtml(node.code)}</code>`;
        case 'link': {
            const href = sanitizeUrl(node.href, false);
            const title = node.title ? ` title="${escapeHtml(node.title)}"` : '';
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="gem-link"${title}>${renderInlines(node.children, ctx)}</a>`;
        }
        case 'inlineMath':
            return `<span class="gem-math-inline">${escapeHtml(node.source)}</span>`;
        case 'citationRef': {
            const citation = ctx.citations.get(node.citationId);
            const label = escapeHtml(node.label ?? citation?.title ?? node.citationId);
            const url = citation?.url ? sanitizeUrl(citation.url, false) : '#';
            return url !== '#'
                ? `<a class="gem-link gem-citation-ref" data-citation-id="${escapeHtml(node.citationId)}" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
                : `<span class="gem-citation-ref" data-citation-id="${escapeHtml(node.citationId)}">${label}</span>`;
        }
        case 'lineBreak':
            return '<br>';
        case 'image': {
            const asset = ctx.assets.get(node.assetId);
            const url = resolveAssetUrl(asset, ctx);
            const name = node.alt ?? asset?.name ?? node.assetId;
            const safeName = escapeHtml(name);
            const titleAttr = node.title ? ` title="${escapeHtml(node.title)}"` : '';
            if (!url) {
                diag(ctx, 'warning', 'HTML_ASSET_UNRESOLVED', `inline image asset ${node.assetId} has no resolvable offline URL; rendered as a visible placeholder`);
                return `<span class="gem-missing-asset gem-missing-inline">图片缺失 · ${safeName}</span>`;
            }
            return `<img class="gem-inline-img" src="${url}" alt="${safeName}" loading="lazy"${titleAttr}>`;
        }
        case 'unknownInline':
            return escapeHtml(unknownInlineFallbackText(node));
        default:
            return '';
    }
}

function renderInlines(nodes: InlineNode[], ctx: RenderCtx): string {
    return (nodes ?? []).map((n) => renderInline(n, ctx)).join('');
}

const COPY_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const OPEN_SVG = '<svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>';
const FILE_SVG = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>';
const THOUGHT_SVG = '<svg class="gem-thought-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12c0 2.85 1.2 5.41 3.11 7.24.38.36.61.88.61 1.42V21c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-.34c0-.54.23-1.06.61-1.42C20.8 17.41 22 14.85 22 12c0-5.52-4.48-10-10-10zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>';
const CHEVRON_SVG = '<svg class="gem-thought-chevron" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>';

function extBadge(name: string, fallback: string): string {
    const m = name.match(/\.([a-z0-9]+)$/i);
    return escapeHtml(m ? m[1].toUpperCase() : fallback);
}

function missingAssetHtml(assetId: string, label: string, ctx: RenderCtx, path: string): string {
    diag(ctx, 'warning', 'HTML_ASSET_UNRESOLVED', `asset ${assetId} has no resolvable offline URL; rendered as a visible placeholder`, path);
    return `<div class="gem-missing-asset">附件缺失 · ${escapeHtml(label)} <span class="gem-att-badge">MISSING</span></div>`;
}

function renderImageCard(block: ImageBlock, ctx: RenderCtx, path: string): string {
    const asset = ctx.assets.get(block.assetId);
    const url = resolveAssetUrl(asset, ctx);
    const name = block.alt ?? asset?.name ?? block.assetId;
    const safeName = escapeHtml(name);
    if (!url) return missingAssetHtml(block.assetId, name, ctx, path);
    const caption = block.caption?.length ? `<div class="gem-att-caption">${renderInlines(block.caption, ctx)}</div>` : '';
    return `
      <a class="gem-att-card gem-att-img" href="${url}" target="_blank" rel="noopener noreferrer" title="点击查看原图 ${safeName}">
        <div class="gem-att-preview">
          <img src="${url}" alt="${safeName}" loading="lazy">
        </div>
        <div class="gem-att-info">
          <span class="gem-att-name">${safeName}</span>
          <span class="gem-att-badge">${extBadge(name, 'IMG')}</span>
        </div>
        ${caption}
        <div class="gem-att-open-btn">${OPEN_SVG}</div>
      </a>`;
}

function renderFileCard(block: FileBlock, ctx: RenderCtx, path: string): string {
    const asset = ctx.assets.get(block.assetId);
    const url = resolveAssetUrl(asset, ctx);
    const name = block.label ?? asset?.name ?? block.assetId;
    const safeName = escapeHtml(name);
    if (!url) return missingAssetHtml(block.assetId, name, ctx, path);
    const description = block.description?.length ? `<div class="gem-att-desc">${renderInlines(block.description, ctx)}</div>` : '';
    return `
      <a class="gem-att-card gem-att-file" href="${url}" target="_blank" download="${safeName}" title="点击打开或下载 ${safeName}">
        <div class="gem-att-icon">${FILE_SVG}</div>
        <div class="gem-att-info">
          <span class="gem-att-name">${safeName}</span>
          <span class="gem-att-badge">${extBadge(name, 'FILE')}</span>
        </div>
        ${description}
        <div class="gem-att-open-btn">${OPEN_SVG}</div>
      </a>`;
}

function renderCarousel(cardsHtml: string): string {
    const count = (cardsHtml.match(/gem-att-card/g) || []).length;
    const showNav = count > 2;
    return `
    <div class="gem-carousel-wrapper">
      ${showNav ? `
      <button class="gem-carousel-nav-btn prev" onclick="scrollCarousel(this, -1)" title="Previous attachments" style="display:none;">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>` : ''}
      <div class="gem-carousel-track" onscroll="updateCarouselNav(this)">
        ${cardsHtml}
      </div>
      ${showNav ? `
      <button class="gem-carousel-nav-btn next" onclick="scrollCarousel(this, 1)" title="Next attachments" style="display:none;">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>` : ''}
    </div>`;
}

function renderTable(block: TableBlock, ctx: RenderCtx): string {
    const alignOf = (index: number): string => {
        const align = block.columns?.[index]?.align;
        return align === 'left' || align === 'center' || align === 'right' ? ` style="text-align:${align}"` : '';
    };
    const renderRow = (cells: TableBlock['rows'][number]['cells'], header: boolean): string => {
        const tag = header ? 'th' : 'td';
        return `<tr>${cells.map((c, i) => {
            const span = `${c.colSpan && c.colSpan !== 1 ? ` colspan="${c.colSpan}"` : ''}${c.rowSpan && c.rowSpan !== 1 ? ` rowspan="${c.rowSpan}"` : ''}`;
            return `<${tag}${span}${alignOf(i)}>${renderInlines(c.children, ctx)}</${tag}>`;
        }).join('')}</tr>`;
    };
    let html = '<div class="gem-table-wrapper"><table class="gem-table">';
    if (block.caption?.length) {
        html += `<caption class="gem-table-caption">${renderInlines(block.caption, ctx)}</caption>`;
    }
    if (block.headerRows?.length) {
        html += `<thead>${block.headerRows.map((r) => renderRow(r.cells, true)).join('')}</thead>`;
    }
    html += `<tbody>${block.rows.map((r) => renderRow(r.cells, false)).join('')}</tbody></table></div>`;
    return html;
}

function thoughtTitle(kind: string | undefined, isEn: boolean): string {
    const strings = getRendererStrings(isEn ? 'en' : 'zh');
    switch (kind) {
        case 'summary': return strings.thinkingSummary;
        case 'progress': return strings.thinkingProgress;
        default: return strings.thinkingProcess;
    }
}

function renderBlock(block: BlockNode, ctx: RenderCtx, path: string): string {
    switch (block.type) {
        case 'paragraph':
            return `<p class="gem-paragraph">${renderInlines(block.children, ctx)}</p>`;
        case 'heading':
            return `<h${block.level} class="gem-heading">${renderInlines(block.children, ctx)}</h${block.level}>`;
        case 'list': {
            const b = block as ListBlock;
            const tag = b.ordered ? 'ol' : 'ul';
            const start = b.ordered && b.start && b.start !== 1 ? ` start="${b.start}"` : '';
            const items = b.items.map((item, i) =>
                `<li>${(item.blocks ?? []).map((ib, j) => renderBlock(ib, ctx, `${path}/item:${i}/block:${j}`)).join('')}</li>`,
            ).join('');
            return `<${tag} class="gem-list"${start}>${items}</${tag}>`;
        }
        case 'quote':
            return `<blockquote class="gem-blockquote">${(block.blocks ?? []).map((b, i) => renderBlock(b, ctx, `${path}/quote:${i}`)).join('')}</blockquote>`;
        case 'code': {
            const lang = block.language || 'text';
            const safeLang = escapeHtml(lang);
            const headerText = block.filename
                ? (lang !== 'text' ? `${block.filename} · ${lang}` : block.filename)
                : lang;
            const meta = block.meta ? `<span class="gem-code-meta"> · ${escapeHtml(block.meta)}</span>` : '';
            return `
<div class="gem-code-block">
  <div class="gem-code-header">
    <span class="gem-code-lang">${escapeHtml(headerText)}</span>${meta}
    <button class="gem-copy-btn" onclick="copyCode(this)" title="Copy Code">
      ${COPY_SVG}
      <span class="copy-text">复制</span>
    </button>
  </div>
  <pre><code class="language-${safeLang}">${escapeHtml(block.code)}</code></pre>
</div>`;
        }
        case 'math':
            return `<div class="gem-math-block">${escapeHtml(block.source)}</div>`;
        case 'table':
            return renderTable(block as TableBlock, ctx);
        case 'image':
            return renderImageCard(block as ImageBlock, ctx, path);
        case 'file':
            return renderFileCard(block as FileBlock, ctx, path);
        case 'citationGroup': {
            const title = block.title?.length ? `<div class="gem-citation-group-title">${renderInlines(block.title, ctx)}</div>` : '';
            const chips = block.citationIds.map((id) => {
                const c = ctx.citations.get(id);
                const label = escapeHtml(c?.title ?? c?.publisher ?? id);
                const url = c?.url ? sanitizeUrl(c.url, false) : '#';
                return url !== '#'
                    ? `<a class="gem-citation-chip" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
                    : `<span class="gem-citation-chip">${label}</span>`;
            }).join('');
            return `<section class="gem-citation-group">${title}<div class="gem-citation-chips">${chips}</div></section>`;
        }
        case 'thought': {
            const content = (block.blocks ?? []).map((b, i) => renderBlock(b, ctx, `${path}/thought:${i}`)).join('');
            return `
    <details class="gem-thoughts"${ctx.thoughtCollapsed ? '' : ' open'}>
      <summary class="gem-thoughts-summary">
        <div class="gem-thoughts-header">
          ${THOUGHT_SVG}
          <span>${thoughtTitle(block.kind, ctx.isEn)}</span>
          ${CHEVRON_SVG}
        </div>
      </summary>
      <div class="gem-thoughts-content">
        ${content}
      </div>
    </details>`;
        }
        case 'toolCall':
        case 'toolResult': {
            const strings = getRendererStrings(ctx.isEn ? 'en' : 'zh');
            const label = block.type === 'toolCall'
                ? `${strings.toolCall} · ${block.toolName}`
                : `${strings.toolResult} · ${block.toolName ?? block.callId}`;
            const display = (block.displayBlocks ?? []).map((b, i) => renderBlock(b, ctx, `${path}/tool:${i}`)).join('');
            const payload = block.type === 'toolCall' ? block.input : block.output;
            const payloadHtml = payload !== undefined ? `<pre><code>${escapeHtml(JSON.stringify(payload, null, 2))}</code></pre>` : '';
            return `
    <details class="gem-thoughts">
      <summary class="gem-thoughts-summary">
        <div class="gem-thoughts-header"><span>${escapeHtml(label)}</span>${CHEVRON_SVG}</div>
      </summary>
      <div class="gem-thoughts-content">${display}${payloadHtml}</div>
    </details>`;
        }
        case 'thematicBreak':
            return '<hr class="gem-hr">';
        case 'unknown': {
            diag(ctx, 'info', 'HTML_UNKNOWN_BLOCK', `unknown block rendered visibly (sourceType=${block.sourceType})`, path);
            const resolved = resolveUnknownBlockFallback(block);
            let body: string;
            if (resolved.kind === 'blocks') {
                body = (block.fallbackBlocks ?? []).map((b, i) => renderBlock(b, ctx, `${path}/fallback:${i}`)).join('');
            } else if (resolved.kind === 'payload') {
                if (resolved.truncated) {
                    diag(ctx, 'warning', 'HTML_UNKNOWN_PAYLOAD_TRUNCATED', `unknown block payload truncated (sourceType=${block.sourceType})`, path);
                }
                body = `<pre class="gem-unknown-payload">${escapeHtml(resolved.text)}</pre>`;
            } else {
                body = `<div>${escapeHtml(resolved.text)}</div>`;
            }
            return `<section class="gem-unknown-block" data-source-type="${escapeHtml(block.sourceType)}"><div class="gem-unknown-label">Unsupported · ${escapeHtml(block.sourceType)}</div>${body}</section>`;
        }
        default:
            return '';
    }
}

function renderBlocks(blocks: BlockNode[], ctx: RenderCtx, path: string): string {
    return (blocks ?? []).map((b, i) => renderBlock(b, ctx, `${path}/block:${i}`)).join('\n');
}

function isAssetBlock(b: BlockNode): b is ImageBlock | FileBlock {
    return b.type === 'image' || b.type === 'file';
}

function renderCompanionCards(msg: MessageNode, bundle: CanonicalConversationBundle, ctx: RenderCtx, path: string): string {
    const plan = collectCompanionPlacements(msg, bundle);
    for (const d of plan.diagnostics) diag(ctx, d.severity, d.code, d.message, d.path ?? path);
    const cards: string[] = [];
    plan.trailingImages.forEach((id, i) => {
        cards.push(renderImageCard({ type: 'image', id: `companion:image:${id}`, assetId: id }, ctx, `${path}/companion:${i}`));
    });
    plan.trailingFiles.forEach((id, i) => {
        cards.push(renderFileCard({ type: 'file', id: `companion:file:${id}`, assetId: id }, ctx, `${path}/companion:${i}`));
    });
    return cards.join('\n');
}

function renderUserMessage(msg: MessageNode, turnIdx: number, ctx: RenderCtx, bundle: CanonicalConversationBundle): string {
    const path = `message:${msg.id}`;
    const assetBlocks = msg.blocks.filter(isAssetBlock);
    const contentBlocks = msg.blocks.filter((b) => !isAssetBlock(b));
    const cards: string[] = [];
    if (assetBlocks.length) cards.push(assetBlocks.map((b, i) => renderBlock(b, ctx, `${path}/asset:${i}`)).join('\n'));
    const companions = renderCompanionCards(msg, bundle, ctx, path);
    if (companions) cards.push(companions);
    const carouselHtml = cards.length ? renderCarousel(cards.join('\n')) : '';
    const bodyHtml = renderBlocks(contentBlocks, ctx, path);

    const plain = contentBlocks.map((b) => extractBlockText(b)).join('\n');
    const isLongPrompt = plain.length > 280 || plain.split('\n').length > 5;
    const showMoreText = ctx.isEn ? 'Show more' : '展开';
    const showLessText = ctx.isEn ? 'Show less' : '收起';

    return `
  <section class="gem-turn gem-turn-user" id="turn-user-${turnIdx}">
    ${carouselHtml}
    <div class="gem-user-bubble">
      <div class="gem-prompt-content ${isLongPrompt ? 'collapsed' : ''}" id="prompt-content-${turnIdx}">
        ${bodyHtml}
      </div>
      ${isLongPrompt ? `
      <button class="gem-prompt-toggle" onclick="togglePrompt(this, '${showMoreText}', '${showLessText}')">
        <span class="toggle-text">${showMoreText}</span>
        <svg class="chevron-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
      </button>` : ''}
    </div>
  </section>`;
}

function renderModelMessage(msg: MessageNode, turnIdx: number, ctx: RenderCtx, bundle: CanonicalConversationBundle): string {
    const path = `message:${msg.id}`;
    const assetBlocks = msg.blocks.filter(isAssetBlock);
    const contentBlocks = msg.blocks.filter((b) => !isAssetBlock(b));
    const cards: string[] = [];
    if (assetBlocks.length) cards.push(assetBlocks.map((b, i) => renderBlock(b, ctx, `${path}/asset:${i}`)).join('\n'));
    const companions = renderCompanionCards(msg, bundle, ctx, path);
    if (companions) cards.push(companions);
    const carouselHtml = cards.length ? renderCarousel(cards.join('\n')) : '';
    return `
  <section class="gem-turn gem-turn-model" id="turn-model-${turnIdx}">
    <div class="gem-model-content">
      ${renderBlocks(contentBlocks, ctx, path)}
    </div>
    ${carouselHtml}
  </section>`;
}

export function renderCanonicalHtml(
    bundle: CanonicalConversationBundle,
    options: CanonicalHtmlOptions = {},
): CanonicalHtmlResult {
    const diagnostics: RenderDiagnostic[] = [];
    const ctx: RenderCtx = {
        assets: new Map((bundle.assets ?? []).map((a) => [a.id, a])),
        citations: new Map((bundle.citations ?? []).map((c) => [c.id, c])),
        isEn: options.lang === 'en',
        assetUrl: options.assetUrl,
        thoughtCollapsed: options.thoughtInitiallyCollapsed ?? false,
        diagnostics,
    };

    const view = projectConversation(bundle);
    const messages = view.messages;
    let turnsHtml = '';
    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        turnsHtml += msg.role === 'user'
            ? renderUserMessage(msg, i, ctx, bundle)
            : renderModelMessage(msg, i, ctx, bundle);
    }
    if (!messages.length) {
        const emptyMsg = ctx.isEn ? 'Empty conversation or fetch failed.' : '暂无对话记录或拉取失败。';
        turnsHtml = `<div class="gem-empty-notice">${emptyMsg}</div>`;
    }

    const rawTitle = bundle.conversation.title?.value ?? 'Gemini Conversation';
    const safeTitle = escapeHtml(String(rawTitle).replace(/[\r\n]+/g, ' ').trim());
    const isLightTheme = options.theme === 'light';

    const html = `<!DOCTYPE html>
<html lang="${ctx.isEn ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="Gemini Exporter">
<title>${safeTitle}</title>
<style>${GEM_HTML_CSS}
${CANONICAL_EXTRA_CSS}</style>
</head>
<body class="${isLightTheme ? 'light-theme' : ''}">

<main class="gem-container">
  ${turnsHtml}
</main>

<script>${GEM_HTML_SCRIPT}</script>
</body>
</html>`;
    return { html, diagnostics, projectedMessageIds: view.messages.map((m) => m.id) };
}

export class CanonicalHtmlRenderer implements ConversationRenderer {
    readonly format = 'html' as const;

    constructor(private readonly options: CanonicalHtmlOptions = {}) {}

    async render(context: RenderContext): Promise<ExportArtifact> {
        context.signal.throwIfAborted();
        context.reportProgress('html:collect-assets', 0, 1);

        const view = projectConversation(context.bundle);
        const referenced = new Set<string>();
        for (const m of view.messages) {
            for (const id of collectReferencedAssetIds(m.blocks)) referenced.add(id);
            const plan = collectCompanionPlacements(m, context.bundle);
            for (const id of plan.trailingImages) referenced.add(id);
            for (const id of plan.trailingFiles) referenced.add(id);
        }

        const urlByAssetId = new Map<string, string>();
        const omitted: Array<{ resourceId: string; reason: string }> = [];
        for (const assetId of referenced) {
            context.signal.throwIfAborted();
            try {
                const resolved = await context.assets.resolve(assetId);
                const url = resolved?.renderUrl ?? resolved?.asset.storageRef;
                if (url) {
                    urlByAssetId.set(assetId, url);
                } else {
                    omitted.push({ resourceId: assetId, reason: 'unresolvable' });
                }
            } catch {
                omitted.push({ resourceId: assetId, reason: 'resolve-error' });
            }
        }
        context.reportProgress('html:collect-assets', 1, 1);

        const { html, diagnostics } = renderCanonicalHtml(context.bundle, {
            ...this.options,
            lang: context.locale,
            assetUrl: this.options.assetUrl
                ?? ((asset) => urlByAssetId.get(asset.id) ?? asset.storageRef),
        });

        const plan: CompanionResourcePlan = {
            resourceIds: [...urlByAssetId.keys()],
            omitted,
        };
        const rawTitle = context.bundle.conversation.title?.value ?? 'conversation';
        const fileName = `${String(rawTitle).replace(/[\r\n]+/g, ' ').trim().replace(/[^\w\-. ]+/g, '').slice(0, 80) || 'conversation'}.html`;

        return {
            fileName,
            mimeType: 'text/html',
            content: html,
            companionResourceIds: plan.resourceIds,
            companionPlan: plan,
            diagnostics,
        };
    }
}
