import type { GeminiStructuredNode, GeminiStructuredFragment, GeminiTextNode } from './structuredContent.js';

function slots(value: unknown): value is unknown[] { return Array.isArray(value); }
export function isHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
function bounded(value: unknown[], length: number): boolean {
    return value.slice(length).every(item => item == null);
}
function text(value: string, href?: string): GeminiTextNode {
    return { nodeType: 18, text: value, ...(href ? { annotations: [{ start: 0, end: value.length, type: 6, url: href }] } : {}) };
}
const fragment = (children: GeminiStructuredNode[]): GeminiStructuredFragment => ({ nodeType: 'fragment', children });
function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !slots(value);
}
function localized(value: unknown): string | undefined {
    return slots(value) && typeof value[0] === 'string' ? value[0] : undefined;
}
function appendText(children: GeminiStructuredNode[], value: unknown): boolean {
    if (value == null || value === '') return true;
    if (typeof value !== 'string') return false;
    children.push(text(value));
    return true;
}

/** Generated file resources (kind 26) are handled by the existing file pipeline.
 * Ordinary document chips are links, not locally available file resources. */
export function decodeDocumentLinks(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || !value.length) return null;
    const children: GeminiStructuredNode[] = [];
    for (const chip of value) {
        if (!slots(chip) || !bounded(chip, 8) || typeof chip[7] !== 'number' || ![1, 2, 3].includes(chip[7])
            || !slots(chip[0]) || chip[0].length !== 1 || !isHttpUrl(chip[0][0])
            || typeof chip[1] !== 'string' || typeof chip[3] !== 'string' || !chip[3]) return null;
        children.push(text(chip[3], chip[0][0]));
    }
    return fragment(children);
}

export function decodeResearchPlan(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || value.length !== 1) return null;
    const plan = value[0];
    if (!slots(plan) || !bounded(plan, 6) || typeof plan[0] !== 'string'
        || !slots(plan[1]) || !plan[1].length) return null;
    const items: Array<{ children: GeminiStructuredNode[] }> = [];
    for (const step of plan[1]) {
        if (!slots(step) || !bounded(step, 3) || step[0] !== items.length + 1
            || typeof step[1] !== 'string' || step[2] != null && typeof step[2] !== 'string') return null;
        items.push({ children: [text(step[1]), ...(typeof step[2] === 'string' && step[2] ? [text(step[2])] : [])] });
    }
    const children: GeminiStructuredNode[] = [text(plan[0]), { nodeType: 14, items }];
    if (plan[3] != null) {
        if (!slots(plan[3]) || plan[3].length !== 1 || typeof plan[3][0] !== 'string') return null;
        const link = plan[4];
        if (!slots(link) || !isHttpUrl(link[0]) || link[1] !== 0 || !bounded(link, 2)) return null;
        children.push(text(plan[3][0] || plan[0], link[0]));
    } else if (plan[4] != null) return null;
    return fragment(children);
}

export function decodeMapCard(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || value.length !== 2 || !slots(value[0]) || value[0].length
        || !slots(value[1]) || !bounded(value[1], 3)) return null;
    const children: GeminiStructuredNode[] = [];
    const groups = value[1][0];
    if (groups != null) {
        if (!slots(groups)) return null;
        for (const group of groups) {
            if (!slots(group)) return null;
            for (const place of group) {
                if (!slots(place) || !slots(place[3]) || !bounded(place, 22) || place[20] != null
                    || place[21] != null && typeof place[21] !== 'boolean') return null;
                const metadata = place[3];
                const apiName = localized(metadata[30]);
                const name = apiName ?? metadata[0];
                const address = apiName ? metadata[8] : metadata[1];
                if (typeof name !== 'string' || !name || typeof address !== 'string' || !isHttpUrl(metadata[14])) return null;
                children.push(text(name, metadata[14]), text(address));
                // These are two versions of Places data. Photo thumbnails,
                // viewport coordinates, review caches and opaque service IDs
                // describe the linked place; they are not authored chat images.
                if (apiName) {
                    for (const label of [metadata[6], localized(metadata[31]), localized(metadata[51])]) {
                        if (!appendText(children, label)) return null;
                    }
                    if (typeof metadata[13] === 'number') children.push(text(String(metadata[13])
                        + (typeof metadata[27] === 'number' ? ` (${metadata[27]})` : '')));
                    if (isHttpUrl(metadata[15]) && metadata[15] !== metadata[14]) children.push(text(metadata[15], metadata[15]));
                }
            }
        }
    }
    // A maps search can contain no place results but still has a linked query.
    const footer = value[1][2];
    if (footer != null) {
        if (!slots(footer) || !isHttpUrl(footer[0]) || footer[2] != null && typeof footer[2] !== 'string') return null;
        children.push(text(typeof footer[2] === 'string' && footer[2] ? footer[2] : footer[0], footer[0]));
    }
    return children.length ? fragment(children) : null;
}

export function decodeFlightCard(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || value.length !== 2 || !slots(value[0]) || value[0].length || !slots(value[1])) return null;
    const info = value[1];
    if (!bounded(info, 9) || !slots(info[1]) || !isHttpUrl(info[2])) return null;
    const children: GeminiStructuredNode[] = [];
    for (const label of [info[4], info[5], info[6], info[8]]) if (!appendText(children, label)) return null;
    for (const flight of info[1]) {
        if (!slots(flight) || !bounded(flight, 4) || !slots(flight[0]) || !isHttpUrl(flight[2])
            || typeof flight[3] !== 'string') return null;
        const leg = flight[0];
        if (!bounded(leg, 10) || !slots(leg[0]) || !leg[0].every((code): code is string => typeof code === 'string')
            || ![leg[2], leg[3], leg[7], leg[8], leg[9]].every(part => typeof part === 'string')) return null;
        const label = [leg[0].join(' / '), leg[2], leg[7], '→', leg[3], leg[8], leg[9], flight[3]].join(' ');
        children.push(text(label, flight[2]));
    }
    const summary = info[3];
    if (!slots(summary) || typeof summary[2] !== 'string') return null;
    children.push(text(summary[2] || info[2], info[2]));
    return fragment(children);
}

export function decodeBusinessCard(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || value.length !== 2 || !slots(value[0]) || value[0].length || !slots(value[1])) return null;
    const info = value[1];
    if (!bounded(info, 9) || !slots(info[0])) return null;
    const children: GeminiStructuredNode[] = [];
    for (const label of [info[3], info[4], info[5], info[8]]) if (!appendText(children, label)) return null;
    for (const business of info[0]) {
        if (!slots(business) || !bounded(business, 9) || typeof business[0] !== 'string' || !isHttpUrl(business[7])
            || typeof business[2] !== 'number' || typeof business[3] !== 'number') return null;
        children.push(text(business[0], business[7]), text(`${business[2]} (${business[3]})`));
        for (const label of [business[4], business[5], business[8]]) if (!appendText(children, label)) return null;
    }
    return fragment(children);
}

export function decodeFinanceCard(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || !bounded(value, 4) || !slots(value[1]) || !slots(value[1][0])
        || !isHttpUrl(value[1][0][0]) || typeof value[1][3] !== 'string' || typeof value[3] !== 'string') return null;
    return fragment([text(value[1][3], value[1][0][0]), { nodeType: 'markup', format: 'markdown', source: value[3] }]);
}

export function decodeMailCard(value: unknown): GeminiStructuredFragment | null {
    if (!slots(value) || !value.length) return null;
    const children: GeminiStructuredNode[] = [];
    for (const card of value) {
        if (!slots(card) || ![2, 6].includes(card.length) || !slots(card[0]) || !isHttpUrl(card[0][0])) return null;
        const extension = card[card.length === 2 ? 1 : 5];
        if (!record(extension) || Object.keys(extension).some(key => key !== '133') || !slots(extension['133'])) return null;
        const summary = extension['133'][2];
        if (!slots(summary) || typeof summary[1] !== 'string' || typeof summary[2] !== 'string'
            || !slots(summary[3]) || !summary[3].every((sender): sender is string => typeof sender === 'string')) return null;
        children.push(text(summary[1], card[0][0]), text(summary[2]), ...summary[3].map(sender => text(sender)));
        if (card.length === 2) continue;
        if (!slots(card[1])) return null;
        for (const action of card[1]) {
            if (!slots(action) || !bounded(action, 5) || !record(action[4])
                || Object.keys(action[4]).some(key => key !== '1144')) return null;
            const mail = action[4]['1144'];
            if (!slots(mail) || !bounded(mail, 7) || !slots(mail[3]) || mail[4] != null && !slots(mail[4])) return null;
            if (!appendText(children, mail[3][0])) return null;
            for (const part of slots(mail[4]) ? mail[4] : []) {
                if (!slots(part) || typeof part[0] !== 'string') return null;
                children.push({ nodeType: 'markup', format: 'html', source: part[0] });
            }
        }
    }
    return fragment(children);
}
