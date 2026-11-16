#!/usr/bin/env node
/**
 * Structure- and Dual-Coordinate-Preserving Gemini RPC Wire Sanitizer.
 *
 * Supports two deterministic sanitization modes:
 * - `tokens_and_urls`: Strips signed Google media/storage tokens, query secrets,
 *   and email addresses inside multi-frame `batchexecute` responses while
 *   preserving public benchmark prose, media host allowlists, and filenames.
 * - `full`: Additionally replaces natural-language prose, titles, and quotes
 *   using a keyed deterministic bijection over Unicode scalar classes that
 *   strictly preserves BOTH UTF-16 code-unit length AND UTF-8 byte width at
 *   every code point, while keeping Markdown/LaTeX/HTML delimiters and Gemini
 *   protocol control tokens (`wrb.fr`, `hNvQHb`, `MaZiqc`, `THOUGHT`, `rc_`,
 *   `c_`, `r_`, `spp_`, `[cite: ...]`, MIME types) intact.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type WireSanitizeMode = 'tokens_and_urls' | 'full';

export interface SanitizeWireOptions {
    readonly mode?: WireSanitizeMode;
    readonly salt?: string;
}

const PROTOCOL_EXACT_TOKENS = new Set([
    'wrb.fr', 'di', 'af.httprm', 'e',
    'hNvQHb', 'MaZiqc', 'otAQ7b', 'ESY5D', 'aPya6c', 'PCck7e',
    'THOUGHT', '[cite_start]', 'google', 'en', 'zh', 'zh-CN', 'US',
    'step', 'merge', 'turn-left', 'turn-right', 'straight',
]);

const MARKDOWN_SYNTAX_CHARS = new Set([
    ' ', '\t', '\n', '\r',
    '`', '*', '_', '~', '$', '#', '>', '-', '+', '|',
    '[', ']', '(', ')', '{', '}', '<', '>', '\\', '/',
    ':', ';', ',', '.', '!', '?', '"', "'", '=', '&', '%', '^', '@',
    '，', '。', '！', '？', '：', '；', '（', '）', '【', '】', '《', '》', '“', '”', '‘', '’', '、', '—', '·',
]);

function digestHex(salt: string, input: string): string {
    return crypto.createHash('sha256').update(salt).update('\0').update(input).digest('hex');
}

function isOpaqueMediaToken(value: string): boolean {
    // Opaque encrypted media tokens in Gemini RPC (e.g. ~280-char base64-like `$...` or `A...` tokens without whitespace)
    return value.length >= 96 && !/\s/.test(value) && !value.includes('://') && /^[A-Za-z0-9+/=_$-]+$/.test(value);
}

function sanitizeFilenamePreservingExt(value: string, salt: string, mode: WireSanitizeMode): string | null {
    if (/^watermarked_img_\d+\.(?:jpe?g|png|webp|gif|avif)$/i.test(value)) {
        const ext = value.slice(value.lastIndexOf('.'));
        const digits = digestHex(salt, value).replace(/[a-f]/g, ch => String(ch.charCodeAt(0) - 97));
        return `watermarked_img_${digits.slice(0, 19)}${ext}`;
    }
    if (mode === 'full' && /^[\w.-]+\.[A-Za-z0-9]{1,8}$/.test(value) && !value.includes('..')) {
        const dot = value.lastIndexOf('.');
        const stem = value.slice(0, dot);
        const ext = value.slice(dot);
        let maskedStem = '';
        for (const symbol of stem) {
            maskedStem += String.fromCodePoint(mapScalarPreservingWidths(symbol.codePointAt(0)!, salt, 0));
        }
        return maskedStem + ext;
    }
    return null;
}

function isProtocolControlString(value: string): boolean {
    if (!value) return true;
    if (PROTOCOL_EXACT_TOKENS.has(value)) return true;
    if (/^(?:image|text|application|audio|video)\/[\w.+-]+$/i.test(value)) return true;
    if (/^\s*\[cite:\s*[\d.,\s-]*\]\s*$/i.test(value)) return true;
    if (/^(?:spp_|sp_|cit_)[\w-]+$/.test(value) || value === '0') return true;
    if (/^tC[\w-]+$/.test(value)) return true;
    return false;
}

function sanitizeSignedUrl(rawUrl: string, salt: string): string {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return rawUrl;
    }
    const host = parsed.hostname.toLowerCase();
    const hash = digestHex(salt, rawUrl).slice(0, 16);

    if (host === 'googleusercontent.com' || rawUrl.includes('immersive_entry_chip')) {
        return rawUrl;
    }

    if (host.endsWith('.googleusercontent.com')) {
        const extMatch = /\.(png|jpe?g|webp|gif|avif)$/i.exec(parsed.pathname);
        const ext = extMatch ? extMatch[0] : '';
        return `${parsed.protocol}//${parsed.host}/rd-sanitized/${hash}${ext}`;
    }

    if (host.endsWith('.usercontent.google.com')) {
        const filename = parsed.searchParams.get('filename') || parsed.searchParams.get('file_name') || parsed.searchParams.get('name');
        const params = new URLSearchParams({ c: `bard_storage_sanitized_${hash}` });
        if (filename) params.set('filename', filename);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}?${params.toString()}`;
    }

    if (host === 'drive.google.com') {
        if (parsed.pathname.includes('/viewer/thumb')) {
            return `https://drive.google.com/viewer/thumb?ds=sanitized_${hash}&w=400`;
        }
        return `https://drive.google.com/file/d/sanitized_${hash}/view`;
    }

    if (host.endsWith('.gstatic.com')) {
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}?q=tbn:sanitized_${hash}`;
    }

    if (host === 'gemini.google.com') {
        return rawUrl;
    }

    return `${parsed.protocol}//${parsed.host}/sanitized-${hash}`;
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>)\]]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redactUrlsAndEmailsInText(value: string, salt: string, preserveLength: boolean): string {
    let out = value;
    if (!preserveLength) {
        out = out.replace(URL_IN_TEXT_RE, match => sanitizeSignedUrl(match, salt));
        out = out.replace(EMAIL_RE, match => `user-${digestHex(salt, match).slice(0, 8)}@example.com`);
        return out;
    }
    out = out.replace(EMAIL_RE, match => {
        const atIdx = match.indexOf('@');
        const dotIdx = match.lastIndexOf('.');
        if (atIdx <= 0 || dotIdx <= atIdx + 1) return match;
        const h = digestHex(salt, match);
        const local = h.slice(0, atIdx).padEnd(atIdx, 'x');
        const domainLen = dotIdx - atIdx - 1;
        const domain = h.slice(atIdx, atIdx + domainLen).padEnd(domainLen, 'd');
        const tldLen = match.length - dotIdx - 1;
        const tld = 'c'.repeat(tldLen);
        return `${local}@${domain}.${tld}`;
    });
    return out;
}

/** Map a single Unicode code point to a deterministic synthetic code point with the
 * EXACT SAME UTF-8 byte length (1, 2, 3, or 4 bytes) and UTF-16 code-unit length (1 or 2). */
function mapScalarPreservingWidths(cp: number, salt: string, positionSalt: number): number {
    const ch = String.fromCodePoint(cp);
    if (MARKDOWN_SYNTAX_CHARS.has(ch)) return cp;

    const h = crypto.createHash('sha256')
        .update(salt)
        .update(Buffer.from([
            (cp >>> 24) & 0xff, (cp >>> 16) & 0xff, (cp >>> 8) & 0xff, cp & 0xff,
            positionSalt & 0xff,
        ]))
        .digest();
    const n = h.readUInt32BE(0);

    // 1-byte UTF-8 (0x00..0x7F), 1 UTF-16 unit
    if (cp <= 0x7f) {
        if (cp >= 0x61 && cp <= 0x7a) return 0x61 + (n % 26); // a-z
        if (cp >= 0x41 && cp <= 0x5a) return 0x41 + (n % 26); // A-Z
        if (cp >= 0x30 && cp <= 0x39) return 0x30 + (n % 10); // 0-9
        return cp;
    }
    // 2-byte UTF-8 (0x80..0x7FF), 1 UTF-16 unit -> Latin Extended-A (0x0100..0x017E)
    if (cp <= 0x7ff) {
        return 0x0100 + (n % 0x7e);
    }
    // 3-byte UTF-8 (0x800..0xFFFF), 1 UTF-16 unit -> Common CJK Unified Ideographs (0x4E00..0x9FA5)
    if (cp <= 0xffff) {
        return 0x4e00 + (n % (0x9fa5 - 0x4e00));
    }
    // 4-byte UTF-8 (0x10000..0x10FFFF), 2 UTF-16 surrogate units -> Emoticons block (0x1F600..0x1F64F)
    return 0x1f600 + (n % 0x4f);
}

/** Context-free per-codepoint bijection: identical substrings at any position
 * map to identical substrings with identical UTF-8 and UTF-16 lengths. */
export function maskTextPreservingDualCoordinates(text: string, salt: string): string {
    if (!text) return text;
    if (/^https?:\/\/\S+$/i.test(text)) {
        return sanitizeSignedUrl(text, salt);
    }
    // Preserve XML tags in map route instructions (`<step><direction>...</direction></step>`),
    // Gemini interaction tags, and internal googleusercontent chip placeholders while masking inner text.
    const tagProtected = /^(<[A-Za-z][^>]*>|<\/[A-Za-z][^>]*>)$/;
    const chipProtected = /^https?:\/\/googleusercontent\.com\/[^\s)\]]+$/i;
    const segments = text.split(/(<\/?[A-Za-z][^>]*>|\s*\[cite:\s*[\d.,\s-]*\]\s*|https?:\/\/googleusercontent\.com\/[^\s)\]]+)/gi);
    let out = '';
    for (const seg of segments) {
        if (!seg) continue;
        if (tagProtected.test(seg) || chipProtected.test(seg) || /^\s*\[cite:\s*[\d.,\s-]*\]\s*$/i.test(seg)) {
            out += seg;
            continue;
        }
        let masked = '';
        for (const symbol of seg) {
            const cp = symbol.codePointAt(0)!;
            masked += String.fromCodePoint(mapScalarPreservingWidths(cp, salt, 0));
        }
        out += masked;
    }
    return out;
}

function sanitizePrefixedId(value: string, prefix: 'c_' | 'r_' | 'rc_', salt: string, mode: WireSanitizeMode): string {
    if (mode !== 'full') return value;
    const rest = value.slice(prefix.length);
    if (!rest) return value;
    const hashed = digestHex(salt, value).slice(0, Math.max(8, rest.length));
    return prefix + hashed.slice(0, rest.length);
}

function sanitizeJsonNode(node: unknown, salt: string, mode: WireSanitizeMode): unknown {
    if (node === null || node === undefined || typeof node !== 'object') {
        if (typeof node !== 'string') return node;
        if (isProtocolControlString(node)) return node;
        if (isOpaqueMediaToken(node)) {
            return `tok_sanitized_${digestHex(salt, node).slice(0, 24)}`;
        }
        const sanitizedFile = sanitizeFilenamePreservingExt(node, salt, mode);
        if (sanitizedFile !== null) return sanitizedFile;
        for (const prefix of ['rc_', 'c_', 'r_'] as const) {
            if (node.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(node.slice(prefix.length))) {
                // Distinguish rc_-prefixed prose (`rc_xxx Hello`) from bare IDs
                return sanitizePrefixedId(node, prefix, salt, mode);
            }
        }
        if (/^https?:\/\/\S+$/i.test(node)) {
            return sanitizeSignedUrl(node, salt);
        }
        if (mode === 'full') {
            const emailMasked = redactUrlsAndEmailsInText(node, salt, true);
            return maskTextPreservingDualCoordinates(emailMasked, salt);
        }
        return redactUrlsAndEmailsInText(node, salt, false);
    }

    if (Array.isArray(node)) {
        // Detect wrb.fr envelope frame: ["wrb.fr", rpcId, innerJsonString, ...]
        if (node[0] === 'wrb.fr' && typeof node[1] === 'string' && typeof node[2] === 'string') {
            const next = [...node];
            try {
                const parsedInner: unknown = JSON.parse(node[2]);
                next[2] = JSON.stringify(sanitizeJsonNode(parsedInner, salt, mode));
            } catch {
                next[2] = sanitizeJsonNode(node[2], salt, mode);
            }
            for (let i = 3; i < next.length; i++) {
                next[i] = sanitizeJsonNode(next[i], salt, mode);
            }
            return next;
        }
        return node.map(child => sanitizeJsonNode(child, salt, mode));
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(node)) {
        out[key] = sanitizeJsonNode(val, salt, mode);
    }
    return out;
}

/** Sanitize a raw Gemini `batchexecute` HTTP response body (including `)]}'` prefix
 * and length-prefixed multi-chunk frames) while keeping envelope framing valid. */
export function sanitizeGeminiBatchexecuteWire(rawText: string, options: SanitizeWireOptions = {}): string {
    const mode = options.mode ?? 'tokens_and_urls';
    const salt = options.salt ?? 'gemini-exporter-p0-corpus-v1';

    const hasXssiPrefix = rawText.trimStart().startsWith(")]}'");
    let body = rawText.trimStart();
    if (hasXssiPrefix) {
        body = body.slice(4).replace(/^\r?\n+/, '');
    }

    // Parse length-delimited batchexecute chunks (`<len>\n<json>\n...`) or direct JSON array.
    const lines = body.split(/\r?\n/);
    const sanitizedChunks: string[] = [];
    let i = 0;
    let usedChunkLengths = false;

    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
            i++;
            continue;
        }
        if (/^\d+$/.test(line) && i + 1 < lines.length) {
            usedChunkLengths = true;
            const jsonLine = lines[i + 1];
            try {
                const parsed: unknown = JSON.parse(jsonLine);
                const sanitized = JSON.stringify(sanitizeJsonNode(parsed, salt, mode));
                // Google batchexecute chunk headers count UTF-16 code units + trailing newline
                sanitizedChunks.push(`${sanitized.length}\n${sanitized}`);
                i += 2;
                continue;
            } catch {
                // Fall through if multiline chunk
            }
        }
        try {
            const rest = lines.slice(i).join('\n');
            const parsed: unknown = JSON.parse(rest);
            const sanitized = JSON.stringify(sanitizeJsonNode(parsed, salt, mode));
            sanitizedChunks.push(usedChunkLengths ? `${sanitized.length}\n${sanitized}` : sanitized);
            break;
        } catch {
            sanitizedChunks.push(lines[i]);
            i++;
        }
    }

    const prefix = hasXssiPrefix ? ")]}'\n\n" : '';
    return prefix + sanitizedChunks.join('\n') + (rawText.endsWith('\n') ? '\n' : '');
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const modeIdx = args.indexOf('--mode');
    const mode: WireSanitizeMode = modeIdx >= 0 && args[modeIdx + 1] === 'full' ? 'full' : 'tokens_and_urls';
    const saltIdx = args.indexOf('--salt');
    const salt = saltIdx >= 0 ? args[saltIdx + 1] : undefined;
    const positional = args.filter((arg, idx) =>
        !arg.startsWith('--') && idx !== modeIdx + 1 && idx !== saltIdx + 1);
    if (positional.length < 1) {
        console.error('Usage: node -r ./tests/ts_register.js scripts/sanitize_gemini_wire.ts <input.json|raw.txt> [output] [--mode tokens_and_urls|full] [--salt <str>]');
        process.exit(2);
    }
    const inputPath = path.resolve(positional[0]);
    const raw = fs.readFileSync(inputPath, 'utf8');
    let output: string;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.pages)) {
            parsed.pages = parsed.pages.map((p: { text?: string }) => ({
                ...p,
                ...(typeof p.text === 'string' ? { text: sanitizeGeminiBatchexecuteWire(p.text, { mode, salt }) } : {}),
            }));
            output = JSON.stringify(parsed, null, 2) + '\n';
        } else {
            output = sanitizeGeminiBatchexecuteWire(raw, { mode, salt });
        }
    } catch {
        output = sanitizeGeminiBatchexecuteWire(raw, { mode, salt });
    }
    if (positional[1]) {
        fs.mkdirSync(path.dirname(path.resolve(positional[1])), { recursive: true });
        fs.writeFileSync(path.resolve(positional[1]), output, 'utf8');
    } else {
        process.stdout.write(output);
    }
}
