import type { DomainAttachment } from '../domain/conversationDetail.js';
import { sameGenerationEvent } from '../domain/legacyGeneratedMediaIdentity.js';

/** Acquisition aliases are resolved here; none of these lists is part of Domain. */
export interface LegacyAttachmentInput extends Partial<DomainAttachment> {
    token?: unknown;
    dataBuffer?: ArrayBuffer | ArrayBufferView | number[];
}
export interface LegacyAttachmentLists {
    attachments?: readonly LegacyAttachmentInput[];
    images?: readonly LegacyAttachmentInput[];
    documents?: readonly LegacyAttachmentInput[];
}

const attachmentFields = [
    'url', 'sourceUrl', 'resolvedUrl', 'src', 'localName', 'fileName', 'name', 'title',
    'mimeType', 'mime', 'size', 'width', 'height', 'source', 'subDir', 'isGenerated',
    'providerRequestId', 'imageOrdinal', 'isImage', 'blobBase64', 'dataBase64', 'failureReason',
    'id', 'createdAt', 'chipUrl', 'contentMarkdown', 'hasFabricatedText',
] as const;

function portableBytes(value: LegacyAttachmentInput['dataBuffer']): string | undefined {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
        : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : Array.isArray(value) ? new Uint8Array(value) : undefined;
    if (!bytes?.length) return undefined;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(binary);
}

/** Only semantic metadata survives; parser tokens/evidence and mutable byte views do not. */
function copyAttachment(input: LegacyAttachmentInput, defaultType: string): DomainAttachment {
    const result: DomainAttachment = { type: input.type || defaultType };
    for (const field of attachmentFields) {
        if (input[field] !== undefined) Object.assign(result, { [field]: input[field] });
    }
    if (input.generation) result.generation = { ...input.generation };
    if (input.sections) result.sections = [...input.sections];
    if (input.links) result.links = input.links.map(link => ({ ...link }));
    if (input.candidates) result.candidates = [...input.candidates];
    // Binary acquisition buffers otherwise turn into empty objects during JSON serialization.
    const encoded = portableBytes(input.dataBuffer);
    if (encoded) result.dataBase64 = encoded;
    return result;
}

function normalizedRef(ref: string): string {
    if (/^[a-z][a-z\d+.-]*:/i.test(ref)) return ref;
    try { return decodeURIComponent(ref).replace(/^\.\//, '').replace(/^assets\//, ''); }
    catch { return ref.replace(/^\.\//, '').replace(/^assets\//, ''); }
}
function references(input: DomainAttachment): Set<string> {
    return new Set([input.localName, input.url, input.sourceUrl, input.resolvedUrl, input.src, input.chipUrl]
        .filter((ref): ref is string => typeof ref === 'string' && !!ref)
        .map(normalizedRef));
}
function imageOrdinal(input: DomainAttachment): number | undefined {
    return input.imageOrdinal ?? input.generation?.imageOrdinal ?? (input.generation?.imageCount === 1 ? 0 : undefined);
}
function requestId(input: DomainAttachment): string {
    return (input.providerRequestId || input.generation?.providerRequestId || '').toLowerCase().replace(/^r_/, '');
}
function chatId(input: DomainAttachment): string {
    return (input.generation?.chatId || '').trim().replace(/^c_/, '');
}
function generationConflict(a: DomainAttachment, b: DomainAttachment): boolean {
    const ar = requestId(a), br = requestId(b), ac = chatId(a), bc = chatId(b);
    return !!(ar && br && ar !== br) || !!(ac && bc && ac !== bc)
        || (ar !== '' && ar === br && imageOrdinal(a) !== undefined && imageOrdinal(b) !== undefined && imageOrdinal(a) !== imageOrdinal(b))
        || !!(!ar && !br && a.generation && b.generation && ac && bc
            && a.generation.time && b.generation.time && a.generation.prompt && b.generation.prompt
            && !sameGenerationEvent(a.generation, b.generation));
}
function identityConflict(a: DomainAttachment, b: DomainAttachment): boolean {
    return generationConflict(a, b)
        || !!(a.type !== 'image' && b.type !== 'image' && a.id && b.id && a.id !== b.id);
}
function sameGeneration(a: DomainAttachment, b: DomainAttachment): boolean {
    const request = requestId(a), ordinal = imageOrdinal(a);
    const eventMatch = request && request === requestId(b)
        || (a.generation && b.generation && sameGenerationEvent(a.generation, b.generation));
    return !!eventMatch && ordinal !== undefined && ordinal === imageOrdinal(b) && !generationConflict(a, b);
}
function stableValue(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) => {
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            return Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)));
        }
        return entry;
    });
}
function fingerprint(attachment: DomainAttachment): string | undefined {
    // A bare kind has no evidence of identity. Identical named records in different
    // legacy lists can be aliases even when no downloadable source exists.
    if (!attachment.fileName && !attachment.name && !attachment.title && !attachment.contentMarkdown) return undefined;
    const type = ['file', 'doc', 'code'].includes(attachment.type) ? 'file' : attachment.type;
    return stableValue({ ...attachment, type });
}
function mergeMetadata(target: DomainAttachment, source: DomainAttachment, preferGenerated: boolean): void {
    for (const [key, value] of Object.entries(source)) {
        if (['generation', 'sections', 'links', 'candidates'].includes(key)) continue;
        if (value !== undefined && (preferGenerated || Reflect.get(target, key) === undefined || Reflect.get(target, key) === '')) {
            Object.assign(target, { [key]: value });
        }
    }
    if (source.isGenerated) target.isGenerated = true;
    if (source.generation) {
        const merged = { ...(target.generation ?? source.generation) };
        for (const [key, value] of Object.entries(source.generation)) {
            if (value !== undefined && Reflect.get(merged, key) === undefined) Object.assign(merged, { [key]: value });
        }
        target.generation = merged;
    }
    for (const field of ['sections', 'links', 'candidates'] as const) {
        if (!source[field]) continue;
        const values = [...(target[field] ?? [])];
        const counts = new Map<string, number>();
        values.forEach(value => {
            const key = stableValue(value);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        });
        const incoming = new Map<string, number>();
        for (const value of source[field]) {
            const key = stableValue(value), count = (incoming.get(key) ?? 0) + 1;
            incoming.set(key, count);
            if (count > (counts.get(key) ?? 0)) values.push(value);
        }
        Object.assign(target, { [field]: values });
    }
}

interface ResolvedAttachment {
    attachment: DomainAttachment;
    refs: Set<string>;
    tokens: Set<string>;
    documentIds: Set<string>;
    aliases: Map<string, Set<number>>;
}

export interface LegacyAttachmentResolution {
    attachments: DomainAttachment[];
    /** Retarget old body references before acquisition aliases are discarded. */
    resolveReference(ref: string): string;
}

/** Resolve duplication per message while preserving first resource order and detached metadata. */
export function resolveLegacyAttachments(input: LegacyAttachmentLists, bodyAttachments: readonly LegacyAttachmentInput[] = []): LegacyAttachmentResolution {
    const resolved: ResolvedAttachment[] = [];
    const lists = [input.attachments ?? [], input.images ?? [], input.documents ?? [], bodyAttachments];
    lists.forEach((list, listIndex) => {
        for (const raw of list) {
            if (!raw || typeof raw !== 'object') continue;
            const attachment = copyAttachment(raw, listIndex === 1 || listIndex === 3 ? 'image' : 'file');
            const refs = references(attachment);
            const token = typeof raw.token === 'string' && raw.token ? raw.token : undefined;
            const docId = attachment.type !== 'image' && attachment.id ? attachment.id : undefined;
            const alias = !refs.size && !token && !docId ? fingerprint(attachment) : undefined;
            const matches = resolved.filter(record => {
                if (identityConflict(record.attachment, attachment)) return false;
                return [...refs].some(ref => record.refs.has(ref))
                    || (token !== undefined && record.tokens.has(token))
                    || (docId !== undefined && record.documentIds.has(docId))
                    || sameGeneration(record.attachment, attachment)
                    || (alias !== undefined && record.aliases.has(alias) && !record.aliases.get(alias)?.has(listIndex));
            });
            // An untagged alias cannot bridge two explicitly different resources.
            const ambiguous = matches.some((record, index) => matches.slice(index + 1)
                .some(other => identityConflict(record.attachment, other.attachment)));
            const first = ambiguous ? undefined : matches[0];
            if (!first) {
                resolved.push({ attachment, refs, tokens: new Set(token ? [token] : []),
                    documentIds: new Set(docId ? [docId] : []), aliases: new Map(alias ? [[alias, new Set([listIndex])]] : []) });
                continue;
            }
            // A record with both a local path and remote URL may bridge two old aliases.
            for (const duplicate of matches.slice(1)) {
                mergeMetadata(first.attachment, duplicate.attachment, false);
                duplicate.refs.forEach(ref => first.refs.add(ref));
                duplicate.tokens.forEach(value => first.tokens.add(value));
                duplicate.documentIds.forEach(value => first.documentIds.add(value));
                duplicate.aliases.forEach((origins, key) => {
                    const known = first.aliases.get(key) ?? new Set<number>();
                    origins.forEach(origin => known.add(origin));
                    first.aliases.set(key, known);
                });
                resolved.splice(resolved.indexOf(duplicate), 1);
            }
            const resourceMatch = [...refs].some(ref => first.refs.has(ref));
            mergeMetadata(first.attachment, attachment, !resourceMatch && !!token && first.tokens.has(token) && !!attachment.isGenerated && !first.attachment.isGenerated);
            refs.forEach(ref => first.refs.add(ref));
            if (token) first.tokens.add(token);
            if (docId) first.documentIds.add(docId);
            if (alias) {
                const known = first.aliases.get(alias) ?? new Set<number>();
                known.add(listIndex);
                first.aliases.set(alias, known);
            }
        }
    });
    const targets = new Map<string, string | undefined>();
    for (const record of resolved) {
        const resource = record.attachment;
        const preferred = [resource.localName, resource.resolvedUrl, resource.sourceUrl, resource.url, resource.src]
            .find(ref => typeof ref === 'string' && !!ref);
        if (!preferred) continue;
        for (const ref of record.refs) {
            // Conflicting owners must not be rebound to an arbitrary resource.
            targets.set(ref, targets.has(ref) && targets.get(ref) !== preferred ? undefined : preferred);
        }
    }
    return { attachments: resolved.map(record => record.attachment),
        resolveReference: ref => targets.get(normalizedRef(ref)) ?? ref };
}

export function normalizeLegacyAttachments(input: LegacyAttachmentLists, bodyAttachments: readonly LegacyAttachmentInput[] = []): DomainAttachment[] {
    return resolveLegacyAttachments(input, bodyAttachments).attachments;
}
