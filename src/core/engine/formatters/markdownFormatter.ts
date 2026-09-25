// src/core/engine/formatters/markdownFormatter.ts - Markdown conversation formatter
import type { ChatMessage, Attachment } from "../../../types/conversation.js";
import { stripInternalChipMarkdown } from "../../utils/chipUtils.js";
import { normId } from "../../utils/pathUtils.js";
import { I18n as I18nStatic } from "../../utils/i18n.js";
import { __resolveModule } from "../../utils/moduleOverrides.js";
import { convertHtmlToMarkdown } from "./htmlConverter.js";

export interface MarkdownFormatterOptions {
    lang?: string;
    [key: string]: any;
}

/**
 * Intelligently shift Markdown heading levels (e.g. # -> ###, ## -> ####)
 * while protecting code fences (``` or ~~~) from being modified.
 */
export function adjustHeadingHierarchy(text: string, shift: number = 2): string {
    if (!text || typeof text !== 'string') return text || '';
    const lines = text.split('\n');
    const out: string[] = [];
    let inCodeBlock = false;
    let fenceChar = '';
    let fenceLen = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.trim();

        if (!inCodeBlock) {
            if (stripped.startsWith('```') || stripped.startsWith('~~~')) {
                inCodeBlock = true;
                fenceChar = stripped[0];
                fenceLen = stripped.length - stripped.replace(new RegExp(`^\\${fenceChar}+`), '').length;
                out.push(line);
                continue;
            }
        } else {
            if (stripped.startsWith(fenceChar.repeat(fenceLen))) {
                inCodeBlock = false;
            }
            out.push(line);
            continue;
        }

        // Outside code block: check if line starts with markdown heading (# )
        if (line.startsWith('#')) {
            const match = line.match(/^(#{1,6})(\s+.*)$/);
            if (match) {
                const currentLevel = match[1].length;
                const newLevel = Math.min(6, currentLevel + shift);
                out.push('#'.repeat(newLevel) + match[2]);
                continue;
            }
        }

        out.push(line);
    }

    return out.join('\n');
}

/**
 * Render message attachments in Markdown format.
 */
export function renderAttachments(atts?: any[] | null, isEn: boolean = false): string {
    if (!atts || !Array.isArray(atts) || !atts.length) return '';
    let block = '';
    for (const att of atts) {
        if (att.type === 'image') {
            const local = att.localName || `assets/image.jpg`;
            const alt = String(att.alt || att.name || (isEn ? 'Image' : '图片')).replace(/[[\]]/g, '');
            const online = att.src || att.originalUrl || '';
            if (online && online.startsWith('http') && !online.includes('googleusercontent.com/immersive_entry_chip')) {
                block += `[![${alt}](${local})](${online})\n\n`;
            } else {
                block += `![${alt}](${local})\n\n`;
            }
        } else if (att.type === 'file') {
            const local = att.localName || `files/${att.name || 'attachment'}`;
            let name = att.title || att.name || '';
            if (!name || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(name) || name.includes('://')) {
                const baseLocal = (att.localName || '').split(/[/\\]/).pop();
                name = baseLocal ? baseLocal.replace(/^[0-9a-f]{6,8}_/i, '') : (isEn ? 'Attachment' : '附件');
            }
            if (!name) name = isEn ? 'Attachment' : '附件';
            if (/^(我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i.test(name)) {
                name = isEn ? '📑 Deep Research Report' : '📑 深度研究报告 (Deep Research Report)';
            }
            block += `- 📎 [${name}](${local})\n\n`;
        }
    }
    return block;
}

/**
 * Sanitize message body content from Google internal placeholder URLs and tool anchors
 */
export function cleanMessageBody(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';
    let converted = convertHtmlToMarkdown(text);
    return stripInternalChipMarkdown(converted);
}

/**
 * Wrap raw userscript blocks in a javascript fence. Natural-language prompts are left untouched.
 */
export function sanitizeUserPrompt(text?: string | null): string {
    if (!text || typeof text !== 'string') return '';
    let cleaned = cleanMessageBody(text);
    if (!cleaned) return '';

    if (!cleaned.includes('```') && cleaned.includes('// ==UserScript==')) {
        const lines = cleaned.split('\n');
        let outLines: string[] = [];
        let inFence = false;
        for (let line of lines) {
            let s = line.trim();
            if (s.startsWith('// ==UserScript==') && !inFence) {
                outLines.push('```javascript');
                outLines.push(line);
                inFence = true;
            } else {
                outLines.push(line);
            }
        }
        if (inFence) outLines.push('```');
        return outLines.join('\n');
    }
    return cleaned;
}

/**
 * Convert conversation object to standardized Markdown.
 * Compatible with Obsidian, Notion, Logseq, Typora, and GitHub Markdown.
 */
export function toMarkdown(chat: any, opts: MarkdownFormatterOptions = {}): string {
    if (!chat) return '';
    const i18n = __resolveModule('I18n', I18nStatic);
    const isEn = opts.lang ? (opts.lang === 'en') : (i18n && typeof i18n.getLang === 'function' && i18n.getLang() === 'en');

    if (chat.error) {
        const failTitle = isEn ? 'Export Failed' : '导出失败';
        return `# ${chat.title || 'Untitled'}\n\n> ${failTitle}: ${chat.error}\n\n> ID: ${chat.id} | URL: ${chat.url || ''}\n`;
    }

    const safeTitleClean = String(chat.title || 'Untitled').replace(/[\r\n]+/g, ' ').trim();
    const safeYamlTitle = safeTitleClean.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const toSafeIso = (v: any, fallback: string): string => {
        if (!v) return fallback;
        const d = new Date(v);
        return isNaN(d.getTime()) ? fallback : d.toISOString();
    };
    const createdIso = toSafeIso(chat.createdAt || chat.timestamp || chat.updatedAt, new Date().toISOString());
    const updatedIso = toSafeIso(chat.updatedAt || chat.timestamp || chat.createdAt, createdIso);
    const convUrl = chat.url || (chat.id ? `https://gemini.google.com/app/${normId(chat.id)}` : '');

    // 1. YAML Frontmatter (Obsidian Properties / Notion Database / Logseq)
    let md = `---\n`;
    md += `title: "${safeYamlTitle}"\n`;
    md += `id: "${chat.id || ''}"\n`;
    if (convUrl) md += `url: "${convUrl}"\n`;
    if (createdIso) md += `date: "${createdIso}"\n`;
    if (updatedIso) md += `updated: "${updatedIso}"\n`;
    md += `exported: "${new Date().toISOString()}"\n`;
    md += `tags:\n  - gemini-export\n`;
    md += `---\n\n`;

    // 2. Document Title & Metadata Badges
    md += `# ${safeTitleClean}\n\n`;
    const metaBadges: string[] = [];
    const linkText = isEn ? '🔗 Chat Link' : '🔗 对话链接';
    if (convUrl) metaBadges.push(`[${linkText}](${convUrl})`);
    if (chat.id) metaBadges.push(`🆔 \`${chat.id}\``);
    if (createdIso) metaBadges.push(`📅 ${new Date(chat.createdAt || createdIso).toLocaleString()}`);
    if (chat.attachmentCount) metaBadges.push(isEn ? `📎 ${chat.attachmentCount} attachments` : `📎 附件 ${chat.attachmentCount} 个`);
    if (metaBadges.length > 0) {
        md += `> ${metaBadges.join(' · ')}\n\n---\n\n`;
    }

    const messages: ChatMessage[] = chat.messages || [];
    if (!messages.length) {
        const emptyNotice = chat.isEmpty
            ? (isEn ? '*(Empty conversation)*' : '*（此会话无对话内容）*')
            : (isEn ? '_Empty conversation or fetch failed_' : '_空对话或取回失败_');
        md += `${emptyNotice} URL: ${convUrl}\n`;
        return md;
    }

    // 3. Conversation Messages
    for (const m of messages) {
        const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
        const role = m.role === 'user' ? 'user' : 'model';

        if (role === 'user') {
            md += isEn ? `## 👤 You\n\n` : `## 👤 你\n\n`;
            if (timeStr) md += `> ⏱️ ${timeStr}\n\n`;

            let userAtts = [...(m.attachments || [])];
            if ((m as any).images && (m as any).images.length) {
                for (const img of (m as any).images) {
                    if (!userAtts.some(a => a.localName === img.localName || a.url === img.url)) {
                        userAtts.push({
                            type: 'image',
                            localName: img.localName || `assets/${img.fileName || 'image.jpg'}`,
                            name: img.fileName || 'image.jpg',
                            src: img.resolvedUrl || img.sourceUrl || img.url
                        } as any);
                    }
                }
            }
            if ((m as any).documents && (m as any).documents.length) {
                for (const doc of (m as any).documents) {
                    if (!userAtts.some(a => a.localName === doc.localName || a.url === doc.url)) {
                        userAtts.push({
                            type: 'file',
                            localName: doc.localName || `files/${doc.title || 'doc.md'}`,
                            title: doc.title || 'document',
                            url: doc.url
                        } as any);
                    }
                }
            }
            if (userAtts.length) {
                md += renderAttachments(userAtts, isEn);
            }

            const userBody = sanitizeUserPrompt(m.content);
            if (userBody) {
                md += `${userBody}\n\n`;
            }
        } else {
            md += `## 🤖 Gemini\n\n`;
            if (timeStr) md += `> ⏱️ ${timeStr}\n\n`;

            // Thinking Process (Isolated with double blank lines for strict Markdown parsers)
            const thoughtsRaw = (m as any).thoughts || (m as any).thinking || '';
            const thoughts = (Array.isArray(thoughtsRaw) ? thoughtsRaw.join('\n\n') : String(thoughtsRaw)).trim();
            if (thoughts) {
                const thoughtSummary = isEn ? '🧠 Thinking Process' : '🧠 思考过程';
                md += `<details>\n<summary>${thoughtSummary}</summary>\n\n${thoughts}\n\n</details>\n\n`;
            }

            // AI Answer Content with Heading Hierarchy Protection and Chip Sanitization
            const modelBody = cleanMessageBody(m.content);
            if (modelBody) {
                const adjusted = adjustHeadingHierarchy(modelBody, 2);
                md += `${adjusted}\n\n`;
            }

            let modelAtts = [...(m.attachments || [])];
            if ((m as any).images && (m as any).images.length) {
                for (const img of (m as any).images) {
                    if (!modelAtts.some(a => a.localName === img.localName || a.url === img.url)) {
                        modelAtts.push({
                            type: 'image',
                            localName: img.localName || `assets/${img.fileName || 'image.jpg'}`,
                            name: img.fileName || 'image.jpg',
                            src: img.resolvedUrl || img.sourceUrl || img.url
                        } as any);
                    }
                }
            }
            if (modelAtts.length) {
                md += renderAttachments(modelAtts, isEn);
            }

            // Citations / Sources
            if ((m as any).citations && (m as any).citations.length) {
                const sourceHeader = isEn ? `> 🌐 **Sources:**\n` : `> 🌐 **参考来源：**\n`;
                md += sourceHeader;
                (m as any).citations.forEach((c: any, idx: number) => {
                    const citeTitle = c.title || c.url || (isEn ? `Source ${idx + 1}` : `来源 ${idx + 1}`);
                    md += `> [${idx + 1}] [${citeTitle}](${c.url})\n`;
                });
                md += `\n`;
            }

            md += `---\n\n`;
        }
    }

    return md;
}
