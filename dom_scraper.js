// dom_scraper.js - DOM fallback parser and conversation list scroller
(function(root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DomScraper = factory();
    }
}(typeof self !== 'undefined' ? self : this, function() {
    'use strict';

    function cleanText(t) {
        return t ? t.replace(/\u00a0/g, ' ').replace(/\r/g, '').trim().slice(0, 20000) : '';
    }

    function cleanTitle(raw) {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.cleanTitle) return GeminiUtils.cleanTitle(raw);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.cleanTitle) return globalThis.GeminiUtils.cleanTitle(raw);
            if (typeof require !== 'undefined') {
                const u = require('./utils.js');
                if (u && u.cleanTitle) return u.cleanTitle(raw);
            }
        } catch {}
        if (!raw || typeof raw !== 'string') return '';
        let t = raw.replace(/\u00a0/g, ' ').replace(/[\r\n\t]+/g, ' ').trim();
        t = t.replace(/\s*[-–—|·•]\s*(Google\s+)?(Gemini|Bard|Google\s+AI).*$/i, '');
        t = t.replace(/^(Google\s+)?(Gemini|Bard|Google\s+AI)\s*[-–—|·•]\s*/i, '');
        return t.trim();
    }

    function isRealTitle(t, fallbackId) {
        try {
            if (typeof GeminiUtils !== 'undefined' && GeminiUtils.isRealTitle) return GeminiUtils.isRealTitle(t, fallbackId);
            if (typeof globalThis !== 'undefined' && globalThis.GeminiUtils && globalThis.GeminiUtils.isRealTitle) return globalThis.GeminiUtils.isRealTitle(t, fallbackId);
            if (typeof require !== 'undefined') {
                const u = require('./utils.js');
                if (u && u.isRealTitle) return u.isRealTitle(t, fallbackId);
            }
        } catch {}
        if (!t || typeof t !== 'string') return false;
        const s = t.trim();
        if (!s || s.length < 2 || s === 'Untitled' || s === '未命名' || s === 'New chat' || s === '新对话') return false;
        if (/^(Google\s+)?(Gemini|Bard|Google\s+AI|Google\s+Account)$/i.test(s)) return false;
        if (fallbackId && (s === fallbackId || s === 'c_' + fallbackId || fallbackId === 'c_' + s)) return false;
        if (/^[0-9a-f]{16}$/i.test(s) || /^c_[0-9a-f]{16}$/i.test(s) || /^[a-f0-9_-]{8,64}$/i.test(s)) return false;
        return true;
    }

    function parseDoc(doc, id, url) {
        let title = doc.title ? cleanTitle(doc.title) : '';
        if (!title || title === 'Gemini') {
            let h = doc.querySelector('title');
            if (h) title = cleanTitle(h.textContent.trim().slice(0, 60));
        }
        if (!title) title = id;
        const messages = [];
        let nodes = doc.querySelectorAll('user-query, model-response');
        // Fallback: 新版 Gemini 可能已移除自定义标签，尝试通用选择器并记录诊断
        let fallbackUsed = null;
        if (!nodes.length) {
            const fallbacks = [
                '[data-test-id*="user-query"]', '[data-test-id*="model-response"]',
                '[data-message-author-role="user"]', '[data-message-author-role="model"]',
                'div[data-test-id="conversation-turn"]',
                'div[role="article"]'
            ];
            for (const sel of fallbacks) {
                try {
                    const alt = doc.querySelectorAll(sel);
                    if (alt.length) { nodes = alt; fallbackUsed = sel; break; }
                } catch {}
            }
        }
        if (!nodes.length) {
            console.warn('[Gemini Exporter][DOM] parseDoc no nodes matched for', id, 'title', title, 'html_len', doc.documentElement?.outerHTML?.length, 'fallbackUsed', fallbackUsed);
        } else if (fallbackUsed) {
            console.log('[Gemini Exporter][DOM] parseDoc fallback matched', fallbackUsed, 'count', nodes.length);
        }
        const sorted = [...nodes].sort((a, b) => {
            const pos = a.compareDocumentPosition(b);
            return (pos & 4) ? -1 : 1;
        });
        for (const node of sorted) {
            const tagName = node.tagName.toLowerCase();
            // Determine role: native custom elements use tagName; fallback selectors expose
            // role via data-message-author-role or can be inferred from child structure.
            const roleAttr = (node.getAttribute && node.getAttribute('data-message-author-role')) || '';
            let isUser = tagName === 'user-query' || roleAttr === 'user';
            let isModel = tagName === 'model-response' || roleAttr === 'model';
            // For generic article / div containers from fallback selectors, try to infer
            // role from child elements (data-test-id hints are the most reliable signal).
            if (!isUser && !isModel && fallbackUsed) {
                if (node.querySelector('[data-test-id*="user-query"], .query-text-line, .query-text')) {
                    isUser = true;
                } else if (node.querySelector('[data-test-id*="model-response"], .markdown, message-content')) {
                    isModel = true;
                } else {
                    // Last resort: check nested data-message-author-role on child elements
                    const innerRole = node.querySelector('[data-message-author-role]');
                    if (innerRole) {
                        const r = innerRole.getAttribute('data-message-author-role');
                        if (r === 'user') isUser = true;
                        else if (r === 'model') isModel = true;
                    }
                }
            }
            // Skip unresolvable nodes when using fallback selectors
            if (!isUser && !isModel) continue;

            let text = '';
            if (isUser) {
                const q = node.querySelector('.query-text-line, .query-text, [data-test-id="query-text"], p');
                if (q) text = (q.textContent || '').trim();
                if (!text) text = (node.textContent || '').trim();
                if (text) messages.push({
                    role: 'user',
                    content: cleanText(text)
                });
            } else {
                const md = node.querySelector('.markdown, message-content, [data-test-id="model-response-content"]') || node;
                let t = '';
                const parts = md.querySelectorAll('p, li, pre, code, h1,h2,h3, blockquote');
                if (parts.length) {
                    for (const p of parts) {
                        let tt = (p.textContent || '').trim();
                        if (!tt) continue;
                        if (tt.length > 5000) tt = tt.slice(0, 5000);
                        let tag = p.tagName.toLowerCase();
                        if (tag === 'li') t += `- ${tt}\n`;
                        else if (tag === 'pre') t += `\n\`\`\`\n${tt}\n\`\`\`\n\n`;
                        else t += tt + '\n\n';
                    }
                } else {
                    t = (md.textContent || '').trim();
                }
                t = t.replace(/\n{3,}/g, '\n\n').trim();
                if (t && t.length > 3) messages.push({
                    role: 'model',
                    content: cleanText(t)
                });
            }
        }
        const dedup = [];
        for (let i = 0; i < messages.length; i++) {
            if (i > 0 && messages[i].content === messages[i - 1].content && messages[i].role === messages[i - 1].role) continue;
            dedup.push(messages[i]);
        }
        if (!title || title === id) {
            let fu = dedup.find(m => m.role === 'user');
            if (fu) title = fu.content.slice(0, 50).replace(/\n/g, ' ');
        }
        // 诊断：空结果时附带 html 预览
        let _debug = null;
        if (!dedup.length) {
            try {
                const htmlLen = doc.documentElement?.outerHTML?.length || 0;
                const bodySnippet = (doc.body?.innerText || '').slice(0, 400).replace(/\n+/g, ' ');
                _debug = { htmlLen, bodySnippet, nodesFound: nodes.length, fallbackUsed, titleSeen: title };
                if (typeof window !== 'undefined' && window.__gemExporterDevMode) {
                    console.warn('[Gemini Exporter][DOM] parseDoc empty dedup', id, _debug);
                }
            } catch {}
        }
        return {
            id,
            title: title.slice(0, 120) || id,
            url,
            timestamp: new Date().toISOString(),
            messages: dedup,
            messageCount: dedup.length,
            attachmentCount: 0,
            _debug
        };
    }

    async function contentFetchChatDetail(id) {
        const cleanId = String(id).replace(/^c_/, '').trim();
        const isDevMode = typeof window !== 'undefined' && window.__gemExporterDevMode;
        // 1. 若当前页即为目标对话，直接解析 live DOM（SPA 场景 fetch 拿到的只是空壳）
        try {
            if (location.pathname.includes(cleanId) || location.href.includes(cleanId)) {
                const liveParsed = parseDoc(document, id, location.href);
                if (liveParsed.messages.length) {
                    console.log('[Gemini Exporter][DOM] live parse success', id, liveParsed.messageCount);
                    return liveParsed;
                }
                if (isDevMode) console.warn('[Gemini Exporter][DOM] live parse empty, will try fetch', id, liveParsed._debug);
            }
        } catch (e) { if (isDevMode) console.warn('[DOM] live parse exception', e); }

        const url = `https://gemini.google.com/app/${id}`;
        let controller = null;
        let timeoutId = null;
        if (typeof AbortController !== 'undefined') {
            controller = new AbortController();
            timeoutId = setTimeout(() => {
                try { controller.abort(); } catch {}
            }, 15000);
        }
        let resp;
        try {
            resp = await fetch(url, {
                credentials: 'include',
                headers: { 'Accept': 'text/html' },
                signal: controller ? controller.signal : undefined
            });
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        const html = await resp.text();
        if (isDevMode && (!html || html.length < 200)) {
            console.warn('[Gemini Exporter][DOM] fetch html too short', id, html?.length, html?.slice(0,200));
        }
        // 检测 fetch 返回的是 JS 空壳而非 HTML 文档
        const isJsShell = html.trim().startsWith('(function') || (html.includes('chrome-context-v39') && !html.includes('user-query') && !html.includes('<html'));
        if (isDevMode && isJsShell) {
            console.warn('[Gemini Exporter][DOM] fetch returned JS shell not HTML', id, 'html_len', html.length);
        }
        // 若 fetch 的是 SPA 空壳（不含 user-query），尝试直接解析当前 document 作为兜底
        let doc = new DOMParser().parseFromString(html, 'text/html');
        let parsed = parseDoc(doc, id, url);
        if (!parsed.messages.length) {
            if (isDevMode) {
                console.warn('[Gemini Exporter][DOM] contentFetchChatDetail fetch parse empty', id, 'html_len', html.length, 'isJsShell', isJsShell, '_debug', parsed._debug);
            }
            try {
                if (location.pathname.includes(cleanId) || location.href.includes(cleanId)) {
                    const liveFallback = parseDoc(document, id, location.href);
                    if (liveFallback.messages.length) {
                        console.log('[Gemini Exporter][DOM] live fallback success after fetch empty', id);
                        return liveFallback;
                    }
                }
            } catch {}
        }
        return parsed;
    }

    function debugCurrentPage() {
        try {
            const doc = document;
            const info = {
                title: doc.title,
                url: location.href,
                userQuery: doc.querySelectorAll('user-query').length,
                modelResponse: doc.querySelectorAll('model-response').length,
                altSelectors: {},
                htmlLen: doc.documentElement.outerHTML.length,
                bodySnippet: (doc.body.innerText || '').slice(0, 600)
            };
            const alts = ['[data-test-id*="user-query"]','[data-test-id*="model-response"]','[data-message-author-role]','div[role="article"]'];
            alts.forEach(s => { try { info.altSelectors[s] = doc.querySelectorAll(s).length; } catch {} });
            console.log('[Gemini Exporter][DOM Debug]', info);
            return info;
        } catch (e) { console.warn('debugCurrentPage fail', e); return null; }
    }

    function getScrollContainer() {
        const sel = [
            'nav[aria-label*="chat" i]',
            'nav[aria-label*="history" i]',
            'side-navigation-v2',
            '.side-nav-history',
            '.conversation-container',
            'infinite-scroller',
            'cdk-virtual-scroll-viewport',
            'mat-sidenav',
            '.mat-drawer-inner-container',
            '.side-nav',
            'nav',
            'aside'
        ];
        for (let s of sel) {
            const el = document.querySelector(s);
            if (el) {
                if (el.scrollHeight > el.clientHeight && el.clientHeight > 100) return el;
                const scrollable = el.querySelector('[style*="overflow"], .overflow-y-auto, [class*="scroll"]');
                if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return scrollable;
            }
        }
        const all = document.querySelectorAll('*');
        for (let el of all) {
            if (el.clientHeight > 200 && el.scrollHeight > el.clientHeight + 100) {
                const style = window.getComputedStyle(el);
                if (style.overflowY === 'auto' || style.overflowY === 'scroll') return el;
            }
        }
        return null;
    }

    function getConversationLinks() {
        const sels = [
            'search-snippet a',
            'a.snippet-container',
            '.search-results-list a',
            'a[href*="/app/"]',
            '[data-test-id="conversation"] a',
            'bard-sidenav a[href*="/app/"]',
            'div[role="navigation"] a[href*="/app/"]'
        ];
        let nodes = [];
        for (const sel of sels) {
            try {
                document.querySelectorAll(sel).forEach(a => nodes.push(a));
            } catch {}
        }
        nodes = [...new Set(nodes)];
        if (!nodes.length) nodes = [...document.querySelectorAll('a[href*="/app/"]')];
        return nodes.map(a => {
            let href = a.getAttribute('href') || a.href || '';
            if (!href) return null;
            let m = href.match(/\/app\/(c_)?([A-Za-z0-9_-]{8,})/);
            if (!m) return null;
            let raw = m[2] || m[1];
            if (!raw || raw.length < 8) return null;
            if (/^(search|images|videos|app)$/i.test(raw)) return null;
            let id = raw.replace(/^c_/, '');

            let title = '';
            const titleEl = a.querySelector('.title') || a.querySelector('[class*="title"]') || a.closest('search-snippet')?.querySelector('.title');
            if (titleEl) {
                title = titleEl.textContent.trim();
            } else {
                title = (a.textContent || a.getAttribute('aria-label') || '').trim().split('\n')[0].trim();
            }
            title = title.replace(/\s{2,}/g, ' ').trim();
            if (!title || title.length < 2) {
                let pp = a.closest('[title]');
                if (pp) title = pp.getAttribute('title').trim();
            }
            const cleanT = cleanTitle(title || '未命名对话');
            const isReal = isRealTitle(cleanT, id);
            return {
                id,
                title: cleanT,
                titleSource: isReal ? 'dom' : 'default',
                titles: isReal ? { dom: cleanT } : {},
                url: `https://gemini.google.com/app/${id}`,
                href: `https://gemini.google.com/app/${id}`
            };
        }).filter(Boolean);
    }

    function tryExpandRecents() {
        try {
            const btn = document.querySelector('button[aria-label="Toggle Recents"]') || document.querySelector('[aria-label="Toggle Recents"]');
            if (btn && btn.getAttribute('aria-expanded') === 'false') btn.click();
        } catch {}
    }

    return {
        cleanText,
        parseDoc,
        contentFetchChatDetail,
        getScrollContainer,
        getConversationLinks,
        tryExpandRecents,
        debugCurrentPage
    };
}));
