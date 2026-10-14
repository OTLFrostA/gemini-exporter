import { normalizeConversationTimes, normalizeTimestamp } from './time.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { assertDomainClosure } from './closure.js';

type Check = (value: unknown) => boolean;
const text: Check = v => typeof v === 'string';
const number: Check = v => typeof v === 'number' && Number.isFinite(v);
const boolean: Check = v => typeof v === 'boolean';
const optional = (check: Check): Check => v => v === undefined || check(v);
const nullable = (check: Check): Check => v => v === null || check(v);
const array = (check: Check): Check => v => Array.isArray(v) && v.every(check);
const enumeration = (...values: string[]): Check => v => typeof v === 'string' && values.includes(v);
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
const shape = (fields: Record<string, Check>): Check => v => object(v) && Object.keys(v).every(k => Object.hasOwn(fields, k)) && Object.entries(fields).every(([k, check]) => check(v[k]));
const dictionary = (check: Check): Check => v => object(v) && Object.values(v).every(check);
const generation = shape({ chatId: optional(text), providerRequestId: optional(text), time: optional(number), prompt: optional(text), generationOrdinal: optional(number), imageCount: optional(number), imageOrdinal: optional(number), turnId: optional(text) });
const citation = shape({ id: text, kind: optional(enumeration('web', 'attachment', 'other')), number: optional(number), url: optional(text), title: optional(text) });
const asset = shape({ id: text, kind: enumeration('image', 'file', 'audio', 'video', 'other'), name: optional(text), mediaType: optional(text), byteLength: optional(number), dimensions: optional(shape({ width: optional(number), height: optional(number) })), source: optional(shape({ uri: optional(text) })), dataBase64: optional(text), failureReason: optional(text), origin: optional(text), generated: optional(boolean), generation: optional(generation), document: optional(shape({ id: optional(text), createdAt: optional(number), chipUrl: optional(text), sections: optional(array(text)), links: optional(array(shape({ title: text, url: text }))), contentMarkdown: optional(text), candidates: optional(array(text)), hasFabricatedText: optional(boolean) })) });

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
function block(v: unknown): boolean {
    if (!object(v)) return false;
    const t = v.type;
    const children = array(inline);
    switch (t) {
        case 'paragraph': return shape({ type: enumeration(t), children })(v);
        case 'heading': return shape({ type: enumeration(t), level: v => number(v) && [1, 2, 3, 4, 5, 6].includes(v as number), children })(v);
        case 'list': return shape({ type: enumeration(t), ordered: boolean, start: optional(number), items: array(shape({ blocks: array(block) })) })(v);
        case 'quote': return shape({ type: enumeration(t), blocks: array(block) })(v);
        case 'thought': return shape({ type: enumeration(t), disclosure: enumeration('providerExposed'), kind: optional(enumeration('summary', 'progress', 'reasoning', 'unknown')), blocks: array(block) })(v);
        case 'code': return shape({ type: enumeration(t), code: text, language: optional(text), meta: optional(text), filename: optional(text) })(v);
        case 'math': return shape({ type: enumeration(t), source: text })(v);
        case 'image': return shape({ type: enumeration(t), assetId: text, alt: optional(text), caption: optional(children) })(v);
        case 'file': return shape({ type: enumeration(t), assetId: text, label: optional(text), description: optional(children) })(v);
        case 'table': {
            const row = shape({ cells: array(shape({ children, colSpan: optional(number), rowSpan: optional(number) })) });
            return shape({ type: enumeration(t), caption: optional(children), columns: optional(array(shape({ align: optional(enumeration('left', 'center', 'right', 'default')) }))), headerRows: optional(array(row)), rows: array(row) })(v);
        }
        case 'thematicBreak': return shape({ type: enumeration(t) })(v);
        case 'unknown': return shape({ type: enumeration(t), sourceType: text, text })(v);
        default: return false;
    }
}
const message = shape({ id: optional(text), role: enumeration('user', 'assistant', 'system', 'developer', 'unknown'), model: optional(text), content: array(block), timestamp: optional(number), provenance: optional(shape({ rawRole: optional(text), providerRequestId: optional(text) })), attachmentIds: optional(array(text)), generation: optional(shape({ mediaKind: enumeration('image', 'audio', 'video', 'other'), outputCount: optional(number) })), reasoning: optional(array(block)), citations: optional(array(citation)) });
const domainFields: Record<string, Check> = { providerId: text, id: text, title: text, timestamp: nullable(number), assets: array(asset), messages: array(message), provenance: optional(shape({ source: optional(text) })), completeness: optional(shape({ status: enumeration('complete', 'partial', 'unknown'), reason: optional(text) })), updatedAt: optional(number), createdAt: optional(number), chatTime: optional(v => text(v) || number(v)), lastSeen: optional(v => text(v) || number(v)), url: optional(text), href: optional(text), titleSource: optional(text), titles: optional(dictionary(optional(text))) };
const domain = shape(domainFields);

/** Compile-time evidence of schema and reference closure; never serialized. */
declare const trustedDomain: unique symbol;
export type TrustedDomain = DomainConversationDetail & { readonly [trustedDomain]: true };

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

/** Parser finalization validates the graph without cloning or changing its content. */
export function validateParserDomain(value: DomainConversationDetail): TrustedDomain {
    serializeDomain(value);
    assertSchema(value);
    assertDomainClosure(value);
    return value as TrustedDomain;
}

const legacyGeneration = shape({ chatId: optional(text), providerRequestId: optional(text), time: optional(nullable(number)), prompt: optional(text), generationOrdinal: optional(number), imageCount: optional(number), imageOrdinal: optional(number), turnId: optional(text) });
const legacyDocument = shape({ id: optional(text), createdAt: optional(nullable(number)), chipUrl: optional(text), sections: optional(array(text)), links: optional(array(shape({ title: text, url: text }))), contentMarkdown: optional(text), candidates: optional(array(text)), hasFabricatedText: optional(boolean) });
const legacyAsset = shape({ id: text, kind: enumeration('image', 'file', 'audio', 'video', 'other'), name: optional(text), mediaType: optional(text), byteLength: optional(number), dimensions: optional(shape({ width: optional(number), height: optional(number) })), source: optional(shape({ uri: optional(text) })), dataBase64: optional(text), failureReason: optional(text), origin: optional(text), generated: optional(boolean), generation: optional(legacyGeneration), document: optional(legacyDocument) });

function normalizeLegacyAsset(a: unknown): unknown {
    if (!object(a)) return a;
    let updated = a;
    if (object(a.document) && 'createdAt' in a.document) {
        const createdAt = normalizeTimestamp(a.document.createdAt);
        const { createdAt: _c, ...docRest } = a.document;
        updated = { ...updated, document: { ...docRest, ...(createdAt !== undefined ? { createdAt } : {}) } };
    }
    if (object(a.generation) && 'time' in a.generation) {
        const time = normalizeTimestamp(a.generation.time);
        const { time: _t, ...genRest } = a.generation;
        updated = { ...updated, generation: { ...genRest, ...(time !== undefined ? { time } : {}) } };
    }
    return updated;
}

/** Disk recovery keeps both pre/post serialization checks and detached snapshots. */
export function restoreDomainSnapshot(value: unknown): TrustedDomain {
    // Validate the historical contract before conversion; never hide unrelated corruption.
    serializeDomain(value);
    const legacyTime = optional((v: unknown) => v === null || text(v) || number(v));
    if (!shape({ ...domainFields, createdAt: legacyTime, updatedAt: legacyTime, assets: array(legacyAsset) })(value) || !object(value)) {
        assertSchema(value);
    }
    if (object(value)) {
        const { createdAt, updatedAt, ...rest } = value;
        if (Array.isArray(rest.assets)) {
            (rest as Record<string, unknown>).assets = rest.assets.map(normalizeLegacyAsset);
        }
        value = {
            ...rest,
            ...normalizeConversationTimes({ timestamp: value.timestamp, createdAt, updatedAt }),
        };
    }
    const json = serializeDomain(value);
    const clone: unknown = json === undefined ? undefined : JSON.parse(json);
    assertSchema(value);
    assertSchema(clone);
    if (!clone.id.trim()) throw new TypeError('Empty stored conversation identity');
    assertDomainClosure(clone);
    return clone as TrustedDomain;
}
