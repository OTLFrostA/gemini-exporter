import type { TableBlock } from './content/blocks.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROW_SPAN, tableCellPlacements } from './content/tableLayout.js';
import type { DeepReadonly } from './readonly.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { assertDomainClosure } from './closure.js';
import type { DomainConversationWithDetail } from './conversation.js';
import { restoreConversationIndex } from './conversationIndex.js';
import type { DomainConversationIndex } from './conversationIndex.js';

type Check = (value: unknown) => boolean;
const text: Check = v => typeof v === 'string';
const number: Check = v => typeof v === 'number' && Number.isFinite(v);
const boolean: Check = v => typeof v === 'boolean';
const optional = (check: Check): Check => v => v === undefined || check(v);
const array = (check: Check): Check => v => {
    if (!Array.isArray(v)) return false;
    for (let index = 0; index < v.length; index++) {
        if (!Object.hasOwn(v, index) || !check(v[index])) return false;
    }
    return true;
};
const enumeration = (...values: string[]): Check => v => typeof v === 'string' && values.includes(v);
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
const shape = (fields: Record<string, Check>, nonEmpty = false): Check => v => {
    if (!object(v)) return false;
    const keys = Object.keys(v);
    return (!nonEmpty || keys.length > 0) && keys.every(k => Object.hasOwn(fields, k)) && Object.entries(fields).every(([k, check]) => check(v[k]));
};
const generation = shape({ providerRequestId: optional(text), time: optional(number), prompt: optional(text), generationOrdinal: optional(number), imageCount: optional(number), imageOrdinal: optional(number) }, true);
const document = shape({ id: optional(text), contentMarkdown: optional(text) }, true);
const asset = shape({ id: text, kind: enumeration('image', 'file', 'audio', 'video', 'other'), name: optional(text), mediaType: optional(text), byteLength: optional(number), sourceUri: optional(text), dataBase64: optional(text), generation: optional(generation), document: optional(document) });
const citation = shape({ id: text, url: optional(text), title: optional(text) });

function inline(v: unknown): boolean {
    if (!object(v)) return false;
    const t = v.type;
    const children = array(inline);
    switch (t) {
        case 'text': return shape({ type: enumeration('text'), text })(v);
        case 'strong': case 'emphasis': case 'strikethrough': return shape({ type: enumeration(t), children })(v);
        case 'inlineCode': return shape({ type: enumeration(t), code: text })(v);
        case 'inlineMath': return shape({ type: enumeration(t), source: text })(v);
        case 'link': return shape({ type: enumeration(t), href: text, title: optional(text), children })(v);
        case 'image': return shape({ type: enumeration(t), assetId: text, alt: optional(text), title: optional(text) })(v);
        case 'citationRef': return shape({ type: enumeration(t), citationId: text, label: optional(text) })(v);
        case 'lineBreak': return shape({ type: enumeration(t), kind: enumeration('soft', 'hard') })(v);
        default: return false;
    }
}
function tableShape(v: unknown): v is TableBlock {
    const span = (max: number): Check => v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max;
    const row = shape({ cells: array(shape({ children: array(inline), colSpan: optional(span(MAX_TABLE_COLUMNS)), rowSpan: optional(span(MAX_TABLE_ROW_SPAN)) })) });
    return shape({ type: enumeration('table'), caption: optional(array(inline)), columns: optional(array(shape({ align: optional(enumeration('left', 'center', 'right')) }))), headerRows: optional(array(row)), rows: array(row) })(v);
}
function table(v: unknown): boolean {
    if (!tableShape(v) || (v.columns?.length ?? 0) > MAX_TABLE_COLUMNS) return false;
    for (const cell of tableCellPlacements(v)) if (cell.column + cell.colSpan > MAX_TABLE_COLUMNS) return false;
    return true;
}
function block(v: unknown): boolean {
    if (!object(v)) return false;
    const t = v.type;
    const children = array(inline);
    switch (t) {
        case 'paragraph': return shape({ type: enumeration(t), children })(v);
        case 'heading': return shape({ type: enumeration(t), level: v => number(v) && [1, 2, 3, 4, 5, 6].includes(v as number), children })(v);
        case 'list': return shape({ type: enumeration(t), ordered: boolean, start: optional(number), items: array(shape({ blocks: array(block) })) })(v);
        case 'quote': return shape({ type: enumeration(t), blocks: array(block) })(v);
        case 'code': return shape({ type: enumeration(t), code: text, language: optional(text), meta: optional(text) })(v);
        case 'math': return shape({ type: enumeration(t), source: text })(v);
        case 'image': return shape({ type: enumeration(t), assetId: text, alt: optional(text), caption: optional(children) })(v);
        case 'file': return shape({ type: enumeration(t), assetId: text, label: optional(text), description: optional(children) })(v);
        case 'table': return table(v);
        case 'thematicBreak': return shape({ type: enumeration(t) })(v);
        case 'unknown': return shape({ type: enumeration(t), sourceType: text, text })(v);
        default: return false;
    }
}
const message = shape({ id: optional(text), role: enumeration('user', 'assistant', 'system', 'developer', 'unknown'), model: optional(text), content: array(block), timestamp: optional(number), attachmentIds: optional(array(text)), generation: optional(shape({ mediaKind: enumeration('image', 'audio', 'video', 'other'), outputCount: optional(number) })), reasoning: optional(array(block)), citations: optional(array(citation)) });
const quality = shape({
    status: enumeration('complete', 'partial', 'unknown'),
    rejectedTurns: optional(v => typeof v === 'number' && Number.isSafeInteger(v) && v > 0),
    truncation: optional(v => typeof v === 'string' && !!v.trim()),
    heuristicDocumentIds: optional(array(text)),
});
const domainFields: Record<string, Check> = { assets: array(asset), messages: array(message), quality };
const domain = shape(domainFields);

/** Compile-time evidence of schema and reference closure; never serialized. */
declare const trustedDomain: unique symbol;
export type TrustedDomainBody = DomainConversationDetail & { readonly [trustedDomain]: true };
export interface TrustedDomain extends DomainConversationWithDetail { detail: TrustedDomainBody }

/** Consumer view only; builders and trust construction retain their existing contracts. */
export type ReadonlyDomain = DeepReadonly<TrustedDomain>;

/** Body trust survives metadata changes; no flat snapshot is constructed. */
export function selectConversationBody(conversation: TrustedDomain): TrustedDomainBody { return conversation.detail; }

export function withConversationMetadata(detail: TrustedDomainBody, index: DomainConversationIndex): TrustedDomain {
    return { index, detail };
}

function serializeDomain(value: unknown): string | undefined {
    // Reject cycles/non-JSON values before recursive schema validation.
    return JSON.stringify(value, (_key, v: unknown) => {
        if (typeof v === 'number' && !Number.isFinite(v)) throw new TypeError('Non-finite Domain value');
        if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') throw new TypeError('Non-JSON Domain value');
        return v;
    });
}
function assertSchema(value: unknown): asserts value is DomainConversationDetail {
    if (!domain(value)) {
        const field = object(value) ? Object.keys(value).find(k => !Object.hasOwn(domainFields, k))
            ?? Object.entries(domainFields).find(([k, check]) => !check(value[k]))?.[0] : undefined;
        throw new TypeError(`Invalid persisted Domain contract${field ? ': ' + field : ''}`);
    }
}

function assertConversationShape(value: unknown): asserts value is DomainConversationWithDetail {
    if (!object(value) || Object.keys(value).some(key => key !== 'index' && key !== 'detail')) throw new TypeError('Invalid Domain conversation');
    restoreConversationIndex(value.index);
    assertSchema(value.detail);
}

/** Shared Domain rules for producer finalization and persisted snapshot recovery. */
function assertConversation(value: unknown): asserts value is DomainConversationWithDetail {
    assertConversationShape(value);
    assertDomainClosure(value.detail);
}

/** Parser finalization validates the graph without cloning or changing its content. */
export function validateParserDomain(value: DomainConversationWithDetail): TrustedDomain {
    serializeDomain(value);
    assertConversation(value);
    return value as TrustedDomain;
}

/** Restore a detached current aggregate, without interpreting historical schemas. */
export function restoreDomainSnapshot(value: unknown): TrustedDomain {
    const json = serializeDomain(value);
    const clone: unknown = json === undefined ? undefined : JSON.parse(json);
    assertConversationShape(value);
    assertConversation(clone);
    return clone as TrustedDomain;
}
