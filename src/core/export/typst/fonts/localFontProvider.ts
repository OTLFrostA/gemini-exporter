/**
 * src/core/export/typst/fonts/localFontProvider.ts
 * Local-first font provider (Phase D item 3).
 *
 * P0 decision: CJK fonts are NOT bundled with the extension (package delta
 * budget is 30 MiB; measured WASM + glue + NewCMMath compressed is ~11.1 MiB).
 * This module resolves fonts from the user's own OS via the browser
 * Local Font Access API (`window.queryLocalFonts()`). The sandbox compiler
 * (P1b) mounts the resolved bytes via `mapShadow`; this module is the
 * provider side only and defines the interface P2 wiring will consume.
 *
 * Contract rules:
 *  - Every failure mode (API missing, permission denied, font missing) is
 *    reported as a diagnostic with an explicit fallback chain. Never silently
 *    substitute a font: an unnoticed swap changes pagination.
 *  - `queryLocalFontsProvider()` never throws; it returns a discriminated
 *    union with a machine-readable `reason`.
 *  - Matching is a pure function (`rankLocalFontCandidates`) so Tier 1 can
 *    unit-test it with a mocked `queryLocalFonts`.
 *
 * UNVALIDATED (real-device UX red lines -- Tier 1 does NOT cover these;
 * do not claim they pass):
 *  - Local Font Access permission prompt behavior on real devices
 *  - user denies the permission
 *  - user dismisses the prompt without answering
 *  - requested CJK font not installed on the device
 *  - font set changing mid-export
 *  - math font MATH table validation (P1b sandbox duty at font-load time)
 *  - browser / OS differences in API availability and FontData field fidelity
 */

/** Structural shape of one FontData entry from `queryLocalFonts()`. */
export interface LocalFontEntry {
    readonly family: string;
    readonly fullName: string;
    readonly postscriptName: string;
    readonly style: string;
    blob(): Promise<Blob>;
}

/** One font resolved for the sandbox compiler. Freeze-conscious: fields are readonly. */
export interface ResolvedLocalFont {
    readonly family: string;
    readonly postscriptName: string;
    readonly style: string;
    readonly source: 'local';
    /** Lazily reads the font bytes (FontData.blob() -> ArrayBuffer). */
    getBytes(): Promise<Uint8Array>;
}

export interface FontProviderDiagnostic {
    severity: 'info' | 'warning' | 'error';
    code: string;
    message: string;
}

export interface LocalFontResolution {
    /** Resolved fonts in fallback priority order (index 0 = first choice). */
    readonly fonts: readonly ResolvedLocalFont[];
    /** Every miss / denial / substitution, so pagination drift is always visible. */
    readonly diagnostics: readonly FontProviderDiagnostic[];
    /** Human-readable effective fallback chain, e.g. for the export log. */
    readonly fallbackChain: readonly string[];
    /** False when the sandbox must compile with bundled fonts only. */
    readonly localFontsAvailable: boolean;
}

export interface LocalFontRequest {
    /** Requested CJK families in priority order. Defaults to CJK_FONT_STACK. */
    cjk?: readonly string[];
    /** Requested Latin fallback families in priority order. Defaults to LATIN_FONT_STACK. */
    latin?: readonly string[];
    /** Max fonts to return overall. Default 8. */
    limit?: number;
}

/** Default CJK request stack (highest priority first). Common cross-OS coverage. */
export const CJK_FONT_STACK: readonly string[] = [
    'Noto Sans CJK SC',
    'Noto Sans CJK',
    'PingFang SC',
    'PingFang TC',
    'PingFang HK',
    'Microsoft YaHei',
    'Microsoft JhengHei',
    'Source Han Sans SC',
    'Noto Sans SC',
    'SimSun',
    'SimHei',
    'Meiryo',
    'Hiragino Sans GB',
];

/** Default Latin fallback stack (highest priority first). Mirrors theme.typ font-ui. */
export const LATIN_FONT_STACK: readonly string[] = [
    'SF Pro Text',
    'SF Pro Display',
    'Helvetica Neue',
    'Helvetica',
    'Arial',
    'Inter',
    'Noto Sans',
    'DejaVu Sans',
];

/** Math font pinned by P1a (NewCMMath bundled by P1b; Noto Sans Math local fallback). */
export const MATH_FONT_STACK: readonly string[] = [
    'NewCMMath',
    'Noto Sans Math',
];

// ---------------------------------------------------------------------------
// Pure matching (Tier 1 testable, no window / no DOM access)
// ---------------------------------------------------------------------------

/** One matched candidate: the FontData entry plus which requested family it serves. */
export interface LocalFontCandidate {
    readonly family: string;
    readonly postscriptName: string;
    readonly style: string;
    /** Index into the `requested` array that produced this candidate. */
    readonly requestedIndex: number;
    readonly requestedFamily: string;
    /** Internal handle; the public surface is ResolvedLocalFont.getBytes(). */
    readonly entry: LocalFontEntry;
}

function normalizeFontName(name: string): string {
    return name.toLowerCase().replace(/[\s\-_]/g, '');
}

/** Style priority for body text: Regular < Italic < Bold < Bold Italic < other. */
function styleRank(style: string): number {
    const s = style.toLowerCase();
    const bold = s.includes('bold') || s.includes('black') || s.includes('heavy');
    const italic = s.includes('italic') || s.includes('oblique');
    if (!bold && !italic) return 0;
    if (!bold && italic) return 1;
    if (bold && !italic) return 2;
    if (bold && italic) return 3;
    return 4;
}

function entryMatchesRequest(entry: LocalFontEntry, requested: string): boolean {
    const want = normalizeFontName(requested);
    if (normalizeFontName(entry.family) === want) return true;
    // Heuristic: postscript name is typically family (no spaces) + "-" + style,
    // e.g. "NotoSansCJKsc-Regular" for family "Noto Sans CJK SC".
    const ps = normalizeFontName(entry.postscriptName);
    return ps === want || ps.startsWith(want);
}

/**
 * Match available FontData entries against the requested families.
 *
 * Pure function: no `window`, no async, no side effects. Each entry is used at
 * most once, claimed by the first requested family (in priority order) it
 * matches. Candidates are sorted by (requested order, style rank,
 * postscriptName) so index 0 is the best choice.
 */
export function rankLocalFontCandidates(
    entries: readonly LocalFontEntry[],
    requested: readonly string[],
): LocalFontCandidate[] {
    const used = new Set<number>();
    const out: LocalFontCandidate[] = [];
    requested.forEach((family, requestedIndex) => {
        const matched: Array<{ entry: LocalFontEntry; index: number }> = [];
        entries.forEach((entry, index) => {
            if (!used.has(index) && entryMatchesRequest(entry, family)) {
                matched.push({ entry, index });
            }
        });
        matched.sort(
            (a, b) =>
                styleRank(a.entry.style) - styleRank(b.entry.style) ||
                (a.entry.postscriptName < b.entry.postscriptName ? -1 : a.entry.postscriptName > b.entry.postscriptName ? 1 : 0),
        );
        for (const { entry, index } of matched) {
            used.add(index);
            out.push({
                family: entry.family,
                postscriptName: entry.postscriptName,
                style: entry.style,
                requestedIndex,
                requestedFamily: family,
                entry,
            });
        }
    });
    return out;
}

/**
 * Best candidate for one requested family: Regular-style first (pagination is
 * computed against body text), then style-rank order. Candidates for a fixed
 * family are already sorted by styleRank by rankLocalFontCandidates.
 */
export function bestCandidateForFamily(
    candidates: readonly LocalFontCandidate[],
    requestedFamily: string,
): LocalFontCandidate | undefined {
    return candidates.find((c) => c.requestedFamily === requestedFamily);
}

// ---------------------------------------------------------------------------
// Provider wrapper: window.queryLocalFonts(), never throws
// ---------------------------------------------------------------------------

export type LocalFontQueryReason = 'api-unavailable' | 'permission-denied' | 'query-failed';

export type LocalFontQueryResult =
    | { ok: true; fonts: LocalFontEntry[] }
    | { ok: false; reason: LocalFontQueryReason; detail: string };

type QueryLocalFontsFn = () => Promise<LocalFontEntry[]>;

function getQueryLocalFontsFn(): QueryLocalFontsFn | undefined {
    const g = globalThis as unknown as {
        window?: { queryLocalFonts?: unknown };
        queryLocalFonts?: unknown;
    };
    const fn = g.window?.queryLocalFonts ?? g.queryLocalFonts;
    return typeof fn === 'function' ? (fn as QueryLocalFontsFn) : undefined;
}

function classifyQueryError(err: unknown): { reason: LocalFontQueryReason; detail: string } {
    const name = (err as { name?: string } | null)?.name ?? '';
    const message = err instanceof Error ? err.message : String(err);
    // Best-effort: a rejected queryLocalFonts() surfaces as NotAllowedError when
    // the user denies or dismisses the permission prompt. The exact prompt UX
    // is UNVALIDATED (see module header).
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return { reason: 'permission-denied', detail: `Local Font Access denied/blocked (${name}): ${message}` };
    }
    return { reason: 'query-failed', detail: `queryLocalFonts() failed (${name || 'unknown'}): ${message}` };
}

/**
 * Query the browser's installed fonts. Never throws: the API being absent or
 * the user denying access is a normal, reportable outcome, not an exception.
 */
export async function queryLocalFontsProvider(): Promise<LocalFontQueryResult> {
    const fn = getQueryLocalFontsFn();
    if (!fn) {
        return {
            ok: false,
            reason: 'api-unavailable',
            detail: 'window.queryLocalFonts is not defined in this browser (Local Font Access API unsupported or insecure context).',
        };
    }
    try {
        const fonts = await fn();
        return { ok: true, fonts: Array.isArray(fonts) ? fonts : [] };
    } catch (err) {
        const { reason, detail } = classifyQueryError(err);
        return { ok: false, reason, detail };
    }
}

// ---------------------------------------------------------------------------
// Resolution: query -> match -> diagnostics + explicit fallback chain
// ---------------------------------------------------------------------------

const BUNDLED_MATH_FALLBACK = 'NewCMMath (bundled, math only)';
const SYSTEM_FALLBACK = 'Typst system default (last resort)';

function toResolved(entry: LocalFontEntry): ResolvedLocalFont {
    const { family, postscriptName, style } = entry;
    return {
        family,
        postscriptName,
        style,
        source: 'local' as const,
        async getBytes(): Promise<Uint8Array> {
            const buf = await (await entry.blob()).arrayBuffer();
            return new Uint8Array(buf);
        },
    };
}

/**
 * Resolve local fonts for the requested CJK + Latin stacks.
 *
 * Freeze-conscious signature: options object, readonly return. v1 contract;
 * extend additively (new optional fields) rather than changing fields.
 *
 * Every font that could NOT be resolved gets a diagnostic naming exactly what
 * was wanted and what will be used instead -- silent substitution is what
 * causes unnoticed pagination drift, so it is forbidden here.
 */
export async function resolveLocalFonts(request: LocalFontRequest = {}): Promise<LocalFontResolution> {
    const cjk = request.cjk ?? CJK_FONT_STACK;
    const latin = request.latin ?? LATIN_FONT_STACK;
    const limit = request.limit ?? 8;

    const query = await queryLocalFontsProvider();
    if (!query.ok) {
        const code =
            query.reason === 'api-unavailable'
                ? 'TYPST_LOCAL_FONTS_UNAVAILABLE'
                : query.reason === 'permission-denied'
                  ? 'TYPST_LOCAL_FONTS_DENIED'
                  : 'TYPST_LOCAL_FONTS_QUERY_FAILED';
        const severity = query.reason === 'permission-denied' ? 'warning' : 'error';
        return {
            fonts: [],
            diagnostics: [
                {
                    severity,
                    code,
                    message:
                        `${query.detail} No local fonts will be mounted; the sandbox must compile ` +
                        `with bundled fonts only (${BUNDLED_MATH_FALLBACK}). Pagination may differ from ` +
                        `a device with local CJK fonts -- this is a known, reported degradation, not a silent swap.`,
                },
            ],
            fallbackChain: [BUNDLED_MATH_FALLBACK, SYSTEM_FALLBACK],
            localFontsAvailable: false,
        };
    }

    const diagnostics: FontProviderDiagnostic[] = [];
    const fonts: ResolvedLocalFont[] = [];

    const resolveStack = (stack: readonly string[], label: string): void => {
        const candidates = rankLocalFontCandidates(query.fonts, stack);
        for (const family of stack) {
            const best = bestCandidateForFamily(candidates, family);
            if (!best) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_LOCAL_FONTS_MISSING',
                    message: `Requested ${label} font "${family}" not found among installed local fonts; it will not be mounted.`,
                });
                continue;
            }
            if (styleRank(best.style) !== 0) {
                diagnostics.push({
                    severity: 'warning',
                    code: 'TYPST_LOCAL_FONTS_STYLE_FALLBACK',
                    message: `Requested ${label} font "${family}" resolved to non-Regular style "${best.style}" (${best.postscriptName}); pagination is computed against this style, not a silent Regular.`,
                });
            }
            fonts.push(toResolved(best.entry));
        }
    };

    resolveStack(cjk, 'CJK');
    resolveStack(latin, 'Latin');

    const limited = fonts.slice(0, Math.max(0, limit));
    if (limited.length < fonts.length) {
        diagnostics.push({
            severity: 'info',
            code: 'TYPST_LOCAL_FONTS_TRUNCATED',
            message: `Resolved ${fonts.length} local fonts but limit=${limit} keeps the first ${limited.length} in priority order.`,
        });
    }

    const chain = [
        ...limited.map((f) => `${f.family} (local, ${f.postscriptName})`),
        BUNDLED_MATH_FALLBACK,
        SYSTEM_FALLBACK,
    ];

    diagnostics.unshift({
        severity: 'info',
        code: 'TYPST_LOCAL_FONTS_RESOLVED',
        message: `Resolved ${limited.length} local fonts. Effective fallback chain: ${chain.join(' -> ')}.`,
    });

    return {
        fonts: limited,
        diagnostics,
        fallbackChain: chain,
        localFontsAvailable: true,
    };
}
