import { isDurableSourceUri } from './sourceUri.js';
import { readConversationKey, sameConversationKey } from './conversationKey.js';
import type { TableBlock } from './content/blocks.js';
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROW_SPAN, tableCellPlacements } from './content/tableLayout.js';
import type { DomainConversationDetail, ConversationDetail } from './conversationDetail.js';
import { assertDomainClosure } from './closure.js';
import type { DomainConversation, DomainConversationWithDetail } from './conversation.js';
import { restoreConversationIndex } from './conversationIndex.js';
import type { DomainConversationIndex } from './conversationIndex.js';

type Check = (value: unknown) => boolean;
const text: Check = v => typeof v === 'string';
const number: Check = v => typeof v === 'number' && Number.isFinite(v);
const sourceTime: Check = v => typeof v === 'number' && Number.isSafeInteger(v);
const byteLength: Check = v => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
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
    return (!nonEmpty || keys.some(k => v[k] !== undefined)) && keys.every(k => Object.hasOwn(fields, k)) && Object.entries(fields).every(([k, check]) => check(v[k]));
};
const generation = shape({ providerRequestId: optional(text), time: optional(sourceTime), prompt: optional(text), generationOrdinal: optional(number), imageCount: optional(number), imageOrdinal: optional(number) }, true);
const document = shape({ id: optional(text), contentMarkdown: optional(text) }, true);
const asset = shape({ id: text, kind: enumeration('image', 'file', 'audio', 'video', 'other'), name: optional(text), mediaType: optional(text), byteLength: optional(byteLength), sourceUri: optional(isDurableSourceUri), generation: optional(generation), document: optional(document) });
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
const message = shape({ id: optional(text), role: enumeration('user', 'assistant', 'system', 'developer', 'unknown'), model: optional(text), content: array(block), timestamp: optional(sourceTime), attachmentIds: optional(array(text)), reasoning: optional(array(block)), citations: optional(array(citation)) });
const quality = shape({ status: enumeration('complete', 'partial', 'unknown') });
const domainFields: Record<string, Check> = { key: v => { try { readConversationKey(v); return true; } catch { return false; } }, savedAt: optional(sourceTime), assets: array(asset), messages: array(message), quality };
const domain = shape(domainFields);

/** Omit unknown optional facts without copying already canonical parser/Storage graphs. */
function omitUndefined<T>(value: T): T {
    if (Array.isArray(value)) {
        const entries: readonly unknown[] = value;
        const next = entries.map(item => omitUndefined(item));
        return (next.some((item, i) => item !== value[i]) ? next : value) as T;
    }
    if (!object(value)) return value;
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
        if (item === undefined) { changed = true; continue; }
        next[key] = omitUndefined(item);
        if (next[key] !== item) changed = true;
    }
    return (changed ? next : value) as T;
}

/** Compile-time evidence of schema and reference closure; never serialized. */
declare const trustedDomain: unique symbol;
export type TrustedDomainBody = DomainConversationDetail & { readonly [trustedDomain]: true };
export interface TrustedDomain extends DomainConversationWithDetail { detail: TrustedDomainBody }

/** Frozen public read view: structural Index plus required Detail; no brand or DTO. */
export type ReadonlyDomain = Readonly<DomainConversation & { detail: ConversationDetail }>;

/** Body trust survives metadata changes; no flat snapshot is constructed. */
export function selectConversationBody(conversation: TrustedDomain): TrustedDomainBody { return conversation.detail; }

export function withConversationMetadata(detail: TrustedDomainBody, index: DomainConversationIndex): TrustedDomain {
    if (!sameConversationKey(index.key, detail.key)) throw new TypeError('Conversation key mismatch');
    return { index, detail };
}

function assertSchema(value: unknown): asserts value is DomainConversationDetail {
    let valid = false;
    try { valid = domain(value); } catch { throw new TypeError('Invalid recursive Domain contract'); }
    if (!valid) {
        const field = object(value) ? Object.keys(value).find(k => !Object.hasOwn(domainFields, k))
            ?? Object.entries(domainFields).find(([k, check]) => !check(value[k]))?.[0] : undefined;
        throw new TypeError(`Invalid persisted Domain contract${field ? ': ' + field : ''}`);
    }
}

function assertConversationShape(value: unknown): asserts value is DomainConversationWithDetail {
    if (!object(value) || Object.keys(value).some(key => key !== 'index' && key !== 'detail')) throw new TypeError('Invalid Domain conversation');
    restoreConversationIndex(value.index);
    assertSchema(value.detail);
    if (!sameConversationKey((value.index as DomainConversationIndex).key, value.detail.key)) throw new TypeError('Conversation key mismatch');
}

/** Shared Domain rules for producer finalization and persisted snapshot recovery. */
function assertConversation(value: unknown): asserts value is DomainConversationWithDetail {
    assertConversationShape(value);
    assertDomainClosure(value.detail);
}

/** Parser finalization validates the graph without cloning or changing its content. */
export function validateParserDomain(input: { index: DomainConversationIndex; detail: Omit<DomainConversationDetail, 'key'> & { key?: DomainConversationDetail['key'] } }): TrustedDomain {
    let value = input.detail.key === undefined ? { ...input, detail: { ...input.detail, key: input.index.key } } : input;
    assertConversation(value);
    const detail = omitUndefined(value.detail);
    if (detail !== value.detail) value = { ...value, detail };
    trustedBodies.add(value.detail);
    return value as TrustedDomain;
}

/** In-memory evidence only; IPC and persistence never carry this marker. */
const trustedBodies = new WeakSet<object>();

/** Validate external facts once, or reuse an already validated parser body. */
export function acceptDetailFacts(key: DomainConversationDetail['key'], facts: Omit<DomainConversationDetail, 'key'>): TrustedDomainBody {
    if (trustedBodies.has(facts) && 'key' in facts) {
        if (!sameConversationKey(key, readConversationKey(facts.key))) throw new TypeError('Detail identity mismatch');
        return facts as TrustedDomainBody;
    }
    if ('key' in facts && !sameConversationKey(key, readConversationKey(facts.key))) throw new TypeError('Detail identity mismatch');
    return restoreDomainDetail({ ...facts, key });
}

/** Persistence/IPC values are already detached by the transport; no JSON clone. */
export function restoreDomainDetail(value: unknown): TrustedDomainBody {
    assertSchema(value);
    assertDomainClosure(value);
    const detail = omitUndefined(value);
    trustedBodies.add(detail);
    return detail as TrustedDomainBody;
}

export function restoreDomainSnapshot(value: unknown): TrustedDomain {
    assertConversation(value);
    const detail = omitUndefined(value.detail);
    const conversation = detail === value.detail ? value : { ...value, detail };
    trustedBodies.add(detail);
    return conversation as TrustedDomain;
}

/** Preserve body trust while recording a checked source version, without reparsing content. */
export function withSourceVersion(conversation: TrustedDomain, savedAt: number | undefined): TrustedDomain {
    if (savedAt !== undefined && !Number.isSafeInteger(savedAt)) throw new TypeError('Invalid source version');
    const { savedAt: _old, ...body } = conversation.detail;
    const detail: TrustedDomainBody = { ...body, ...(savedAt !== undefined ? { savedAt } : {}) };
    trustedBodies.add(detail);
    return { index: conversation.index, detail };
}
