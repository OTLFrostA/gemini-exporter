/**
 * htmlTemplate.ts
 * Standalone 1:1 Gemini-faithful HTML conversation exporter.
 * Produces self-contained, offline-compatible HTML documents with Gemini typography,
 * seamless dark/light theme matching, code copy with offline fallback,
 * expandable user prompts, and high-fidelity print / PDF readiness (@media print).
 */

import type { Conversation, ChatMessage, Attachment } from "../../../types/conversation.js";
import { cleanMessageBody } from "../formatters/markdownFormatter.js";
import { normId } from "../../utils/pathUtils.js";

export interface HtmlTemplateOptions {
    lang?: string;
    theme?: 'dark' | 'light';
    title?: string;
    [key: string]: any;
}

/**
 * Escape HTML special characters for safe markup insertion.
 */
function escapeHtml(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Escape attribute values for HTML attributes.
 */
function escapeAttr(text?: string | null): string {
    return escapeHtml(text);
}

/**
 * Validate and sanitize URLs for use in href or src attributes.
 * Disarms dangerous schemes like javascript:, vbscript:, and non-image data: schemes.
 */
export function sanitizeUrl(rawUrl?: string | null, allowImageData: boolean = false): string {
    if (!rawUrl || typeof rawUrl !== 'string') return '#';
    const trimmed = rawUrl.trim();
    if (!trimmed) return '#';

    // Disarm any control characters
    if (/[\u0000-\u001F\u007F-\u009F]/.test(trimmed)) return '#';

    // Check scheme if present
    const schemeMatch = trimmed.match(/^([a-zA-Z0-9+.-]+):/);
    if (schemeMatch) {
        const scheme = schemeMatch[1].toLowerCase();
        if (scheme === 'javascript' || scheme === 'vbscript') {
            return '#';
        }
        if (scheme === 'data') {
            if (allowImageData && /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,[a-z0-9+/=]+$/i.test(trimmed)) {
                return escapeAttr(trimmed);
            }
            return '#';
        }
        if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto' && scheme !== 'tel') {
            return '#';
        }
    }
    return escapeAttr(trimmed);
}

/**
 * Format inline Markdown syntax into HTML (code, math, bold, italic, links, images).
 * Uses delimiter-safe placeholders (@@@GEM_...@@@) to prevent collisions with bold/italic regex.
 */
function formatInlineMarkdown(text: string): string {
    if (!text) return '';

    // 1. Protect inline code `code`
    const codePlaceholders: string[] = [];
    let processed = text.replace(/`([^`\n]+)`/g, (_match, code) => {
        const idx = codePlaceholders.length;
        codePlaceholders.push(`<code class="gem-inline-code">${escapeHtml(code)}</code>`);
        return `GEMCODEPK${idx}ENDPK`;
    });

    // 2. Protect inline math $formula$ (avoid single dollar currency like $100)
    const mathPlaceholders: string[] = [];
    processed = processed.replace(/(?<!\$)\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)/g, (_match, formula) => {
        const idx = mathPlaceholders.length;
        mathPlaceholders.push(`<span class="gem-math-inline">${escapeHtml(formula)}</span>`);
        return `GEMMATHPK${idx}ENDPK`;
    });

    // 3. Linked Images: [![alt](src)](href)
    processed = processed.replace(/\[!\[([^\]]*)\]\(([^)]+)\)\]\(([^)]+)\)/g, (_match, alt, src, href) => {
        const safeAlt = escapeAttr(alt);
        const safeSrc = sanitizeUrl(src.trim(), true);
        const safeHref = sanitizeUrl(href.trim(), false);
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="gem-img-link" title="点击查看原图"><img class="gem-msg-img" src="${safeSrc}" alt="${safeAlt}" loading="lazy"></a>`;
    });

    // 4. Standalone Images: ![alt](src)
    processed = processed.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, src) => {
        const safeAlt = escapeAttr(alt);
        const safeSrc = sanitizeUrl(src.trim(), true);
        return `<a href="${safeSrc}" target="_blank" rel="noopener noreferrer" class="gem-img-link"><img class="gem-msg-img" src="${safeSrc}" alt="${safeAlt}" loading="lazy"></a>`;
    });

    // 5. Links: [text](href)
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
        const safeHref = sanitizeUrl(href.trim(), false);
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" class="gem-link">${formatInlineMarkdown(label)}</a>`;
    });

    // 5. Bold & Italic
    processed = processed.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    processed = processed.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    processed = processed.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    processed = processed.replace(/_([^_]+)_/g, '<em>$1</em>');

    // 6. Strikethrough ~~text~~
    processed = processed.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 7. Restore inline math
    for (let i = 0; i < mathPlaceholders.length; i++) {
        processed = processed.replace(`GEMMATHPK${i}ENDPK`, mathPlaceholders[i]);
    }

    // 8. Restore inline code
    for (let i = 0; i < codePlaceholders.length; i++) {
        processed = processed.replace(`GEMCODEPK${i}ENDPK`, codePlaceholders[i]);
    }

    return processed;
}

/**
 * Check if a table line is a markdown separator (e.g., |---|---|).
 */
function isTableSeparator(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.includes('|')) return false;
    const parts = trimmed.split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
    if (!parts.length) return false;
    return parts.every(p => /^:?-+:?$/.test(p));
}

/**
 * Parse cells from a Markdown table row.
 */
function parseTableRow(line: string): string[] {
    const trimmed = line.trim();
    let content = trimmed;
    if (content.startsWith('|')) content = content.slice(1);
    if (content.endsWith('|')) content = content.slice(0, -1);
    return content.split('|').map(c => c.trim());
}

/**
 * Convert block Markdown text into clean HTML elements.
 */
export function renderMarkdownToHtml(markdown: string): string {
    if (!markdown || typeof markdown !== 'string') return '';

    const lines = markdown.split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // 1. Empty lines
        if (!trimmed) {
            i++;
            continue;
        }

        // 2. Fenced Code Block (```lang or ~~~lang)
        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
            const fenceChar = trimmed[0];
            const fenceMatch = trimmed.match(new RegExp(`^(\\${fenceChar}{3,})(.*)$`));
            const fenceLen = fenceMatch ? fenceMatch[1].length : 3;
            const lang = fenceMatch ? fenceMatch[2].trim() : '';
            const codeLines: string[] = [];
            i++;

            while (i < lines.length) {
                const current = lines[i];
                if (current.trim().startsWith(fenceChar.repeat(fenceLen))) {
                    i++;
                    break;
                }
                codeLines.push(current);
                i++;
            }

            const rawCode = codeLines.join('\n');
            const safeLang = escapeHtml(lang || 'text');
            const safeCode = escapeHtml(rawCode);

            out.push(`
<div class="gem-code-block">
  <div class="gem-code-header">
    <span class="gem-code-lang">${safeLang}</span>
    <button class="gem-copy-btn" onclick="copyCode(this)" title="Copy Code">
      <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      <span class="copy-text">复制</span>
    </button>
  </div>
  <pre><code class="language-${safeLang}">${safeCode}</code></pre>
</div>`);
            continue;
        }

        // 3. Display Math Block ($$ ... $$)
        if (trimmed.startsWith('$$')) {
            const mathLines: string[] = [];
            if (trimmed.length > 2 && trimmed.endsWith('$$') && trimmed !== '$$') {
                mathLines.push(trimmed.slice(2, -2).trim());
                i++;
            } else {
                i++;
                while (i < lines.length) {
                    const current = lines[i];
                    if (current.trim() === '$$' || current.trim().endsWith('$$')) {
                        if (current.trim() !== '$$') {
                            mathLines.push(current.trim().replace(/\$\$$/, ''));
                        }
                        i++;
                        break;
                    }
                    mathLines.push(current);
                    i++;
                }
            }
            out.push(`<div class="gem-math-block">${escapeHtml(mathLines.join('\n'))}</div>`);
            continue;
        }

        // 4. Markdown Table (| Header 1 | Header 2 |)
        if (trimmed.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            const headerCells = parseTableRow(line);
            i += 2; // skip header and separator
            const bodyRows: string[][] = [];

            while (i < lines.length && lines[i].trim().startsWith('|')) {
                bodyRows.push(parseTableRow(lines[i]));
                i++;
            }

            let tableHtml = '<div class="gem-table-wrapper"><table class="gem-table"><thead><tr>';
            for (const th of headerCells) {
                tableHtml += `<th>${formatInlineMarkdown(escapeHtml(th))}</th>`;
            }
            tableHtml += '</tr></thead><tbody>';
            for (const row of bodyRows) {
                tableHtml += '<tr>';
                for (let c = 0; c < headerCells.length; c++) {
                    const cellVal = row[c] || '';
                    tableHtml += `<td>${formatInlineMarkdown(escapeHtml(cellVal))}</td>`;
                }
                tableHtml += '</tr>';
            }
            tableHtml += '</tbody></table></div>';
            out.push(tableHtml);
            continue;
        }

        // 5. Headings (# to ######)
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
            const level = headingMatch[1].length;
            const hText = headingMatch[2].trim();
            out.push(`<h${level} class="gem-heading">${formatInlineMarkdown(escapeHtml(hText))}</h${level}>`);
            i++;
            continue;
        }

        // 6. Blockquote (> ...)
        if (trimmed.startsWith('>')) {
            const bqLines: string[] = [];
            while (i < lines.length && lines[i].trim().startsWith('>')) {
                bqLines.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            const innerHtml = renderMarkdownToHtml(bqLines.join('\n'));
            out.push(`<blockquote class="gem-blockquote">${innerHtml}</blockquote>`);
            continue;
        }

        // 7. Horizontal Rule (---, ***, ___)
        if (/^([-*_]){3,}$/.test(trimmed)) {
            out.push('<hr class="gem-hr">');
            i++;
            continue;
        }

        // 8. Lists (Unordered - or *, Ordered 1.)
        const isUlItem = /^[-*+]\s+(.*)$/.test(trimmed);
        const isOlItem = /^\d+\.\s+(.*)$/.test(trimmed);
        if (isUlItem || isOlItem) {
            const tag = isUlItem ? 'ul' : 'ol';
            const listItems: string[] = [];

            while (i < lines.length) {
                const cur = lines[i].trim();
                const matchUl = cur.match(/^[-*+]\s+(.*)$/);
                const matchOl = cur.match(/^\d+\.\s+(.*)$/);
                if (isUlItem && matchUl) {
                    listItems.push(matchUl[1]);
                    i++;
                } else if (!isUlItem && matchOl) {
                    listItems.push(matchOl[1]);
                    i++;
                } else if (cur && !cur.startsWith('#') && !cur.startsWith('```') && !cur.startsWith('|') && listItems.length > 0) {
                    // Multiline list item continuation
                    listItems[listItems.length - 1] += ' ' + cur;
                    i++;
                } else {
                    break;
                }
            }

            let listHtml = `<${tag} class="gem-list">`;
            for (const item of listItems) {
                listHtml += `<li>${formatInlineMarkdown(escapeHtml(item))}</li>`;
            }
            listHtml += `</${tag}>`;
            out.push(listHtml);
            continue;
        }

        // 9. Regular Paragraph
        const pLines: string[] = [];
        while (i < lines.length) {
            const cur = lines[i];
            const curTrim = cur.trim();
            if (!curTrim) break;
            if (curTrim.startsWith('```') || curTrim.startsWith('~~~') ||
                curTrim.startsWith('$$') ||
                (curTrim.startsWith('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) ||
                curTrim.startsWith('#') || curTrim.startsWith('>') ||
                /^([-*_]){3,}$/.test(curTrim) ||
                /^[-*+]\s+/.test(curTrim) || /^\d+\.\s+/.test(curTrim)) {
                break;
            }
            pLines.push(cur);
            i++;
        }

        if (pLines.length > 0) {
            const pContent = pLines.map(l => formatInlineMarkdown(escapeHtml(l))).join('<br>');
            out.push(`<p class="gem-paragraph">${pContent}</p>`);
        }
    }

    return out.join('\n');
}

/**
 * Gather and normalize all attachments associated with a message.
 */
function normalizeAttachments(m: ChatMessage): Attachment[] {
    const atts: Attachment[] = [...(m.attachments || [])];
    for (const a of atts) {
        const loc = a.localName || '';
        if (loc && !loc.startsWith('assets/') && !loc.startsWith('http')) {
            a.localName = `assets/${loc}`;
        }
    }

    if (m.images && Array.isArray(m.images) && m.images.length) {
        for (const img of m.images) {
            if (!atts.some(a => a.localName === img.localName || a.url === img.url)) {
                let loc = img.localName || `assets/${img.fileName || 'image.jpg'}`;
                if (!loc.startsWith('assets/') && !loc.startsWith('http')) {
                    loc = `assets/${loc}`;
                }
                atts.push({
                    type: 'image',
                    localName: loc,
                    name: img.fileName || img.name || 'image.jpg',
                    src: img.resolvedUrl || img.sourceUrl || img.url
                });
            }
        }
    }

    if (m.documents && Array.isArray(m.documents) && m.documents.length) {
        for (const doc of m.documents) {
            if (!atts.some(a => a.localName === doc.localName || a.url === doc.url)) {
                let loc = doc.localName || `assets/${doc.title || doc.name || 'document'}`;
                if (!loc.startsWith('assets/') && !loc.startsWith('http')) {
                    loc = `assets/${loc}`;
                }
                atts.push({
                    type: 'file',
                    localName: loc,
                    title: doc.title || doc.name || 'document',
                    name: doc.title || doc.name || 'document',
                    url: doc.url
                });
            }
        }
    }

    return atts;
}

/**
 * Render attachment cards for user turns. Click directly opens the file or image.
 */
function renderAttachmentCarousel(atts: Attachment[], _isEn: boolean): string {
    if (!atts || !atts.length) return '';

    let cardsHtml = '';
    for (const att of atts) {
        const isImage = att.type === 'image' || att.isImage || /\.(png|jpe?g|webp|gif|svg)$/i.test(att.localName || att.name || '');
        const displayName = att.title || att.name || att.fileName || (isImage ? 'image.jpg' : 'file');
        const safeName = escapeHtml(displayName);
        let rawLocal = att.localName || (isImage ? 'assets/image.jpg' : 'assets/file');
        if (rawLocal && !rawLocal.startsWith('assets/') && !rawLocal.startsWith('http')) {
            rawLocal = `assets/${rawLocal}`;
        }
        const localPath = sanitizeUrl(rawLocal, true);
        const rawOnline = att.src || att.resolvedUrl || att.url || '';
        const onlineUrl = rawOnline ? sanitizeUrl(rawOnline, true) : '';
        const safeOnline = onlineUrl !== '#' ? onlineUrl : '';
        const targetHref = (localPath && localPath !== '#') ? localPath : (safeOnline || '#');
        const extMatch = displayName.match(/\.([a-z0-9]+)$/i);
        const extBadge = extMatch ? extMatch[1].toUpperCase() : (isImage ? 'IMG' : 'FILE');

        if (isImage) {
            const fallbackAttr = safeOnline ? ` onerror="this.onerror=null;if(this.dataset.fallback)this.src=this.dataset.fallback;" data-fallback-src="${safeOnline}"` : '';
            cardsHtml += `
      <a class="gem-att-card gem-att-img" href="${targetHref}" target="_blank" rel="noopener noreferrer" title="点击打开原始图片 ${safeName}">
        <div class="gem-att-preview">
          <img src="${localPath}" alt="${safeName}"${fallbackAttr}>
        </div>
        <div class="gem-att-info">
          <span class="gem-att-name">${safeName}</span>
          <span class="gem-att-badge">${extBadge}</span>
        </div>
        <div class="gem-att-open-btn">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        </div>
      </a>`;
        } else {
            cardsHtml += `
      <a class="gem-att-card gem-att-file" href="${targetHref}" target="_blank" download="${safeName}" title="点击打开或下载 ${safeName}">
        <div class="gem-att-icon">
          <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
        </div>
        <div class="gem-att-info">
          <span class="gem-att-name">${safeName}</span>
          <span class="gem-att-badge">${extBadge}</span>
        </div>
        <div class="gem-att-open-btn">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
        </div>
      </a>`;
        }
    }

    const showNav = atts.length > 2;

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

/**
 * Render user turn bubble with expandable prompt and attachment carousel.
 */
function renderUserTurn(m: ChatMessage, turnIdx: number, isEn: boolean): string {
    const atts = normalizeAttachments(m);
    const carouselHtml = renderAttachmentCarousel(atts, isEn);

    const userRaw = (m.content || '').trim();
    const isLongPrompt = userRaw.length > 280 || userRaw.split('\n').length > 5;
    const bodyHtml = renderMarkdownToHtml(userRaw);

    const showMoreText = isEn ? 'Show more' : '展开';
    const showLessText = isEn ? 'Show less' : '收起';

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

/**
 * Render model turn with thoughts/thinking accordion and Markdown content.
 */
function renderModelTurn(m: ChatMessage, turnIdx: number, isEn: boolean): string {
    const thoughtsRaw = m.thoughts || m.thinking || '';
    const thoughts = (Array.isArray(thoughtsRaw) ? thoughtsRaw.join('\n\n') : String(thoughtsRaw)).trim();
    let thoughtsHtml = '';

    if (thoughts) {
        const thoughtTitle = isEn ? 'Thinking Process' : '思考过程';
        const thoughtsBody = renderMarkdownToHtml(thoughts);
        thoughtsHtml = `
    <details class="gem-thoughts" open>
      <summary class="gem-thoughts-summary">
        <div class="gem-thoughts-header">
          <svg class="gem-thought-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12c0 2.85 1.2 5.41 3.11 7.24.38.36.61.88.61 1.42V21c0 .55.45 1 1 1h10c.55 0 1-.45 1-1v-.34c0-.54.23-1.06.61-1.42C20.8 17.41 22 14.85 22 12c0-5.52-4.48-10-10-10zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>
          <span>${thoughtTitle}</span>
          <svg class="gem-thought-chevron" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
        </div>
      </summary>
      <div class="gem-thoughts-content">
        ${thoughtsBody}
      </div>
    </details>`;
    }

    const cleanedBody = cleanMessageBody(m.content);
    const bodyHtml = renderMarkdownToHtml(cleanedBody);

    const atts = normalizeAttachments(m);
    const carouselHtml = atts.length ? renderAttachmentCarousel(atts, isEn) : '';

    return `
  <section class="gem-turn gem-turn-model" id="turn-model-${turnIdx}">
    ${thoughtsHtml}
    <div class="gem-model-content">
      ${bodyHtml}
    </div>
    ${carouselHtml}
  </section>`;
}

/**
 * Main export function: generate a complete, 1:1 styled HTML string from a Conversation.
 */
export function toHtml(chat: Conversation | any, opts: HtmlTemplateOptions = {}): string {
    if (!chat) return '';

    const isEn = opts.lang === 'en';
    const rawTitle = chat.title || 'Gemini Conversation';
    const safeTitleClean = String(rawTitle).replace(/[\r\n]+/g, ' ').trim();
    const safeTitle = escapeHtml(safeTitleClean);
    const isLightTheme = opts.theme === 'light';

    const messages: ChatMessage[] = chat.messages || [];
    let turnsHtml = '';

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];
        const role = msg.role === 'user' ? 'user' : 'model';
        if (role === 'user') {
            turnsHtml += renderUserTurn(msg, i, isEn);
        } else {
            turnsHtml += renderModelTurn(msg, i, isEn);
        }
    }

    if (!messages.length) {
        const emptyMsg = isEn ? 'Empty conversation or fetch failed.' : '暂无对话记录或拉取失败。';
        turnsHtml = `<div class="gem-empty-notice">${emptyMsg}</div>`;
    }

    return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="generator" content="Gemini Exporter">
<title>${safeTitle}</title>
<style>
:root {
  --bg-main: #131314;
  --bg-user-bubble: #282a2c;
  --bg-card: #1e1f20;
  --bg-card-hover: #2d2f31;
  --text-primary: #e3e3e3;
  --text-secondary: #9aa0a6;
  --text-muted: #757575;
  --border-color: #3c4043;
  --accent-blue: #a8c7fa;
  --accent-blue-hover: #8ab4f8;
  --code-bg: #1e1f20;
  --code-border: #3c4043;
  --table-stripe: rgba(255, 255, 255, 0.02);
  --math-color: #c4eed0;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
}

@media (prefers-color-scheme: light) {
  :root {
    --bg-main: #ffffff;
    --bg-user-bubble: #f0f4f9;
    --bg-card: #f8f9fa;
    --bg-card-hover: #eef0f3;
    --text-primary: #1f1f1f;
    --text-secondary: #444746;
    --text-muted: #747775;
    --border-color: #e0e2e5;
    --accent-blue: #0b57d0;
    --accent-blue-hover: #0842a0;
    --code-bg: #f8f9fa;
    --code-border: #e0e2e5;
    --table-stripe: rgba(0, 0, 0, 0.02);
    --math-color: #0f5132;
    --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  }
}

body.light-theme {
  --bg-main: #ffffff;
  --bg-user-bubble: #f0f4f9;
  --bg-card: #f8f9fa;
  --bg-card-hover: #eef0f3;
  --text-primary: #1f1f1f;
  --text-secondary: #444746;
  --text-muted: #747775;
  --border-color: #e0e2e5;
  --accent-blue: #0b57d0;
  --accent-blue-hover: #0842a0;
  --code-bg: #f8f9fa;
  --code-border: #e0e2e5;
  --table-stripe: rgba(0, 0, 0, 0.02);
  --math-color: #0f5132;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background-color: var(--bg-main);
  color: var(--text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Google Sans", Helvetica, Arial, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* Conversation Container - 1:1 Gemini Pure Stream */
.gem-container {
  max-width: 840px;
  margin: 0 auto;
  padding: 40px 20px 80px;
}

/* Turn Items */
.gem-turn {
  margin-bottom: 32px;
}

.gem-turn-user {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.gem-user-bubble {
  background: var(--bg-user-bubble);
  color: var(--text-primary);
  border-radius: 20px 20px 4px 20px;
  padding: 14px 18px;
  max-width: 85%;
  font-size: 15px;
  line-height: 1.55;
  box-shadow: var(--shadow-sm);
  word-break: break-word;
}

.gem-prompt-content.collapsed {
  max-height: 120px;
  overflow: hidden;
  position: relative;
  mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
}

.gem-prompt-content.expanded {
  max-height: none;
  mask-image: none;
  -webkit-mask-image: none;
}

.gem-prompt-toggle {
  background: transparent;
  border: none;
  color: var(--accent-blue);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  transition: background 0.2s;
}
.gem-prompt-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
}
.gem-prompt-toggle.expanded .chevron-icon {
  transform: rotate(180deg);
}

/* Attachment Carousel */
.gem-carousel-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  max-width: 85%;
}

.gem-carousel-track {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  scroll-behavior: smooth;
  padding: 4px 2px;
  scrollbar-width: none;
}
.gem-carousel-track::-webkit-scrollbar {
  display: none;
}

.gem-carousel-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
  transition: background 0.2s, opacity 0.2s;
}
.gem-carousel-nav-btn:hover {
  background: var(--bg-card-hover);
}
.gem-carousel-nav-btn.prev {
  left: -14px;
}
.gem-carousel-nav-btn.next {
  right: -14px;
}

.gem-att-card {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  text-decoration: none;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
  max-width: 240px;
}
.gem-att-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--accent-blue);
}

.gem-att-preview {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  overflow: hidden;
  flex: none;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gem-att-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.gem-att-icon {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  background: rgba(168, 199, 250, 0.12);
  color: var(--accent-blue);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.gem-att-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
}

.gem-att-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gem-att-badge {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.gem-att-open-btn {
  color: var(--text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 4px;
}
.gem-att-card:hover .gem-att-open-btn {
  color: var(--accent-blue);
}

/* Model Turn */
.gem-turn-model {
  display: flex;
  flex-direction: column;
  margin-bottom: 40px;
}

.gem-model-content {
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1.65;
  word-break: break-word;
}

/* Thinking Process Accordion */
.gem-thoughts {
  margin-bottom: 16px;
  border-left: 2px solid var(--border-color);
  padding-left: 12px;
}

.gem-thoughts-summary {
  list-style: none;
  cursor: pointer;
  user-select: none;
}
.gem-thoughts-summary::-webkit-details-marker {
  display: none;
}

.gem-thoughts-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.2s, color 0.2s;
}
.gem-thoughts-header:hover {
  background: var(--bg-card);
  color: var(--text-primary);
}

.gem-thoughts[open] .gem-thought-chevron {
  transform: rotate(180deg);
}

.gem-thoughts-content {
  margin-top: 10px;
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.55;
  font-style: italic;
}

/* Content Elements */
.gem-paragraph {
  margin: 0.8em 0;
}

.gem-heading {
  font-weight: 600;
  margin: 1.4em 0 0.6em;
  color: var(--text-primary);
}
h1.gem-heading { font-size: 1.65em; }
h2.gem-heading { font-size: 1.4em; }
h3.gem-heading { font-size: 1.2em; }
h4.gem-heading { font-size: 1.05em; }

.gem-blockquote {
  border-left: 3px solid var(--accent-blue);
  margin: 1.2em 0;
  padding: 0.6em 1.2em;
  background: rgba(168, 199, 250, 0.06);
  border-radius: 0 8px 8px 0;
  color: var(--text-secondary);
}

.gem-hr {
  border: none;
  border-top: 1px solid var(--border-color);
  margin: 2em 0;
}

.gem-list {
  margin: 0.8em 0 0.8em 1.8em;
}
.gem-list li {
  margin-bottom: 0.35em;
}

.gem-inline-code {
  background: var(--bg-card);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13.5px;
  border: 1px solid var(--border-color);
}

.gem-code-block {
  margin: 1.2em 0;
  border: 1px solid var(--code-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--code-bg);
}

.gem-code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 14px;
  background: rgba(0, 0, 0, 0.15);
  border-bottom: 1px solid var(--code-border);
}

.gem-code-lang {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: lowercase;
}

.gem-copy-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}
.gem-copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}
.gem-copy-btn.copied {
  color: #34d399;
}

.gem-code-block pre {
  margin: 0;
  padding: 14px 16px;
  overflow-x: auto;
}
.gem-code-block code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13.5px;
  line-height: 1.5;
}

.gem-table-wrapper {
  overflow-x: auto;
  margin: 1.2em 0;
  border: 1px solid var(--border-color);
  border-radius: 8px;
}
.gem-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}
.gem-table th, .gem-table td {
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  text-align: left;
}
.gem-table th {
  background: var(--bg-card);
  font-weight: 600;
}
.gem-table tr:nth-child(even) {
  background: var(--table-stripe);
}

.gem-math-inline {
  font-family: "KaTeX_Math", "Cambria Math", "Times New Roman", serif;
  font-style: italic;
  padding: 0 3px;
  color: var(--math-color);
}
.gem-math-block {
  font-family: "KaTeX_Math", "Cambria Math", "Times New Roman", serif;
  margin: 1.2em 0;
  text-align: center;
  overflow-x: auto;
  padding: 10px;
  color: var(--math-color);
}

.gem-msg-img {
  max-width: 100%;
  border-radius: 12px;
  margin: 10px 0;
  cursor: pointer;
  transition: opacity 0.2s;
}
.gem-msg-img:hover {
  opacity: 0.95;
}

.gem-img-link {
  display: inline-block;
}

.gem-link {
  color: var(--accent-blue);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.gem-empty-notice {
  text-align: center;
  color: var(--text-muted);
  padding: 60px 0;
  font-size: 15px;
}

/* High Fidelity Print Stylesheet (@media print) for direct PDF output */
@media print {
  @page {
    margin: 15mm 15mm 15mm 15mm;
    size: A4 portrait;
  }
  body {
    background: #ffffff !important;
    color: #111111 !important;
  }
  .gem-carousel-nav-btn, .gem-copy-btn, .gem-prompt-toggle, .gem-att-open-btn {
    display: none !important;
  }
  .gem-container {
    max-width: 100% !important;
    padding: 0 !important;
  }
  .gem-turn-user {
    align-items: flex-start !important;
  }
  .gem-user-bubble {
    background: #f4f6f8 !important;
    color: #111111 !important;
    border: 1px solid #dcdfe3 !important;
    max-width: 100% !important;
    box-shadow: none !important;
  }
  .gem-prompt-content.collapsed {
    max-height: none !important;
    mask-image: none !important;
    -webkit-mask-image: none !important;
  }
  .gem-thoughts {
    border-left-color: #777 !important;
  }
  .gem-thoughts-content {
    display: block !important;
    color: #444 !important;
  }
  .gem-code-block, .gem-table-wrapper, .gem-att-card, blockquote, img {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .gem-code-block {
    background: #f8f9fa !important;
    border-color: #dcdfe3 !important;
  }
  .gem-code-block pre code {
    color: #111111 !important;
  }
  .gem-table th, .gem-table td {
    border-color: #ccc !important;
    color: #111111 !important;
  }
  .gem-table th {
    background: #f0f2f5 !important;
  }
  a {
    color: #0b57d0 !important;
    text-decoration: underline !important;
  }
}
</style>
</head>
<body class="${isLightTheme ? 'light-theme' : ''}">

<main class="gem-container">
  ${turnsHtml}
</main>

<script>
// Copy code button handler with offline file:/// fallback
function copyCode(btn) {
  var block = btn.closest('.gem-code-block');
  if (!block) return;
  var codeEl = block.querySelector('pre code');
  if (!codeEl) return;
  var text = codeEl.textContent || '';
  
  function showSuccess() {
    var label = btn.querySelector('.copy-text');
    if (label) {
      var orig = label.textContent;
      label.textContent = '已复制 ✓';
      btn.classList.add('copied');
      setTimeout(function() {
        label.textContent = orig;
        btn.classList.remove('copied');
      }, 2000);
    }
  }

  function fallbackCopy() {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var successful = document.execCommand('copy');
      document.body.removeChild(ta);
      if (successful) showSuccess();
    } catch (err) {}
  }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(showSuccess).catch(function() {
      fallbackCopy();
    });
  } else {
    fallbackCopy();
  }
}

// Expand / collapse user prompt
function togglePrompt(btn, showMore, showLess) {
  var content = btn.previousElementSibling;
  if (!content) return;
  var isCollapsed = content.classList.contains('collapsed');
  if (isCollapsed) {
    content.classList.remove('collapsed');
    content.classList.add('expanded');
    btn.classList.add('expanded');
    btn.querySelector('.toggle-text').textContent = showLess;
  } else {
    content.classList.remove('expanded');
    content.classList.add('collapsed');
    btn.classList.remove('expanded');
    btn.querySelector('.toggle-text').textContent = showMore;
  }
}

// Carousel horizontal scroll
function scrollCarousel(btn, dir) {
  var wrapper = btn.closest('.gem-carousel-wrapper');
  if (!wrapper) return;
  var track = wrapper.querySelector('.gem-carousel-track');
  if (!track) return;
  var step = track.clientWidth * 0.75 * dir;
  track.scrollBy({ left: step, behavior: 'smooth' });
}

function updateCarouselNav(track) {
  var wrapper = track.closest('.gem-carousel-wrapper');
  if (!wrapper) return;
  var prevBtn = wrapper.querySelector('.gem-carousel-nav-btn.prev');
  var nextBtn = wrapper.querySelector('.gem-carousel-nav-btn.next');
  var canScroll = track.scrollWidth > track.clientWidth + 5;
  if (!canScroll) {
    if (prevBtn) prevBtn.style.display = 'none';
    if (nextBtn) nextBtn.style.display = 'none';
    return;
  }
  if (prevBtn) prevBtn.style.display = track.scrollLeft > 5 ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = track.scrollLeft < track.scrollWidth - track.clientWidth - 5 ? 'flex' : 'none';
}

// Check carousel buttons on initial render
window.addEventListener('load', function() {
  document.querySelectorAll('.gem-carousel-track').forEach(function(track) {
    updateCarouselNav(track);
  });
});
window.addEventListener('resize', function() {
  document.querySelectorAll('.gem-carousel-track').forEach(function(track) {
    updateCarouselNav(track);
  });
});
</script>
</body>
</html>`;
}
