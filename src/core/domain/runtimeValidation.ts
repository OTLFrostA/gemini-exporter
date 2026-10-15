import type { DomainConversationDetail } from './conversationDetail.js';
import { assertDomainClosure } from './closure.js';
import { TITLE_AUTHORITY_RANK } from './titleAuthority.js';
import type { DomainConversationIndex } from './conversationIndex.js';

type Check = (value: unknown) => boolean;
const text: Check = v => typeof v === 'string';
const number: Check = v => typeof v === 'number' && Number.isFinite(v);
const boolean: Check = v => typeof v === 'boolean';
const optional = (check: Check): Check => v => v === undefined || check(v);
const array = (check: Check): Check => v => Array.isArray(v) && v.every(check);
const enumeration = (...values: string[]): Check => v => typeof v === 'string' && values.includes(v);
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
const shape = (fields: Record<string, Check>, nonEmpty = false): Check => v => {
    if (!object(v)) return false;
    const keys = Object.keys(v);
    return (!nonEmpty || keys.length > 0) && keys.every(k => Object.hasOwn(fields, k)) && Object.entries(fields).every(([k, check]) => check(v[k]));
};
const generation = shape({ providerRequestId: optional(text), time: optional(number), prompt: optional(text), generationOrdinal: optional(number), imageCount: optional(number), imageOrdinal: optional(number) }, true);
const document = shape({ id: optional(text), contentMarkdown: optional(text), hasFabricatedText: optional(boolean) }, true);
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
        case 'table': {
            const row = shape({ cells: array(shape({ children, colSpan: optional(number), rowSpan: optional(number) })) });
            return shape({ type: enumeration(t), caption: optional(children), columns: optional(array(shape({ align: optional(enumeration('left', 'center', 'right')) }))), headerRows: optional(array(row)), rows: array(row) })(v);
        }
        case 'thematicBreak': return shape({ type: enumeration(t) })(v);
        case 'unknown': return shape({ type: enumeration(t), sourceType: text, text })(v);
        default: return false;
    }
}
const message = shape({ id: optional(text), role: enumeration('user', 'assistant', 'system', 'developer', 'unknown'), model: optional(text), content: array(block), timestamp: optional(number), attachmentIds: optional(array(text)), generation: optional(shape({ mediaKind: enumeration('image', 'audio', 'video', 'other'), outputCount: optional(number) })), reasoning: optional(array(block)), citations: optional(array(citation)) });
const domainFields: Record<string, Check> = { providerId: text, id: text, title: text, assets: array(asset), messages: array(message), completeness: enumeration('complete', 'partial', 'unknown'), createdAt: optional(number), url: optional(text), titleSource: optional(enumeration(...Object.keys(TITLE_AUTHORITY_RANK))) };
const domain = shape(domainFields);

/** Compile-time evidence of schema and reference closure; never serialized. */
declare const trustedDomain: unique symbol;
export type TrustedDomain = DomainConversationDetail & { readonly [trustedDomain]: true };
export type TrustedDomainBody = Pick<TrustedDomain, typeof trustedDomain | 'completeness' | 'messages' | 'assets'>;

/** Preserve established graph trust when separating a stored snapshot's body.
 * Metadata is deliberately not copied; this does not validate arbitrary input. */
export function selectConversationBody(conversation: TrustedDomain): TrustedDomainBody {
    const { providerId: _provider, id: _id, title: _title, titleSource: _source, createdAt: _created, url: _url, ...body } = conversation;
    return body;
}

/** Metadata-only projection over an already trusted body. No repeated AST validation. */
export function withConversationMetadata(body: TrustedDomainBody, index: DomainConversationIndex): TrustedDomain {
    const projected: TrustedDomain = { ...body, providerId: index.providerId, id: index.id,
        title: index.title, titleSource: index.titleSource, createdAt: index.createdAt, url: index.url };
    // Full trusted snapshots are structurally assignable to body. Absent Index
    // fields must still erase their stale optional metadata in that case.
    if (index.createdAt === undefined) delete projected.createdAt;
    if (index.url === undefined) delete projected.url;
    return projected;
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

/** Parser finalization validates the graph without cloning or changing its content. */
export function validateParserDomain(value: DomainConversationDetail): TrustedDomain {
    serializeDomain(value);
    assertSchema(value);
    assertDomainClosure(value);
    return value as TrustedDomain;
}

/** Restore a detached snapshot of the current Domain contract. */
export function restoreDomainSnapshot(value: unknown): TrustedDomain {
    const json = serializeDomain(value);
    const clone: unknown = json === undefined ? undefined : JSON.parse(json);
    assertSchema(value);
    assertSchema(clone);
    if (!clone.id.trim()) throw new TypeError('Empty stored conversation identity');
    assertDomainClosure(clone);
    return clone as TrustedDomain;
}
