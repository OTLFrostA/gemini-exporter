import { normalizeConversationTimes, normalizeTimestamp } from './time.js';
import { resolveTitle, TITLE_SOURCES } from './titleAuthority.js';
import type { DomainConversationDetail } from './conversationDetail.js';
import { assertDomainClosure } from './closure.js';

type Check = (value: unknown) => boolean;
const text: Check = v => typeof v === 'string';
const number: Check = v => typeof v === 'number' && Number.isFinite(v);
const boolean: Check = v => typeof v === 'boolean';
const optional = (check: Check): Check => v => v === undefined || check(v);
const array = (check: Check): Check => v => Array.isArray(v) && v.every(check);
const enumeration = (...values: string[]): Check => v => typeof v === 'string' && values.includes(v);
function object(v: unknown): v is Record<string, unknown> { return !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype; }
const shape = (fields: Record<string, Check>): Check => v => object(v) && Object.keys(v).every(k => Object.hasOwn(fields, k)) && Object.entries(fields).every(([k, check]) => check(v[k]));
const generation = shape({ providerRequestId: optional(text), time: optional(number), prompt: optional(text), generationOrdinal: optional(number), imageCount: optional(number), imageOrdinal: optional(number) });
const document = shape({ id: optional(text), contentMarkdown: optional(text), hasFabricatedText: optional(boolean) });
const asset = shape({ id: text, kind: enumeration('image', 'file', 'audio', 'video', 'other'), name: optional(text), mediaType: optional(text), byteLength: optional(number), sourceUri: optional(text), dataBase64: optional(text), failureReason: optional(text), generation: optional(generation), document: optional(document) });
const citation = shape({ id: text, number: optional(number), url: optional(text), title: optional(text) });

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
const message = shape({ id: optional(text), role: enumeration('user', 'assistant', 'system', 'developer', 'unknown'), model: optional(text), content: array(block), timestamp: optional(number), provenance: optional(shape({ rawRole: text })), attachmentIds: optional(array(text)), generation: optional(shape({ mediaKind: enumeration('image', 'audio', 'video', 'other'), outputCount: optional(number) })), reasoning: optional(array(block)), citations: optional(array(citation)) });
const domainFields: Record<string, Check> = { providerId: text, id: text, title: text, assets: array(asset), messages: array(message), completeness: enumeration('complete', 'partial', 'unknown'), updatedAt: optional(number), createdAt: optional(number), url: optional(text), titleSource: optional(text) };
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

/** The sole v1 Domain recovery boundary. Unrecognized structures are rejected after conversion.
 * Body, reasoning and resource references are preserved; discarded parser metadata cannot reach v2. */
function recoverV1(value: unknown): unknown {
    if (!object(value)) return value;
    const { timestamp: _timestamp, chatTime: _chatTime, lastSeen: _lastSeen, href, titles, provenance: _provenance,
        completeness, createdAt, updatedAt, ...rest } = value;
    const candidates = object(titles) ? Object.entries(titles).flatMap(([source, title]) => typeof title === 'string' && TITLE_SOURCES.has(source)
        ? [{ value: title, source }] : []) : [];
    if (typeof rest.title === 'string') candidates.push({ value: rest.title, source: typeof rest.titleSource === 'string' && TITLE_SOURCES.has(rest.titleSource) ? rest.titleSource : 'default' });
    const title = resolveTitle(candidates);
    // Extract historical thought bodies recursively instead of silently deleting real reasoning.
    const extract = (nodes: unknown, reasoning: unknown[]): unknown => Array.isArray(nodes) ? nodes.flatMap((node: unknown): unknown[] => {
        if (!object(node)) return [node];
        if (node.type === 'thought') {
            if (!Array.isArray(node.blocks)) throw new TypeError('Invalid historical thought body');
            const blocks = extract(node.blocks, reasoning);
            if (Array.isArray(blocks)) reasoning.push(...blocks as unknown[]);
            return [];
        }
        const copy = { ...node };
        if (copy.type === 'code') delete copy.filename;
        if (Array.isArray(copy.blocks)) copy.blocks = extract(copy.blocks, reasoning);
        if (Array.isArray(copy.items)) copy.items = copy.items.map((item: unknown): unknown => object(item) ? { ...item, blocks: extract(item.blocks, reasoning) } : item);
        if (copy.type === 'table' && Array.isArray(copy.columns)) copy.columns = copy.columns.map((column: unknown): unknown => object(column) && column.align === 'default' ? Object.fromEntries(Object.entries(column).filter(([key]) => key !== 'align')) : column);
        return [copy];
    }) : nodes;
    if (Array.isArray(rest.messages)) rest.messages = rest.messages.map((m: unknown): unknown => {
        if (!object(m)) return m;
        const thoughts: unknown[] = [];
        const copy: Record<string, unknown> = { ...m, content: extract(m.content, thoughts) };
        const reasoning = extract(m.reasoning ?? [], thoughts);
        if (!Array.isArray(reasoning)) throw new TypeError('Invalid historical reasoning');
        if (reasoning.length || thoughts.length) Object.assign(copy, { reasoning: [...reasoning as unknown[], ...thoughts] });
        if (object(copy.provenance)) {
            const { providerRequestId: _request, ...provenance } = copy.provenance;
            if (Object.keys(provenance).length) copy.provenance = provenance;
            else delete copy.provenance;
        }
        if (Array.isArray(copy.citations)) copy.citations = copy.citations.map((c: unknown): unknown => object(c) ? Object.fromEntries(Object.entries(c).filter(([key]) => key !== 'kind')) : c);
        return copy;
    });
    if (Array.isArray(rest.assets)) rest.assets = rest.assets.map((a: unknown): unknown => {
        if (!object(a)) return a;
        const { origin: _origin, dimensions: _dimensions, generated: _generated, source, ...copy } = a;
        if (object(source) && typeof source.uri === 'string') copy.sourceUri = source.uri;
        if (object(copy.document)) {
            const { createdAt: _created, chipUrl: _chip, sections, links, candidates: _candidates, ...doc } = copy.document;
            // Reject meaningful content that has no canonical body; preserve the original disk value.
            if ((Array.isArray(sections) && sections.some((section: unknown) => typeof section !== 'string' || typeof doc.contentMarkdown !== 'string' || !doc.contentMarkdown.includes(section.trim())))
                || (Array.isArray(links) && links.some((link: unknown) => !object(link) || typeof link.url !== 'string' || typeof doc.contentMarkdown !== 'string' || !doc.contentMarkdown.includes(link.url)))) throw new TypeError('Historical document has no canonical contentMarkdown; original retained');
            if (Object.keys(doc).length) copy.document = doc;
            else delete copy.document;
        }
        if (object(copy.generation)) {
            const { chatId, turnId: _turn, time, ...identity } = copy.generation;
            if (typeof chatId === 'string' && typeof rest.id === 'string' && chatId !== rest.id) throw new TypeError('Historical generation belongs to a different conversation');
            const normalized = normalizeTimestamp(time);
            copy.generation = { ...identity, ...(normalized !== undefined ? { time: normalized } : {}) };
            if (object(copy.generation) && !Object.keys(copy.generation).length) delete copy.generation;
        }
        if (_generated === true && !copy.generation) {
            // Only an explicit asset owner can supply missing request evidence; never infer from position.
            const requests = new Set(Array.isArray(value.messages) ? value.messages.flatMap((message: unknown): string[] =>
                object(message) && Array.isArray(message.attachmentIds) && message.attachmentIds.includes(a.id)
                    && object(message.provenance) && typeof message.provenance.providerRequestId === 'string' && message.provenance.providerRequestId.trim()
                    ? [message.provenance.providerRequestId] : []) : []);
            if (requests.size !== 1) throw new TypeError('Historical generated resource lacks identity evidence; original retained');
            copy.generation = { providerRequestId: [...requests][0] };
        }
        return copy;
    });
    return { ...rest, ...(title ? { title: title.value, titleSource: title.source } : {}),
        ...normalizeConversationTimes({ createdAt, updatedAt }),
        ...(!rest.url && typeof href === 'string' ? { url: href } : {}),
        completeness: object(completeness) ? completeness.status : 'unknown' };
}

/** Disk recovery is versioned explicitly; new writes never accept historical aliases. */
export function restoreDomainSnapshot(value: unknown, version = 2): TrustedDomain {
    serializeDomain(value);
    if (version === 1) value = recoverV1(value);
    else if (version !== 2) throw new TypeError('Unsupported Domain contract version');
    const json = serializeDomain(value);
    const clone: unknown = json === undefined ? undefined : JSON.parse(json);
    assertSchema(value);
    assertSchema(clone);
    if (!clone.id.trim()) throw new TypeError('Empty stored conversation identity');
    assertDomainClosure(clone);
    return clone as TrustedDomain;
}
