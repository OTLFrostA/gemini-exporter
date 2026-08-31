/**
 * chat_formatter.js
 * Unified export formatter for Gemini conversations.
 * Supports Markdown (Obsidian / Notion / Logseq optimized), OpenAI JSON, Standard JSON, and Raw JSON.
 */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ChatFormatter = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Intelligently shift Markdown heading levels (e.g. # -> ###, ## -> ####)
     * while protecting code fences (``` or ~~~) from being modified.
     * @param {string} text - Raw Markdown content
     * @param {number} [shift=2] - Number of heading levels to shift down
     * @returns {string} - Heading-shifted Markdown
     */
    function adjustHeadingHierarchy(text, shift = 2) {
        if (!text || typeof text !== 'string') return text || '';
        const lines = text.split('\n');
        const out = [];
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
    function renderAttachments(atts) {
        if (!atts || !Array.isArray(atts) || !atts.length) return '';
        let block = '';
        for (const att of atts) {
            if (att.type === 'image') {
                const local = att.localName || `assets/image.jpg`;
                const alt = String(att.alt || att.name || '图片').replace(/[[\]]/g, '');
                const online = att.src || att.originalUrl || '';
                if (online && online.startsWith('http') && !online.includes('googleusercontent.com/immersive_entry_chip')) {
                    block += `[![${alt}](${local})](${online})\n\n`;
                } else {
                    block += `![${alt}](${local})\n\n`;
                }
            } else if (att.type === 'file') {
                const local = att.localName || `files/${att.name || 'attachment'}`;
                let name = att.title || att.name || '附件';
                if (/^(我已经完成了研究|我拟定了一个研究方案|I've completed your research|Here is a research plan)/i.test(name)) {
                    name = '📑 深度研究报告 (Deep Research Report)';
                }
                block += `- 📎 [${name}](${local})\n\n`;
            }
        }
        return block;
    }

    /**
     * Sanitize message body content from Google internal placeholder URLs
     */
    function cleanMessageBody(text) {
        if (!text || typeof text !== 'string') return '';
        return text.replace(/https?:\/\/googleusercontent\.com\/(immersive_entry_chip|deep_research_confirmation_content)\/\d+/gi, '').trim();
    }

    /**
     * Intelligently detect and encapsulate unfenced raw code in user messages.
     */
    function sanitizeUserPrompt(text) {
        if (!text || typeof text !== 'string') return '';
        let cleaned = cleanMessageBody(text);
        if (!cleaned) return '';

        // If message has raw userscript or ultra-long code without markdown code fence
        if (!cleaned.includes('```') && (cleaned.includes('// ==UserScript==') || cleaned.length > 400)) {
            const lines = cleaned.split('\n');
            let outLines = [];
            let inFence = false;
            for (let line of lines) {
                let s = line.trim();
                if (s.startsWith('// ==UserScript==') && !inFence) {
                    outLines.push('```javascript');
                    outLines.push(line);
                    inFence = true;
                } else if (s.length > 400 && !inFence && (s.includes('function(') || s.includes('var ') || s.includes('const ') || s.includes('\\x'))) {
                    outLines.push('```javascript');
                    outLines.push(line);
                    outLines.push('```');
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
     * @param {Object} chat - Conversation data object
     * @param {Object} [opts] - Formatter options
     * @returns {string} - Formatted Markdown string
     */
    function toMarkdown(chat, opts = {}) {
        if (!chat) return '';
        if (chat.error) {
            return `# ${chat.title || 'Untitled'}\n\n> 导出失败: ${chat.error}\n\n> ID: ${chat.id} | URL: ${chat.url || ''}\n`;
        }

        const safeTitleClean = String(chat.title || 'Untitled').replace(/[\r\n]+/g, ' ').trim();
        const safeYamlTitle = safeTitleClean.replace(/"/g, '\\"');
        const createdIso = chat.createdAt ? new Date(chat.createdAt).toISOString() : '';
        const updatedIso = (chat.timestamp || chat.updatedAt) ? new Date(chat.timestamp || chat.updatedAt).toISOString() : createdIso;
        const convUrl = chat.url || (chat.id ? `https://gemini.google.com/app/${String(chat.id).replace(/^c_/, '')}` : '');

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
        const metaBadges = [];
        if (convUrl) metaBadges.push(`[🔗 对话链接](${convUrl})`);
        if (chat.id) metaBadges.push(`🆔 \`${chat.id}\``);
        if (createdIso) metaBadges.push(`📅 ${new Date(chat.createdAt).toLocaleString()}`);
        if (chat.attachmentCount) metaBadges.push(`📎 附件 ${chat.attachmentCount} 个`);
        if (metaBadges.length > 0) {
            md += `> ${metaBadges.join(' · ')}\n\n---\n\n`;
        }

        const messages = chat.messages || [];
        if (!messages.length) {
            md += `_空对话或取回失败_ 原始URL: ${convUrl}\n`;
            return md;
        }

        // 3. Conversation Messages
        for (const m of messages) {
            const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleString() : '';
            const role = m.role === 'user' ? 'user' : 'model';

            if (role === 'user') {
                md += `## 👤 你\n\n`;
                if (timeStr) md += `> ⏱️ ${timeStr}\n\n`;

                if (m.attachments && m.attachments.length) {
                    md += renderAttachments(m.attachments);
                }

                const userBody = sanitizeUserPrompt(m.content);
                if (userBody) {
                    md += `${userBody}\n\n`;
                }
            } else {
                md += `## 🤖 Gemini\n\n`;
                if (timeStr) md += `> ⏱️ ${timeStr}\n\n`;

                // Thinking Process (Isolated with double blank lines for strict Markdown parsers)
                const thoughts = (m.thoughts || m.thinking || '').trim();
                if (thoughts) {
                    md += `<details>\n<summary>🧠 思考过程</summary>\n\n${thoughts}\n\n</details>\n\n`;
                }

                // AI Answer Content with Heading Hierarchy Protection and Chip Sanitization
                const modelBody = cleanMessageBody(m.content);
                if (modelBody) {
                    const adjusted = adjustHeadingHierarchy(modelBody, 2);
                    md += `${adjusted}\n\n`;
                }

                if (m.attachments && m.attachments.length) {
                    md += renderAttachments(m.attachments);
                }

                // Citations / Sources
                if (m.citations && m.citations.length) {
                    md += `> 🌐 **参考来源：**\n`;
                    m.citations.forEach((c, idx) => {
                        const citeTitle = c.title || c.url || `来源 ${idx + 1}`;
                        md += `> [${idx + 1}] [${citeTitle}](${c.url})\n`;
                    });
                    md += `\n`;
                }

                md += `---\n\n`;
            }
        }

        return md;
    }

    /**
     * Convert conversation to OpenAI API Compatible JSON format.
     */
    function toOpenAIJson(chat) {
        const messages = (chat.messages || []).map(m => {
            const role = m.role === 'model' ? 'assistant' : 'user';
            const text = m.content || '';
            const imgs = (m.attachments || []).filter(a => a.type === 'image');
            const item = {};

            if (imgs.length > 0) {
                const contentArr = [];
                if (text) contentArr.push({ type: 'text', text });
                for (const im of imgs) {
                    contentArr.push({
                        type: 'image_url',
                        image_url: {
                            url: im.localName || im.src || im.originalUrl
                        }
                    });
                }
                item.role = role;
                item.content = contentArr;
            } else {
                item.role = role;
                item.content = text;
            }

            const thoughts = (m.thoughts || m.thinking || '').trim();
            if (thoughts) {
                item.reasoning_content = thoughts;
            }

            return item;
        });

        const convUrl = chat.url || (chat.id ? `https://gemini.google.com/app/${String(chat.id).replace(/^c_/, '')}` : '');
        return JSON.stringify({
            id: chat.id,
            title: chat.title,
            url: convUrl,
            created_at: chat.createdAt ? new Date(chat.createdAt).toISOString() : void 0,
            messages: messages
        }, null, 2);
    }

    /**
     * Unified content formatter entry point.
     * @param {Object} chat - Conversation object
     * @param {string} formatType - 'markdown' | 'json_openai' | 'json' | 'json_raw'
     * @returns {{ content: string, ext: string, mime: string }}
     */
    function formatContent(chat, formatType = 'markdown') {
        if (formatType === 'json_openai') {
            return {
                content: toOpenAIJson(chat),
                ext: 'json',
                mime: 'application/json'
            };
        }
        if (formatType === 'json_raw') {
            return {
                content: JSON.stringify(chat._raw || chat, null, 2),
                ext: 'json',
                mime: 'application/json'
            };
        }
        if (formatType === 'json') {
            return {
                content: JSON.stringify(chat, null, 2),
                ext: 'json',
                mime: 'application/json'
            };
        }
        return {
            content: toMarkdown(chat),
            ext: 'md',
            mime: 'text/markdown'
        };
    }

    return {
        adjustHeadingHierarchy,
        renderAttachments,
        toMarkdown,
        toOpenAIJson,
        formatContent
    };
}));
