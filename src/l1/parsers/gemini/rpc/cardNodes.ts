import type { GeminiStructuredNode, GeminiStructuredFragment, GeminiTextNode } from './structuredContent.js';
import { DOMParser, onErrorStopParsing } from '@xmldom/xmldom';
import {
    GEMINI_ANNOTATION_TYPES,
    GEMINI_NODE_TYPES,
    isBoundedTuple,
    isHttpUrl,
    isNonEmptyString,
    isOptionalString,
    isWireArray,
    singleExtensionPayload,
} from './jspbSchema.js';

export { isHttpUrl };

function text(value: string, href?: string): GeminiTextNode {
    return {
        nodeType: GEMINI_NODE_TYPES.TEXT_BLOCK,
        text: value,
        ...(href ? { annotations: [{ start: 0, end: value.length, type: GEMINI_ANNOTATION_TYPES.LINK, url: href }] } : {}),
    };
}

const fragment = (children: GeminiStructuredNode[]): GeminiStructuredFragment => ({ nodeType: 'fragment', children });

function localized(value: unknown): string | undefined {
    return isWireArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

function appendText(children: GeminiStructuredNode[], value: unknown): boolean {
    if (value == null || value === '') return true;
    if (typeof value !== 'string') return false;
    children.push(text(value));
    return true;
}

const ALLOWED_ROUTE_XML_TAGS = new Set([
    'step', 'direction', 'roadlist', 'road', 'turn', 'exit', 'exitlist', 'signlist', 'sign', 'note',
]);

function routeInstruction(source: unknown): string | null {
    if (typeof source !== 'string') return null;
    try {
        const document = new DOMParser({ onError: onErrorStopParsing }).parseFromString(source, 'application/xml');
        const root = document.documentElement;
        if (document.doctype || !root || root.nodeName !== 'step') return null;
        for (const element of Array.from(document.getElementsByTagName('*'))) {
            if (!ALLOWED_ROUTE_XML_TAGS.has(element.nodeName)) return null;
        }
        return root.textContent?.replace(/\s+/g, ' ').trim() || null;
    } catch {
        return null;
    }
}

function decodeMeasurement(value: unknown): string | null {
    return isBoundedTuple(value, 2) && typeof value[0] === 'number' && typeof value[1] === 'string'
        ? value[1] : null;
}

/** Route geometry, coordinates and renderer controls stay metadata. Titles,
 * duration/distance labels and every authored navigation instruction survive. */
function decodeMapRoutes(value: unknown): GeminiStructuredNode[] | null {
    if (!isBoundedTuple(value, 3) || !isBoundedTuple(value[0], 2)
        || value[0][0] != null || !isWireArray(value[0][1]) || !value[0][1].length || !isHttpUrl(value[1])) return null;
    const children: GeminiStructuredNode[] = [];
    for (const route of value[0][1]) {
        if (!isBoundedTuple(route, 8) || typeof route[0] !== 'string' || !isWireArray(route[1]) || !route[1].length) return null;
        children.push(text(route[0], value[1]));
        for (const leg of route[1]) {
            if (!isBoundedTuple(leg, 7) || !isWireArray(leg[0]) || !leg[0].length) return null;
            const duration = decodeMeasurement(leg[1]), distance = decodeMeasurement(leg[2]);
            if (duration === null || distance === null) return null;
            children.push(text(`${duration} · ${distance}`));
            const items: Array<{ children: GeminiStructuredNode[] }> = [];
            for (const step of leg[0]) {
                if (!isBoundedTuple(step, 10) || step[7] != null || step[8] != null
                    || (step[9] != null && (typeof step[9] !== 'string' || !/^[a-z]+(?:-[a-z]+)*$/.test(step[9])))) return null;
                const instruction = routeInstruction(step[5]);
                const stepDuration = decodeMeasurement(step[4]), stepDistance = decodeMeasurement(step[6]);
                if (instruction === null || stepDuration === null || stepDistance === null) return null;
                items.push({ children: [text(instruction), text(`${stepDuration} · ${stepDistance}`)] });
            }
            children.push({ nodeType: GEMINI_NODE_TYPES.ORDERED_LIST, items });
        }
    }
    return children;
}

/** Generated file resources (kind 26) are handled by the existing file pipeline.
 * Ordinary document chips are links, not locally available file resources. */
export function decodeDocumentLinks(value: unknown): GeminiStructuredFragment | null {
    if (!isWireArray(value) || !value.length) return null;
    const children: GeminiStructuredNode[] = [];
    for (const chip of value) {
        if (!isBoundedTuple(chip, 8) || typeof chip[7] !== 'number' || ![1, 2, 3].includes(chip[7])
            || !isWireArray(chip[0]) || chip[0].length !== 1 || !isHttpUrl(chip[0][0])
            || typeof chip[1] !== 'string' || !isNonEmptyString(chip[3])) return null;
        children.push(text(chip[3], chip[0][0]));
    }
    return fragment(children);
}

export function decodeResearchPlan(value: unknown): GeminiStructuredFragment | null {
    if (!isWireArray(value) || value.length !== 1) return null;
    const plan = value[0];
    if (!isBoundedTuple(plan, 6) || typeof plan[0] !== 'string' || !isWireArray(plan[1]) || !plan[1].length) return null;
    const items: Array<{ children: GeminiStructuredNode[] }> = [];
    for (const step of plan[1]) {
        if (!isBoundedTuple(step, 3) || step[0] !== items.length + 1
            || typeof step[1] !== 'string' || !isOptionalString(step[2])) return null;
        items.push({ children: [text(step[1]), ...(typeof step[2] === 'string' && step[2] ? [text(step[2])] : [])] });
    }
    const children: GeminiStructuredNode[] = [text(plan[0]), { nodeType: GEMINI_NODE_TYPES.ORDERED_LIST, items }];
    if (plan[3] != null) {
        if (!isWireArray(plan[3]) || plan[3].length !== 1 || typeof plan[3][0] !== 'string') return null;
        const link = plan[4];
        if (!isBoundedTuple(link, 2) || !isHttpUrl(link[0]) || link[1] !== 0) return null;
        children.push(text(plan[3][0] || plan[0], link[0]));
    } else if (plan[4] != null) return null;
    return fragment(children);
}

export function decodeMapCard(value: unknown): GeminiStructuredFragment | null {
    if (!isWireArray(value) || value.length !== 2 || !isWireArray(value[0]) || value[0].length
        || !isBoundedTuple(value[1], 3)) return null;
    const children: GeminiStructuredNode[] = [];
    const groups = value[1][0];
    if (groups != null) {
        if (!isWireArray(groups)) return null;
        for (const group of groups) {
            if (!isWireArray(group)) return null;
            for (const place of group) {
                if (!isBoundedTuple(place, 22) || !isWireArray(place[3]) || place[20] != null
                    || (place[21] != null && typeof place[21] !== 'boolean')) return null;
                const metadata = place[3];
                const apiName = localized(metadata[30]);
                const name = apiName ?? metadata[0];
                const address = apiName ? metadata[8] : metadata[1];
                if (!isNonEmptyString(name) || typeof address !== 'string' || !isHttpUrl(metadata[14])) return null;
                children.push(text(name, metadata[14]), text(address));
                if (apiName) {
                    for (const label of [metadata[6], localized(metadata[31]), localized(metadata[51])]) {
                        if (!appendText(children, label)) return null;
                    }
                    if (typeof metadata[13] === 'number') {
                        children.push(text(String(metadata[13]) + (typeof metadata[27] === 'number' ? ` (${metadata[27]})` : '')));
                    }
                    if (isHttpUrl(metadata[15]) && metadata[15] !== metadata[14]) {
                        children.push(text(metadata[15], metadata[15]));
                    }
                }
            }
        }
    }
    if (value[1][1] != null) {
        const routes = decodeMapRoutes(value[1][1]);
        if (routes === null) return null;
        children.push(...routes);
    }
    const footer = value[1][2];
    if (footer != null) {
        if (!isWireArray(footer) || !isHttpUrl(footer[0]) || !isOptionalString(footer[2])) return null;
        children.push(text(typeof footer[2] === 'string' && footer[2] ? footer[2] : footer[0], footer[0]));
    }
    return children.length ? fragment(children) : null;
}

export function decodeFlightCard(value: unknown): GeminiStructuredFragment | null {
    if (!isWireArray(value) || value.length !== 2 || !isWireArray(value[0]) || value[0].length || !isBoundedTuple(value[1], 9)) return null;
    const info = value[1];
    if (!isWireArray(info[1]) || !isHttpUrl(info[2])) return null;
    const children: GeminiStructuredNode[] = [];
    for (const label of [info[4], info[5], info[6], info[8]]) if (!appendText(children, label)) return null;
    for (const flight of info[1]) {
        if (!isBoundedTuple(flight, 4) || !isBoundedTuple(flight[0], 10) || !isHttpUrl(flight[2])
            || typeof flight[3] !== 'string') return null;
        const leg = flight[0];
        if (!isWireArray(leg[0]) || !leg[0].every((code): code is string => typeof code === 'string')
            || ![leg[2], leg[3], leg[7], leg[8], leg[9]].every(part => typeof part === 'string')) return null;
        const label = [leg[0].join(' / '), leg[2], leg[7], '→', leg[3], leg[8], leg[9], flight[3]].join(' ');
        children.push(text(label, flight[2]));
    }
    const summary = info[3];
    if (!isWireArray(summary) || typeof summary[2] !== 'string') return null;
    children.push(text(summary[2] || info[2], info[2]));
    return fragment(children);
}

export function decodeBusinessCard(value: unknown): GeminiStructuredFragment | null {
    if (!isWireArray(value) || value.length !== 2 || !isWireArray(value[0]) || value[0].length || !isBoundedTuple(value[1], 9)) return null;
    const info = value[1];
    if (!isWireArray(info[0])) return null;
    const children: GeminiStructuredNode[] = [];
    for (const label of [info[3], info[4], info[5], info[8]]) if (!appendText(children, label)) return null;
    for (const business of info[0]) {
        if (!isBoundedTuple(business, 9) || typeof business[0] !== 'string' || !isHttpUrl(business[7])
            || typeof business[2] !== 'number' || typeof business[3] !== 'number') return null;
        children.push(text(business[0], business[7]), text(`${business[2]} (${business[3]})`));
        for (const label of [business[4], business[5], business[8]]) if (!appendText(children, label)) return null;
    }
    return fragment(children);
}

export function decodeFinanceCard(value: unknown): GeminiStructuredFragment | null {
    if (!isBoundedTuple(value, 4) || !isWireArray(value[1]) || !isWireArray(value[1][0])
        || !isHttpUrl(value[1][0][0]) || typeof value[1][3] !== 'string' || typeof value[3] !== 'string') return null;
    return fragment([text(value[1][3], value[1][0][0]), { nodeType: 'markup', format: 'markdown', source: value[3] }]);
}

export function decodeMailCard(value: unknown): GeminiStructuredFragment | null {
    if (!isWireArray(value) || !value.length) return null;
    const children: GeminiStructuredNode[] = [];
    for (const card of value) {
        if (!isWireArray(card) || ![2, 6].includes(card.length) || !isWireArray(card[0]) || !isHttpUrl(card[0][0])) return null;
        const extension133 = singleExtensionPayload(card[card.length === 2 ? 1 : 5], '133');
        if (!isWireArray(extension133) || !isWireArray(extension133[2])) return null;
        const summary = extension133[2];
        if (typeof summary[1] !== 'string' || typeof summary[2] !== 'string'
            || !isWireArray(summary[3]) || !summary[3].every((sender): sender is string => typeof sender === 'string')) return null;
        children.push(text(summary[1], card[0][0]), text(summary[2]), ...summary[3].map(sender => text(sender)));
        if (card.length === 2) continue;
        if (!isWireArray(card[1])) return null;
        for (const action of card[1]) {
            if (!isBoundedTuple(action, 5)) return null;
            const mail = singleExtensionPayload(action[4], '1144');
            if (!isBoundedTuple(mail, 7) || !isWireArray(mail[3]) || (mail[4] != null && !isWireArray(mail[4]))) return null;
            if (!appendText(children, mail[3][0])) return null;
            for (const part of isWireArray(mail[4]) ? mail[4] : []) {
                if (!isWireArray(part) || typeof part[0] !== 'string') return null;
                children.push({ nodeType: 'markup', format: 'html', source: part[0] });
            }
        }
    }
    return fragment(children);
}
