/**
 * src/core/export/typst/sandboxProtocol.ts
 *
 * postMessage wire protocol between the extension host (TypstSandboxCompiler)
 * and the MV3 sandbox compile page (src/ui/sandbox/typst-compile.html).
 *
 * The Typst WASM compiler must run in a sandbox page: typst.ts's
 * wasm-bindgen glue calls `new Function(...)` at init time, which MV3
 * extension_pages CSP never allows. The sandbox page declares
 * `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'` instead.
 *
 * Security rules (both directions):
 * - every message is a plain object with a string `type` and a `jobId`
 *   (except the one-shot `typst/ready` broadcast, which carries no jobId);
 * - the host only accepts messages whose `event.source` is the exact iframe
 *   contentWindow it created AND whose `event.origin` is the sandbox's opaque
 *   origin ('null'). The source-identity check is the real gate; the origin
 *   check is defense in depth.
 * - the sandbox only accepts messages whose `event.source` is
 *   `window.parent` AND whose `event.origin` equals the extension origin
 *   derived from its own location.href (chrome-extension://<id>).
 * - anything failing validation is silently ignored, never acted on.
 *
 * Pure module: no DOM, no chrome APIs. Safe to import in unit tests.
 */

/** Host -> sandbox message types. */
export const HOST_TO_SANDBOX = {
    INIT: 'typst/init',
    COMPILE: 'typst/compile',
    CANCEL: 'typst/cancel',
} as const;

/** Sandbox -> host message types. */
export const SANDBOX_TO_HOST = {
    READY: 'typst/ready',
    INITED: 'typst/inited',
    PROGRESS: 'typst/progress',
    /**
     * Sent right after the font builder finishes installing fonts, before
     * the document compile runs. Lets the host mark fonts as installed
     * independently of whether the later compile succeeds or fails, so a
     * failed compile never triggers a font resend (re-running the font
     * builder wedges the WASM module -- P0 finding).
     */
    FONTS_INSTALLED: 'typst/fonts-installed',
    COMPILED: 'typst/compiled',
    ERROR: 'typst/error',
} as const;

export const HOST_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(HOST_TO_SANDBOX));
export const SANDBOX_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.values(SANDBOX_TO_HOST));

/**
 * Sandboxed pages run with an opaque origin, so messages arriving from the
 * sandbox always carry origin 'null'. Identity is established by matching
 * event.source against the known iframe contentWindow.
 */
export const SANDBOX_OPAQUE_ORIGIN = 'null';

/** Extension-relative URL of the sandbox page, as listed in manifest.json. */
export const SANDBOX_PAGE_PATH = 'src/ui/sandbox/typst-compile.html';

/** Extension-relative URL of the vendored, P0-verified Typst compiler WASM. */
export const TYPST_WASM_PATH = 'src/ui/sandbox/vendor/typst_ts_web_compiler_bg.wasm';

/** Extension-relative URLs of the minimal bundled fonts (math fallback). */
export const BUNDLED_FONT_PATHS: readonly string[] = [
    'src/ui/sandbox/fonts/NewCMMath-Regular.otf',
];

export interface ParsedProtocolMessage {
    type: string;
    /** Null only for the `typst/ready` broadcast. */
    jobId: string | null;
    body: Record<string, unknown>;
}

export type ParseResult =
    | { ok: true; message: ParsedProtocolMessage }
    | { ok: false; reason: string };

/**
 * Validate the shape of an inbound postMessage payload.
 * Returns ok:false with a reason for anything malformed; callers must drop
 * such messages without acting on them.
 */
export function parseProtocolMessage(data: unknown, allowedTypes: ReadonlySet<string>): ParseResult {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return { ok: false, reason: 'message is not a plain object' };
    }
    const record = data as Record<string, unknown>;
    if (typeof record.type !== 'string' || record.type.length === 0) {
        return { ok: false, reason: 'message has no string type' };
    }
    if (!allowedTypes.has(record.type)) {
        return { ok: false, reason: `unknown message type: ${record.type}` };
    }
    if (record.type === SANDBOX_TO_HOST.READY) {
        if (record.jobId !== undefined && record.jobId !== null) {
            return { ok: false, reason: 'ready broadcast must not carry a jobId' };
        }
        return { ok: true, message: { type: record.type, jobId: null, body: record } };
    }
    if (typeof record.jobId !== 'string' || record.jobId.length === 0) {
        return { ok: false, reason: 'message has no string jobId' };
    }
    return { ok: true, message: { type: record.type, jobId: record.jobId, body: record } };
}

export interface MessageEventLike {
    source: unknown;
    origin: string;
}

/**
 * Origin + source gate for an inbound message event.
 * Both must match; there is no fallback.
 */
export function checkMessageSource(
    event: MessageEventLike,
    expectedSource: unknown,
    expectedOrigin: string,
): boolean {
    return event.source === expectedSource && event.origin === expectedOrigin;
}

/**
 * The extension origin the sandbox page expects its parent to have,
 * derived from the sandbox page's own URL without any chrome.* API
 * (unavailable in sandboxed pages): e.g. 'chrome-extension://<id>'.
 *
 * Note: WHATWG URL leaves non-special schemes like chrome-extension: with
 * an opaque origin ('null'), but browsers expose them as tuple origins, so
 * url.origin is correct in the real sandbox page. The manual fallback keeps
 * this helper (and its unit test) correct under Node's stricter URL
 * implementation too.
 */
export function sandboxExpectedHostOrigin(sandboxHref: string): string {
    const url = new URL(sandboxHref);
    if (url.origin !== 'null') return url.origin;
    return `${url.protocol}//${url.host}`;
}

/** Fresh job ids: unguessable, safe to expose across the boundary. */
export function newJobId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `job-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}
