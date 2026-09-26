/**
 * tests/canonical-html-parity.test.ts
 * F2c: content-consistency between the legacy 1:1 HTML exporter (toHtml) and
 * the new canonical-AST HTML renderer (renderCanonicalHtml).
 *
 * Method: same desensitized Conversation -> old path (toHtml) vs new path
 * (normalizeGeminiConversation -> renderCanonicalHtml). Visible text is
 * extracted per turn and compared as an order-preserving subsequence:
 * every text line the old renderer shows must appear in the new output in
 * the same order (tags/styles may differ; content must not).
 *
 * Known intentional supersets (asserted separately, not as parity failures):
 * - citations: the legacy template drops them; the AST renderer shows chips
 * - unknown content: legacy renders blank; the AST renderer shows a fallback
 */
export {};
const test = require('node:test');
const assert = require('node:assert');

const canonical = require('../src/core/export/canonical/index.js');
const { normalizeGeminiConversation, renderCanonicalHtml } = canonical;
const { toHtml } = require('../src/core/engine/template/htmlTemplate.js');

const chat: any = {
    id: 'parity_chat_001',
    title: 'Parity Test Conversation',
    url: 'https://gemini.google.com/app/parity_chat_001',
    messages: [
        {
            role: 'user',
            content: 'Please explain **binary search** in detail.\n\nI want:\n\n- a short *intuition* paragraph\n- `O(log n)` complexity analysis\n- edge cases list\n\n> Quote me the key invariant.\n\nThis prompt is deliberately long so that both renderers must apply the collapsible long-prompt treatment consistently. '.repeat(3),
            attachments: [
                { type: 'image', localName: 'assets/plan.png', name: 'plan.png', mimeType: 'image/png' },
                { type: 'file', localName: 'assets/notes.pdf', name: 'notes.pdf', title: 'notes.pdf' },
            ],
        },
        {
            role: 'model',
            thoughts: 'The user wants binary search explained. Keep it concise and correct.',
            content: '## Binary Search\n\nBinary search finds a target in a **sorted** array in `O(log n)` time.\n\n```python\ndef bsearch(a, x):\n    lo, hi = 0, len(a)\n    while lo < hi:\n        mid = (lo + hi) // 2\n        if a[mid] < x:\n            lo = mid + 1\n        else:\n            hi = mid\n    return lo\n```\n\n| Case | Complexity |\n|---|---|\n| Best | $O(1)$ |\n| Worst | $O(\\log n)$ |\n\nSee [1] for details.\n\nKey invariant: `a[lo..hi)` always contains the answer.',
            citations: [
                { title: 'Binary search reference', url: 'https://example.com/bsearch' },
            ],
        },
        {
            // Unknown content shape: legacy renders blank, AST renderer must stay visible.
            role: 'model',
            content: { opaque: 'provider-blob', n: 42 },
        },
        {
            role: 'model',
            content: 'Attachment without bytes.',
            attachments: [
                { type: 'file', name: 'ghost.pdf' },
            ],
        },
    ],
};

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/** Split the document into its top-level turn sections (depth-aware). */
function splitTurns(html: string): string[] {
    const turns = [];
    const re = /<section class="gem-turn[^>]*>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        let depth = 1;
        let i = m.index + m[0].length;
        while (depth > 0) {
            const open = html.indexOf('<section', i);
            const close = html.indexOf('</section>', i);
            if (close === -1) break;
            if (open !== -1 && open < close) { depth++; i = open + 8; }
            else { depth--; i = close + 10; }
        }
        turns.push(html.slice(m.index, i));
    }
    return turns;
}

/** Visible text lines of an HTML fragment, in document order. */
function textLines(fragment: string): string[] {
    let t = fragment
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<(br|hr)\b[^>]*>/gi, '\n')
        .replace(/<\/(p|div|section|article|li|tr|h\d|blockquote|pre|figure|figcaption|details|summary|table|thead|tbody|caption)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, ' ');
    t = decodeEntities(t);
    return t
        .split('\n')
        .map((l: string) => l.replace(/\s+/g, ' ').trim())
        .filter((l) => l.length > 0)
        // citation markers are presentation: "[1]" (legacy) vs "1" (AST link)
        .map((l: string) => l.replace(/\[(\d+)\]/g, '$1'));
}

/** Order-preserving subsequence check. */
function isSubsequence(needles: string[], haystack: string[]): string | null {
    let h = 0;
    for (const n of needles) {
        let found = false;
        while (h < haystack.length) {
            if (haystack[h] === n) { found = true; h++; break; }
            h++;
        }
        if (!found) return n;
    }
    return null;
}

let oldHtml: string;
let newHtml: string;
let newDiagnostics: Array<{ code: string }>;


test('parity setup: both renderers produce output', async () => {
    oldHtml = toHtml(chat);
    const { bundle } = await normalizeGeminiConversation(chat);
    const res = renderCanonicalHtml(bundle);
    newHtml = res.html;
    newDiagnostics = res.diagnostics;
    assert.ok(oldHtml.startsWith('<!DOCTYPE html>'), 'legacy output is a document');
    assert.ok(newHtml.startsWith('<!DOCTYPE html>'), 'AST output is a document');
});

test('parity: same turn count and structure', () => {
    const oldTurns = splitTurns(oldHtml);
    const newTurns = splitTurns(newHtml);
    assert.strictEqual(oldTurns.length, 4, 'legacy renders 4 turns');
    assert.strictEqual(newTurns.length, 4, 'AST renderer renders 4 turns');
    assert.ok(newHtml.includes('gem-turn-user'), 'user turn kept');
    assert.ok(newHtml.includes('gem-user-bubble'), 'user bubble kept');
    assert.ok(newHtml.includes('gem-turn-model'), 'model turns kept');
});

test('parity: user turn text is a subsequence (content not lost)', () => {
    const oldLines = textLines(splitTurns(oldHtml)[0]);
    const newLines = textLines(splitTurns(newHtml)[0]);
    const missing = isSubsequence(oldLines, newLines);
    assert.strictEqual(missing, null, `legacy user-turn line missing from AST output: ${missing}`);
});

test('parity: model turn text is a subsequence (content not lost)', () => {
    const oldLines = textLines(splitTurns(oldHtml)[1]);
    const newLines = textLines(splitTurns(newHtml)[1]);
    const missing = isSubsequence(oldLines, newLines);
    assert.strictEqual(missing, null, `legacy model-turn line missing from AST output: ${missing}`);
});

test('parity: long prompt collapses in both', () => {
    assert.ok(oldHtml.includes('gem-prompt-content collapsed'), 'legacy collapses long prompt');
    assert.ok(newHtml.includes('gem-prompt-content collapsed'), 'AST renderer collapses long prompt');
    assert.ok(newHtml.includes('gem-prompt-toggle'), 'AST renderer keeps expand toggle');
});

test('parity: thoughts accordion, code copy, carousel kept', () => {
    assert.ok(newHtml.includes('gem-thoughts'), 'thoughts accordion kept');
    assert.ok(newHtml.includes('思考过程'), 'thoughts title kept');
    assert.ok(newHtml.includes('The user wants binary search explained'), 'thought text kept');
    assert.ok(newHtml.includes('gem-code-block'), 'code block kept');
    assert.ok(newHtml.includes('copyCode(this)'), 'code copy button kept');
    assert.ok(newHtml.includes('def bsearch(a, x):'), 'code content kept');
    assert.ok(newHtml.includes('gem-carousel-wrapper'), 'attachment carousel kept');
    assert.ok(newHtml.includes('assets/plan.png'), 'image asset offline path kept');
    assert.ok(newHtml.includes('assets/notes.pdf'), 'file asset offline path kept');
    assert.ok(newHtml.includes('gem-math-block') || newHtml.includes('gem-math-inline'), 'math kept');
});

test('improvement: citations are visible (legacy drops them)', () => {
    assert.ok(!textLines(splitTurns(oldHtml)[1]).join(' ').includes('Binary search reference'), 'legacy drops citation titles');
    assert.ok(newHtml.includes('Binary search reference'), 'AST renderer shows citation chip');
    assert.ok(newHtml.includes('https://example.com/bsearch'), 'AST renderer links citation URL');
});

test('improvement: unknown content stays visible, never blank', () => {
    const unknownTurn = splitTurns(newHtml)[2];
    assert.ok(unknownTurn.includes('gem-unknown-block'), 'unknown block has visible wrapper');
    const lines = textLines(unknownTurn);
    assert.ok(lines.length > 0, 'unknown turn renders visible text, not a blank gap');
});

test('missing asset: visible placeholder + diagnostic, no silent gap', () => {
    const ghostTurn = splitTurns(newHtml)[3];
    assert.ok(ghostTurn.includes('gem-missing-asset'), 'missing asset renders a visible placeholder');
    const codes = newDiagnostics.map((d: { code: string }) => d.code);
    assert.ok(codes.includes('HTML_ASSET_UNRESOLVED'), `diagnostic emitted, got: ${codes.join(',')}`);
});

test('offline: no remote asset URLs leak into output', () => {
    // The only remote URL allowed is the citation link (user-visible source link).
    const srcs = [...newHtml.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
    const nonCitation = srcs.filter((u) => !u.includes('example.com'));
    assert.deepStrictEqual(nonCitation, [], `no remote asset URLs, got: ${nonCitation.join(',')}`);
});

test('inline image (#555 contract): renders inline <img>, never dropped', () => {
    const bundle: any = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'inline_img' },
            title: { value: 'Inline img', source: 'derived', candidates: [] },
            messages: [
                {
                    id: 'm1', role: 'user',
                    blocks: [{
                        id: 'b1', type: 'paragraph',
                        children: [
                            { type: 'text', text: 'see ' },
                            { type: 'image', assetId: 'a-inline', alt: 'a diagram', title: 'fig 1' },
                            { type: 'text', text: ' here' },
                        ],
                    }],
                },
            ],
        },
        assets: [{ id: 'a-inline', kind: 'image', name: 'd.png', mimeType: 'image/png', storageRef: 'assets/d.png', status: 'available' }],
        citations: [],
    };
    const res = renderCanonicalHtml(bundle);
    assert.ok(res.html.includes('class="gem-inline-img"'), 'inline image renders an inline <img>');
    assert.ok(res.html.includes('alt="a diagram"'), 'alt text preserved');
    assert.ok(res.html.includes('title="fig 1"'), 'title preserved');
    assert.ok(!res.diagnostics.some((d: any) => d.code === 'HTML_ASSET_UNRESOLVED'), 'no diagnostic when asset resolves');
});

test('inline image with missing asset: visible placeholder + diagnostic', () => {
    const bundle: any = {
        schemaVersion: 1,
        conversation: {
            key: { providerId: 'gemini', accountId: 't', conversationId: 'inline_img_missing' },
            title: { value: 'Inline img missing', source: 'derived', candidates: [] },
            messages: [
                {
                    id: 'm1', role: 'user',
                    blocks: [{
                        id: 'b1', type: 'paragraph',
                        children: [
                            { type: 'text', text: 'see ' },
                            { type: 'image', assetId: 'a-gone', alt: 'lost diagram' },
                        ],
                    }],
                },
            ],
        },
        assets: [],
        citations: [],
    };
    const res = renderCanonicalHtml(bundle);
    assert.ok(res.html.includes('gem-missing-inline'), 'missing inline image renders a visible placeholder');
    assert.ok(res.html.includes('lost diagram'), 'alt text still visible in placeholder');
    assert.ok(res.diagnostics.some((d: any) => d.code === 'HTML_ASSET_UNRESOLVED'), 'diagnostic emitted, never silent');
});
