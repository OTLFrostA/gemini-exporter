// src/ui/print/print.ts - Print page controller: renders a conversation into a
// print-friendly DOM and triggers window.print() so the user can save it as PDF.
// Data flow: query (?conv=&slot= / ?fixture=) -> fetchChat (same chain as
// popup "export current page") -> per-message markdown -> marked -> DOMPurify
// -> chunked DOM insert -> image settle -> fonts ready -> window.print().

import { sendTypedMessage } from '../../core/utils/messaging.js';
import { ChatFormatter } from '../../core/engine/chatFormatter.js';
import { cleanTitle } from '../../core/utils/utils.js';
import { $, getI18n } from '../uiCommon.js';
import { __resolveModule } from '../../core/utils/moduleOverrides.js';
import { StorageService } from '../../core/storage/storageService.js';
import type { Conversation, ChatMessage, Attachment } from '../../types/conversation.js';

// Vendored classic-script globals (same pattern as zipWriter.ts self.JSZip).
declare const Marked: any;
declare const DOMPurify: any;

const getStorage = () => __resolveModule('StorageService', StorageService);

const FETCH_CHAT_TIMEOUT_MS = 40000; // popup.ts:212
const FONTS_READY_TIMEOUT_MS = 5000;
const IMAGE_SINGLE_TIMEOUT_MS = 10000;
const IMAGE_TOTAL_TIMEOUT_MS = 30000;
const CHUNK_MESSAGES = 50; // 50 轮/批（报告 §1.3 沿用；见 print-page-spec §2.3）
const LONG_CONVERSATION_CONFIRM = 1000; // >1000 轮先弹确认框（验收 P-03）
const PAGE_CONTENT_PX = 900; // 一页内容区高度近似值（A4 297mm - 上下边距 42mm），用于 .code-long 检测

type PrintState = 'loading' | 'rendering' | 'ready' | 'error' | 'empty' | 'done' | 'cancelled';

let __booted = false; // 整页生命周期只允许一次 boot（pitfalls ⑩）
let __printRequested = false; // 防 DOMContentLoaded/pageshow 重复调 print
let __blobRevokeFns: Array<() => void> = [];

const t = (key: string, ...args: any[]): string => {
    const i18n = getI18n();
    if (i18n && typeof i18n.t === 'function') return i18n.t(key, ...args);
    return key;
};

function setPrintState(state: PrintState, statusText?: string): void {
    const statusEl = $('printStatus');
    if (statusEl && typeof statusText !== 'undefined') statusEl.textContent = statusText;
    const errEl = $('printError');
    if (errEl) errEl.hidden = state !== 'error';
    document.body.dataset.printState = state;
}

function showError(message: string): void {
    setPrintState('error');
    const errEl = $('printError');
    const msgEl = $('printErrorMsg');
    if (errEl) errEl.hidden = false;
    if (msgEl) msgEl.textContent = message;
}

function escCssString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/** 文件名安全清洗（pitfalls ⑧）：cleanTitle + Windows 非法字符/保留名处理。
 * 验收 P-01/§4.4：默认文件名必须与对话标题逐字一致 → 不加任何后缀。 */
function safePrintTitle(raw: string, convId: string): string {
    let title = cleanTitle(raw || '');
    title = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/[. ]+$/g, '');
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(title)) title = '_' + title;
    if (!title) title = `Gemini-${convId.slice(0, 8)}`;
    title = [...title].slice(0, 120).join('');
    return title;
}

/** 校验 query 参数（pitfalls ⑨）：不信任 popup 传参 */
function parsePrintQuery(): { conv: string | null; slot: string; fixture: string | null } {
    const qs = new URLSearchParams(location.search);
    const fixtureRaw = qs.get('fixture');
    const fixture = fixtureRaw && /^[a-z0-9-]+$/.test(fixtureRaw) ? fixtureRaw : null;
    const convRaw = qs.get('conv');
    const conv = convRaw && /^(?:c_)?[A-Za-z0-9_-]{8,}$/.test(convRaw) ? convRaw : null;
    const slotRaw = qs.get('slot');
    const slot = slotRaw && /^u\d+$/.test(slotRaw) ? slotRaw : 'u0';
    return { conv, slot, fixture };
}

/** 扩展内路径解析：chrome.runtime 不可用时（如纯 http 烟测）降级为相对 URL */
function extUrl(path: string): string {
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
            return chrome.runtime.getURL(path);
        }
    } catch { /* fall through to relative resolution */ }
    return new URL(path, location.href).toString();
}

async function loadConversation(conv: string | null, slot: string, fixture: string | null): Promise<Conversation> {
    if (fixture) {
        const url = extUrl(`src/ui/print/fixtures/${fixture}.json`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`fixture 不存在: ${fixture}`);
        return (await res.json()) as Conversation;
    }
    if (!conv) throw new Error(t('printLoadFailed', t('printNoConvId')));
    const res: any = await sendTypedMessage(
        { action: 'fetchChat', conversationId: conv, accountSlot: slot },
        FETCH_CHAT_TIMEOUT_MS
    );
    if (!res || !res.success) throw new Error(t('printLoadFailed', res?.error || 'unknown'));
    return res.data as Conversation;
}

async function fallbackTitleFromStorage(slot: string, convId: string): Promise<string | null> {
    try {
        const storage = getStorage();
        if (!storage || typeof storage.getConversations !== 'function') return null;
        const list = await storage.getConversations(slot);
        const found = (list || []).find((c: any) => c.id === convId || c.id === `c_${convId}`);
        return (found && found.title) ? String(found.title) : null;
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:print]', e);
        return null;
    }
}

const PRINT_SANITIZER_CONFIG = {
    ALLOWED_TAGS: ['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'code',
        'blockquote', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'a', 'img',
        'strong', 'em', 'b', 'i', 'u', 's', 'del', 'hr', 'div', 'span', 'section',
        'figure', 'figcaption', 'sub', 'sup', 'kbd', 'details', 'summary'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'class', 'lang', 'start'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['svg', 'math', 'form', 'input', 'button', 'select', 'textarea', 'script', 'style',
        'iframe', 'object', 'embed', 'video', 'audio'],
    FORBID_ATTR: ['style'],
};

function renderMarkdownToSafeHtml(md: string): string {
    const MarkedLib = (globalThis as any).Marked;
    const Purify = (globalThis as any).DOMPurify;
    if (!MarkedLib || typeof MarkedLib.parse !== 'function') {
        throw new Error('Marked library is not available');
    }
    if (!Purify || typeof Purify.sanitize !== 'function') {
        throw new Error('DOMPurify library is not available');
    }
    const rawHtml = MarkedLib.parse(md || '');
    return String(Purify.sanitize(rawHtml, PRINT_SANITIZER_CONFIG));
}

/** v1 公式降级：文本节点中的 $…$ / $$…$$ 包一层 .tex-inline（TeX 源码展示，不丢信息） */
function highlightTexSource(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node: Node) => {
            const parent = (node as Text).parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (tag === 'PRE' || tag === 'CODE' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA') {
                return NodeFilter.FILTER_REJECT;
            }
            return /\$/.test((node as Text).data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });
    const targets: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) targets.push(n as Text);
    const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    for (const textNode of targets) {
        const data = textNode.data;
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        let last = 0;
        const frag = document.createDocumentFragment();
        let hit = false;
        while ((m = re.exec(data))) {
            hit = true;
            if (m.index > last) frag.appendChild(document.createTextNode(data.slice(last, m.index)));
            const span = document.createElement('span');
            span.className = 'tex-inline';
            span.textContent = m[0];
            frag.appendChild(span);
            last = m.index + m[0].length;
        }
        if (hit) {
            if (last < data.length) frag.appendChild(document.createTextNode(data.slice(last)));
            textNode.parentNode?.replaceChild(frag, textNode);
        }
    }
}

function pickImageUrl(att: Attachment): string | null {
    const anyAtt = att as any;
    // 本地数据优先：dataBuffer / blobBase64 / dataBase64（pitfalls ⑫）
    if (typeof anyAtt.dataBuffer !== 'undefined' && anyAtt.dataBuffer) {
        try {
            const blob = new Blob([anyAtt.dataBuffer as any], { type: anyAtt.mimeType || anyAtt.mime || 'image/png' });
            const url = URL.createObjectURL(blob);
            __blobRevokeFns.push(() => URL.revokeObjectURL(url));
            return url;
        } catch { /* fall through to remote */ }
    }
    for (const b64 of [anyAtt.blobBase64, anyAtt.dataBase64]) {
        if (typeof b64 === 'string' && b64.length > 0) {
            const mime = anyAtt.mimeType || anyAtt.mime || 'image/png';
            return `data:${mime};base64,${b64}`;
        }
    }
    for (const key of ['resolvedUrl', 'src', 'url', 'sourceUrl']) {
        const v = anyAtt[key];
        // https 直链与 data:image 内联图都可直接作为 <img> 源（data: 不走 remoteUrl 二次 fetch）
        if (typeof v === 'string' && /^(https:|data:image\/)/i.test(v)) return v;
    }
    return null;
}

function isImageAttachment(att: Attachment): boolean {
    const anyAtt = att as any;
    if (anyAtt.isImage === true) return true;
    const type = String(anyAtt.type || '').toLowerCase();
    if (type === 'image') return true;
    const mime = String(anyAtt.mimeType || anyAtt.mime || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const name = String(anyAtt.fileName || anyAtt.localName || anyAtt.name || '');
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
}

function buildMessageElement(msg: ChatMessage): HTMLElement {
    const isUser = msg.role === 'user';
    const wrap = document.createElement('div');
    wrap.className = `msg ${isUser ? 'msg-user' : 'msg-assistant'}`;

    const roleEl = document.createElement('div');
    roleEl.className = 'msg-role';
    roleEl.textContent = isUser ? t('printRoleUser') : t('printRoleAssistant');
    wrap.appendChild(roleEl);

    // thoughts 单独卡片（与正文回答视觉隔离）
    const thoughts = msg.thoughts;
    const thoughtText = Array.isArray(thoughts) ? thoughts.join('\n\n') : thoughts;
    if (typeof thoughtText === 'string' && thoughtText.trim()) {
        const th = document.createElement('div');
        th.className = 'thoughts';
        const thRole = document.createElement('div');
        thRole.className = 'msg-role';
        thRole.textContent = t('printRoleThinking');
        th.appendChild(thRole);
        const thBody = document.createElement('div');
        thBody.textContent = thoughtText;
        thBody.style.whiteSpace = 'pre-wrap';
        th.appendChild(thBody);
        wrap.appendChild(th);
    }

    const body = document.createElement('div');
    body.className = 'msg-body';
    try {
        // content 是混装 HTML 富文本串（无独立 html 字段）：先转 markdown 再渲染
        const md = ChatFormatter.cleanMessageBody(msg.content || '');
        body.innerHTML = renderMarkdownToSafeHtml(md);
    } catch (e) {
        // 清洗失败 → 降级纯文本，不阻断整页（pitfalls ⑪）
        if (typeof console !== 'undefined' && console.warn) console.warn('[GemExporter:print] sanitize failed, fallback to text', e);
        body.textContent = msg.content || '';
    }
    highlightTexSource(body);
    wrap.appendChild(body);

    // 图片/附件：在线 URL 优先（pitfalls ⑫）；images[] 与 attachments[] 按归一化 URL 去重
    const seen = new Set<string>();
    const atts: Attachment[] = [...(msg.images || []), ...(msg.attachments || [])];
    for (const att of atts) {
        if (isImageAttachment(att)) {
            const url = pickImageUrl(att);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            const fig = document.createElement('figure');
            const img = document.createElement('img');
            img.src = url;
            img.alt = String((att as any).fileName || (att as any).name || (att as any).title || '');
            img.dataset.remoteUrl = /^https:/i.test(url) ? url : '';
            img.loading = 'eager';
            fig.appendChild(img);
            const capText = img.alt;
            if (capText) {
                const cap = document.createElement('figcaption');
                cap.textContent = capText;
                fig.appendChild(cap);
            }
            wrap.appendChild(fig);
        } else {
            const url = pickImageUrl(att);
            if (!url || seen.has(url)) continue;
            seen.add(url);
            const p = document.createElement('p');
            const a = document.createElement('a');
            a.href = url;
            a.textContent = `📎 ${String((att as any).fileName || (att as any).name || url)}`;
            a.rel = 'noopener';
            p.appendChild(a);
            wrap.appendChild(p);
        }
    }

    if (typeof msg.timestamp === 'number' && Number.isFinite(msg.timestamp)) {
        const timeEl = document.createElement('div');
        timeEl.className = 'msg-time';
        try {
            timeEl.textContent = new Date(msg.timestamp).toLocaleString();
        } catch { /* ignore */ }
        wrap.appendChild(timeEl);
    }
    return wrap;
}

function waitForImgLoad(img: HTMLImageElement, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) { resolve(true); return; }
        if (img.complete) { resolve(false); return; }
        let done = false;
        const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onError);
            resolve(ok);
        };
        const onLoad = () => finish(img.naturalWidth > 0);
        const onError = () => finish(false);
        const timer = setTimeout(() => finish(img.complete && img.naturalWidth > 0), timeoutMs);
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
    });
}

function replaceWithImagePlaceholder(img: HTMLImageElement): void {
    const span = document.createElement('span');
    span.className = 'img-broken';
    const alt = img.alt ? `：${img.alt}` : '';
    span.textContent = `[${t('printImageFailed')}${alt}]`;
    img.replaceWith(span);
}

/**
 * 图片 settle（pitfalls ②）：先 <img> 直引；onerror/超时 → fetch→blob；
 * 仍失败 → 占位符，绝不阻断打印。
 */
async function settleImage(img: HTMLImageElement): Promise<void> {
    const remoteUrl = img.dataset.remoteUrl || '';
    // data:/blob: 本地 URL 无需二次处理
    if (!remoteUrl) {
        const ok = await waitForImgLoad(img, IMAGE_SINGLE_TIMEOUT_MS);
        if (!ok) replaceWithImagePlaceholder(img);
        return;
    }
    let ok = await waitForImgLoad(img, IMAGE_SINGLE_TIMEOUT_MS);
    if (ok) {
        try { await img.decode(); } catch { /* decode 失败不阻断 */ }
        return;
    }
    // 直引失败 → fetch→blob（需 host_permissions 覆盖该域）
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_SINGLE_TIMEOUT_MS);
    try {
        const response = await fetch(remoteUrl, { credentials: 'include', signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error(`unexpected content type: ${blob.type}`);
        const blobUrl = URL.createObjectURL(blob);
        __blobRevokeFns.push(() => URL.revokeObjectURL(blobUrl));
        img.src = blobUrl;
        ok = await waitForImgLoad(img, IMAGE_SINGLE_TIMEOUT_MS);
        if (!ok) throw new Error('blob image failed to load');
        try { await img.decode(); } catch { /* ignore */ }
    } catch (e) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[GemExporter:print] image failed', remoteUrl, e);
        replaceWithImagePlaceholder(img);
    } finally {
        clearTimeout(timer);
    }
}

async function settleAllImages(root: HTMLElement): Promise<void> {
    const imgs = Array.from(root.querySelectorAll('img')) as HTMLImageElement[];
    if (imgs.length === 0) return;
    const all = Promise.allSettled(imgs.map((img) => settleImage(img)));
    const totalTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), IMAGE_TOTAL_TIMEOUT_MS));
    await Promise.race([all, totalTimeout]); // 总量 30s 上限，超时降级继续
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
    return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]) as Promise<T | null>;
}

/** JS 钩子：超高代码块 → .code-long；超宽表格 → .table-compact（print.css §4/§5） */
function applyPrintHooks(root: HTMLElement): void {
    for (const pre of Array.from(root.querySelectorAll('pre'))) {
        try {
            if ((pre as HTMLElement).scrollHeight > PAGE_CONTENT_PX) pre.classList.add('code-long');
        } catch { /* ignore */ }
    }
    for (const table of Array.from(root.querySelectorAll('table'))) {
        try {
            const el = table as HTMLElement;
            if (el.scrollWidth > el.clientWidth + 1) table.classList.add('table-compact');
        } catch { /* ignore */ }
    }
}

/** 动态页眉页脚注入：标题（40 字截断）+ 导出日期；纯 CSS 无法注入动态数据 */
function injectHeaderFooterStyle(title: string): void {
    const old = document.getElementById('printHeaderStyle');
    if (old) old.remove();
    const dateStr = new Date().toISOString().slice(0, 10);
    const shortTitle = [...title].slice(0, 40).join('');
    const style = document.createElement('style');
    style.id = 'printHeaderStyle';
    style.textContent =
        `@page { ` +
        `@top-left { content: "${escCssString(shortTitle)}"; font-size: 9pt; color: #555; } ` +
        `@top-right { content: "${escCssString(dateStr)}"; font-size: 9pt; color: #555; } ` +
        `@bottom-center { content: "Gemini Exporter"; font-size: 8pt; color: #888; } ` +
        `@bottom-right { content: "第 " counter(page) " 页 / 共 " counter(pages) " 页"; font-size: 9pt; color: #555; } ` +
        `}`;
    document.head.appendChild(style);
}

function requestAutoPrint(): void {
    if (__printRequested) return;
    __printRequested = true;
    let beforePrintSeen = false;
    const onBeforePrint = () => { beforePrintSeen = true; };
    window.addEventListener('beforeprint', onBeforePrint, { once: true });
    try {
        window.print();
    } catch (e) {
        if (typeof console !== 'undefined' && console.warn) console.warn('[GemExporter:print] auto print threw', e);
        showManualBanner();
        return;
    }
    // 2s 内没观测到 beforeprint → 认为自动打印被抑制，显示醒目手动横幅（pitfalls ⑬）
    setTimeout(() => {
        window.removeEventListener('beforeprint', onBeforePrint);
        if (!beforePrintSeen) showManualBanner();
    }, 2000);
}

function showManualBanner(): void {
    const banner = $('manualBanner');
    if (banner) banner.hidden = false;
}

/** best-effort 导出记录：绝不写 status（afterprint 无法区分确认/取消，写 ok 即失败标成功） */
async function writePdfExportRecord(slot: string, convId: string, title: string, messageCount: number): Promise<void> {
    try {
        const storage = getStorage();
        if (!storage || typeof storage.saveExportRecord !== 'function') return;
        await storage.saveExportRecord(slot, convId, {
            exportedAt: Date.now(),
            title,
            messageCount,
            format: 'pdf',
        });
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) console.debug('[GemExporter:print] record write failed', e);
    }
}

function bindStaticButtons(): void {
    const manual = (): void => {
        __printRequested = false; // 手动打印允许再次触发
        requestAutoPrint();
    };
    $('btnManualPrint')?.addEventListener('click', manual);
    $('btnManualPrint2')?.addEventListener('click', manual);
    $('btnRetry')?.addEventListener('click', () => location.reload());
    window.addEventListener('afterprint', () => {
        // 中性提示：对话框关闭 ≠ 已保存（pitfalls ④）
        setPrintState('done', t('printDialogClosed'));
        for (const fn of __blobRevokeFns) {
            try { fn(); } catch { /* ignore */ }
        }
        __blobRevokeFns = [];
    });
}

async function insertInChunks(container: HTMLElement, elements: HTMLElement[]): Promise<void> {
    const total = elements.length;
    for (let i = 0; i < total; i += CHUNK_MESSAGES) {
        const batch = elements.slice(i, i + CHUNK_MESSAGES);
        const frag = document.createDocumentFragment();
        for (const el of batch) frag.appendChild(el);
        container.appendChild(frag);
        setPrintState('rendering', t('printRendering', Math.min(i + CHUNK_MESSAGES, total), total));
        // setTimeout(0) 分片：headless 下 rAF 可能不触发（pitfalls ⑤）
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}

async function boot(): Promise<void> {
    if (__booted) return;
    __booted = true;

    // i18n：照抄 popup.ts:316-319 四行模式
    const i18n = getI18n();
    if (typeof i18n !== 'undefined') {
        await i18n.initLanguage().then(() => { i18n.applyI18n(); }).catch(() => { /* ignore */ });
    }
    bindStaticButtons();
    setPrintState('loading', t('printLoading'));

    const { conv, slot, fixture } = parsePrintQuery();

    let chat: Conversation;
    try {
        chat = await loadConversation(conv, slot, fixture);
    } catch (e: any) {
        showError(e?.message || String(e));
        return;
    }

    const messages: ChatMessage[] = Array.isArray(chat.messages) ? chat.messages : [];
    if (messages.length === 0) {
        setPrintState('empty', t('printEmpty'));
        return;
    }

    // 超长对话确认（验收 P-03）
    if (messages.length > LONG_CONVERSATION_CONFIRM) {
        const go = window.confirm(t('printTooLong', messages.length));
        if (!go) {
            setPrintState('cancelled', t('printCancelled'));
            return;
        }
    }

    const convId = chat.id || conv || fixture || 'unknown';
    const storedTitle = await fallbackTitleFromStorage(slot, convId);
    const title = safePrintTitle(chat.title || storedTitle || convId, convId);
    document.title = title;
    injectHeaderFooterStyle(title);

    // 逐消息渲染（天然分片；失败单条降级为纯文本，不阻断整页）
    const container = $('printContent') as HTMLElement | null;
    if (!container) {
        showError(t('printLoadFailed', 'missing #printContent'));
        return;
    }
    const elements = messages.map((msg) => buildMessageElement(msg));
    await insertInChunks(container, elements);

    applyPrintHooks(container);
    await settleAllImages(container);
    const fontsReady: Promise<void> = (typeof document !== 'undefined' && document.fonts)
        ? document.fonts.ready.then(() => undefined)
        : Promise.resolve();
    await withTimeout(fontsReady, FONTS_READY_TIMEOUT_MS);

    setPrintState('ready', t('printReady'));
    requestAnimationFrame(() => requestAutoPrint());

    // 导出记录：afterprint 时写（best-effort，无 status 字段）
    window.addEventListener('afterprint', () => {
        void writePdfExportRecord(slot, convId, title, messages.length);
    }, { once: true });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void boot(); });
    } else {
        void boot();
    }
    // pageshow 重复触发不重复 boot（pitfalls ⑩ 由 __booted 保证）
}
