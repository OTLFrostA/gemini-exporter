import { unescapeHtml } from "../../../../shared/utils/titleText.js";

function stripHtmlTags(str: string): string {
    let prev = '';
    let current = str;
    do {
        prev = current;
        current = current.replace(/<[^>]+>/g, '');
    } while (current !== prev);
    return current;
}

export function convertHtmlToMarkdown(html?: string | null): string {
    if (!html || typeof html !== 'string') return html || '';
    if (!/<(?:pre|code|p|h[1-6]|ul|ol|li|blockquote|strong|b|em|i|table)[\s>]/i.test(html)) return html;

    let res = html;
    const __codeSpans: string[] = [];
    const __stashCode = (code: string): string => {
        __codeSpans.push(code);
        return `\uFFFDCODE${__codeSpans.length - 1}\uFFFD`;
    };
    const __restoreCode = (str: string): string =>
        str.replace(/\uFFFDCODE(\d+)\uFFFD/g, (_m: string, i: string) => __codeSpans[Number(i)]);
    // Existing fenced Markdown is authored code, even when it contains HTML-like tags.
    // Recognize both CommonMark fence styles before interpreting real HTML tags.
    const lines = res.match(/[^\n]*(?:\n|$)/g) ?? [];
    let outside = '';
    let pending = '';
    let opened: { marker: string; length: number } | null = null;
    for (const line of lines) {
        if (!line) continue;
        const content = line.replace(/\r?\n$/, '');
        if (opened) {
            pending += line;
            const closing = /^ {0,3}(`+|~+)[ \t]*$/.exec(content);
            if (closing && closing[1][0] === opened.marker && closing[1].length >= opened.length) {
                outside += __stashCode(pending);
                pending = '';
                opened = null;
            }
        } else {
            const opening = /^ {0,3}(`{3,}|~{3,})[^\r\n]*$/.exec(content);
            if (opening) {
                opened = { marker: opening[1][0], length: opening[1].length };
                pending = line;
            } else outside += line;
        }
    }
    res = outside + (pending ? __stashCode(pending) : '');

    const backticks = (content: string, min: number): string => {
        const longest = (content.match(/`+/g) ?? []).reduce((count, run) => Math.max(count, run.length), 0);
        return '`'.repeat(Math.max(min, longest + 1));
    };
    res = res.replace(/<pre><code(?:\s+class=["'](?:language-)?([a-z0-9_-]+)["'])?>([\s\S]*?)<\/code><\/pre>/gi, (_match: string, lang: string | undefined, code: string) => {
        const cleanCode = unescapeHtml(code).trim();
        const fence = backticks(cleanCode, 3);
        return __stashCode(`\n${fence}${lang || ''}\n${cleanCode}\n${fence}\n`);
    });
    res = res.replace(/<code>([\s\S]*?)<\/code>/gi, (_match: string, code: string) => {
        const content = unescapeHtml(code);
        const fence = backticks(content, 1);
        const pad = /^`|`$|^ .* $/.test(content) ? ' ' : '';
        return __stashCode(`${fence}${pad}${content}${pad}${fence}`);
    });
    res = res.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m: string, lvl: string, txt: string) => `\n${'#'.repeat(parseInt(lvl, 10))} ${txt.trim()}\n`);
    res = res.replace(/<(strong|b)(?=[\s/>])[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
    res = res.replace(/<(em|i)(?=[\s/>])[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
    res = res.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_match: string, tableContent: string) => {
        const rows: string[] = [];
        const trMatches = tableContent.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
        let isFirstRow = true;
        let colCount = 0;

        for (const trMatch of trMatches) {
            const trContent = trMatch[1];
            const cells: string[] = [];
            const cellMatches = trContent.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/gi);
            for (const cMatch of cellMatches) {
                let cell = cMatch[1];
                cell = cell.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1<br>');
                cell = cell.replace(/<br\s*\/?>/gi, '__TABLE_BR__');
                cell = stripHtmlTags(cell);
                cell = unescapeHtml(cell);
                cell = cell.replace(/\r?\n/g, ' ').trim();
                cell = cell.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
                cells.push(cell);
            }
            if (cells.length === 0) continue;
            if (isFirstRow) {
                colCount = cells.length;
                rows.push('| ' + cells.join(' | ') + ' |');
                rows.push('| ' + new Array(colCount).fill('---').join(' | ') + ' |');
                isFirstRow = false;
            } else {
                while (cells.length < colCount) cells.push('');
                rows.push('| ' + cells.slice(0, colCount).join(' | ') + ' |');
            }
        }
        return rows.length > 0 ? '\n\n' + rows.join('\n') + '\n\n' : '';
    });
    res = res.replace(/<br\s*\/?>/gi, '\n');
    res = res.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
    res = stripHtmlTags(res);
    res = __restoreCode(res);
    res = res.replace(/__TABLE_BR__/g, '<br>');
    return res;
}
