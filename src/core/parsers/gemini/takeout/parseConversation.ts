import { decodeTakeoutHtml, type TakeoutActivityEvidence } from './decodeHtml.js';
import type { ConversationParseContext } from '../../contracts.js';
import type { DomainConversationDetail, DomainMessage } from '../../../domain/conversationDetail.js';
import type { DocumentDiagnostic } from '../../../diagnostics/documentDiagnostic.js';
import type { Diagnostic } from '../../../diagnostics/contentDiagnostic.js';
import { assertDomainClosure } from '../../../domain/closure.js';
import { closeDomainResources } from '../../shared/resources/domainResourceAdapter.js';
import type { ResourceEvidence } from '../../shared/resources/resourceEvidence.js';
import { parseGeminiBody } from '../shared/contentAdapter.js';
import type { ResourceConversationParseResult } from '../../parsingResult.js';

/** Archive entries are source acquisition context; file handles never enter Domain. */
export interface TakeoutSourceFile {
    dir?: boolean;
    _data?: { uncompressedSize?: number };
    async?: (type: string) => Promise<unknown>;
}
export interface GeminiTakeoutRaw {
    htmlText: string;
    archiveFiles?: Readonly<Record<string, TakeoutSourceFile>>;
}
export interface GeminiTakeoutParseContext extends ConversationParseContext { targetConvId?: string }
export interface GeminiTakeoutParseResult extends ResourceConversationParseResult {
    archiveResources: Readonly<Record<string, { path: string; entry: TakeoutSourceFile }>>;
}

function archivePath(uri: string): string {
    let decoded: string;
    try { decoded = decodeURIComponent(uri); } catch { decoded = uri; }
    return decoded.replace(/\\/g, '/').replace(/^\.\//, '');
}
function baseName(uri: string): string { return archivePath(uri).split('/').pop() ?? ''; }
const isImage = (name: string): boolean => /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(name);

/** One selected source conversation. Multi-conversation archives require explicit selection. */
export function parseGeminiTakeoutConversation(raw: GeminiTakeoutRaw, context: GeminiTakeoutParseContext): GeminiTakeoutParseResult {
    if (context.providerId !== 'gemini') throw new TypeError('Gemini Takeout parser requires providerId gemini');
    const activities = decodeTakeoutHtml(raw.htmlText);
    const ids = [...new Set(activities.flatMap(activity => activity.conversationIds))];
    const id = context.targetConvId?.replace(/^c_/, '') ?? (ids.length === 1 ? ids[0] : undefined);
    if (!id || !ids.includes(id)) throw new TypeError('Takeout requires an existing targetConvId when no single conversation can be selected');
    return buildConversation(id, activities, raw.archiveFiles ?? {});
}

/** Batch decoding shares the same source evidence and per-conversation Domain construction. */
export function parseGeminiTakeoutArchive(raw: GeminiTakeoutRaw, context: ConversationParseContext): GeminiTakeoutParseResult[] {
    if (context.providerId !== 'gemini') throw new TypeError('Gemini Takeout parser requires providerId gemini');
    const activities = decodeTakeoutHtml(raw.htmlText);
    const ids = [...new Set(activities.flatMap(activity => activity.conversationIds))];
    if (!ids.length) throw new TypeError('Takeout has no recognized conversation identities');
    return ids.map(id => buildConversation(id, activities, raw.archiveFiles ?? {}));
}

function buildConversation(id: string, activities: TakeoutActivityEvidence[], files: Readonly<Record<string, TakeoutSourceFile>>): GeminiTakeoutParseResult {
    const diagnostics: DocumentDiagnostic[] = [];
    const contentDiagnostics: Diagnostic[] = [];
    const messages: DomainMessage[] = [];
    const groups: Array<{ input: { attachments: ResourceEvidence[] } }> = [];
    const entries = Object.entries(files).filter(([, entry]) => entry && typeof entry === 'object' && !entry.dir);
    const exact = new Map<string, Array<{ path: string; entry: TakeoutSourceFile }>>();
    const byName = new Map<string, Array<{ path: string; entry: TakeoutSourceFile }>>();
    for (const [path, entry] of entries) {
        for (const [index, key] of [[exact, archivePath(path)], [byName, baseName(path)]] as const) {
            const matches = index.get(key) ?? [];
            matches.push({ path, entry }); index.set(key, matches);
        }
    }
    const boundFiles = new Map<string, { path: string; entry: TakeoutSourceFile }>();
    const unowned: ResourceEvidence[] = [];
    const attachmentOf = (ref: { uri: string }, generation?: { chatId: string; time: number | null; prompt: string; generationOrdinal: number; imageCount: number }): ResourceEvidence => {
        const sourcePath = archivePath(ref.uri);
        const matches = exact.get(sourcePath) ?? byName.get(baseName(sourcePath)) ?? [];
        const match = matches.length === 1 ? matches[0] : undefined;
        if (!match) diagnostics.push({ severity: 'warning', code: matches.length > 1 ? 'TAKEOUT_AMBIGUOUS_RESOURCE' : 'TAKEOUT_MISSING_RESOURCE', message: `Archive resource could not be resolved: ${ref.uri}` });
        const sourceUrl = match?.path ?? ref.uri;
        if (match) boundFiles.set(sourceUrl, match);
        const size = match?.entry._data?.uncompressedSize;
        return { type: isImage(sourceUrl) ? 'image' : 'file', url: ref.uri, sourceUrl, name: baseName(sourceUrl), source: 'takeout',
            ...(typeof size === 'number' && Number.isFinite(size) && size >= 0 ? { size } : {}),
            ...(!match ? { failureReason: matches.length > 1 ? 'Ambiguous archive reference' : 'Missing archive entry' } : {}),
            ...(generation && isImage(sourceUrl) ? { isGenerated: true, generation: { ...generation,
                ...(generation.imageCount === 1 ? { imageOrdinal: 0 } : {}) } } : {}) };
    };
    const selected = activities.filter(activity => activity.conversationIds.includes(id));
    // Source date orders activity events; ties and absent dates retain source order.
    const dated = selected.filter(a => a.timestamp !== null).sort((a, b) => a.timestamp! - b.timestamp! || a.blockIndex - b.blockIndex);
    let dateIndex = 0;
    const ordered = selected.map(activity => activity.timestamp === null ? activity : dated[dateIndex++]);
    let generationOrdinal = 0;
    for (const activity of ordered) {
        if (activity.conversationIds.length > 1) diagnostics.push({ severity: 'warning', code: 'TAKEOUT_AMBIGUOUS_CONVERSATION', message: 'Activity links multiple conversations; its ownership is ambiguous', path: `blocks[${activity.blockIndex}]` });
        const generation = activity.generatedImageCount !== undefined ? { chatId: id, time: activity.timestamp,
            prompt: activity.hasExplicitPrompt ? activity.promptText : '', generationOrdinal: generationOrdinal++, imageCount: activity.generatedImageCount } : undefined;
        for (const ref of activity.media.filter(media => media.owner === 'unknown')) {
            unowned.push(attachmentOf(ref));
            diagnostics.push({ severity: 'warning', code: 'TAKEOUT_UNBOUND_RESOURCE', message: `Source does not identify which message owns archive resource: ${ref.uri}` });
        }
        for (const role of ['user', 'assistant'] as const) {
            const content = role === 'user' ? (activity.hasExplicitPrompt ? activity.promptText : '') : activity.responseHtml;
            const references = activity.media.filter(media => media.owner === role);
            if (!content && !references.length && !(role === 'assistant' && generation)) continue;
            const attachments = references.map(ref => attachmentOf(ref, role === 'assistant' ? generation : undefined));
            messages.push({ role, content: parseGeminiBody(content, undefined, { diagnostics: contentDiagnostics,
                sourceRef: { providerId: 'gemini', locator: `blocks[${activity.blockIndex}].${role}` } }),
                ...(activity.timestamp !== null ? { timestamp: activity.timestamp } : {}),
                ...(role === 'assistant' && generation ? { generation: { mediaKind: 'image' as const, outputCount: generation.imageCount } } : {}) });
            groups.push({ input: { attachments } });
            if (role === 'assistant' && generation && !attachments.some(a => a.isGenerated)) diagnostics.push({ severity: 'warning', code: 'TAKEOUT_GENERATED_MEDIA_UNRESOLVED', message: 'Activity records image generation without an explicit archive resource reference' });
        }
    }
    if (unowned.length) groups.push({ input: { attachments: unowned } });
    const resources = closeDomainResources('gemini', messages, groups, { sourceReferences: true });
    const dates = selected.flatMap(activity => activity.timestamp === null ? [] : [activity.timestamp]);
    const createdAt = dates.length ? Math.min(...dates) : null;
    const updatedAt = dates.length ? Math.max(...dates) : null;
    const titleEvent = selected.find(a => a.hasExplicitPrompt && a.promptText) ?? selected.find(a => a.promptText);
    const title = titleEvent?.promptText.split('\n')[0].slice(0, 80).trim() || 'Takeout conversation';
    const conversation: DomainConversationDetail = { providerId: 'gemini', id, title, titleSource: 'takeout', titles: { takeout: title },
        provenance: { source: 'gemini-takeout' }, completeness: { status: 'partial', reason: 'MyActivity is an activity log, not a complete conversation transcript' },
        timestamp: updatedAt, createdAt, updatedAt, url: `https://gemini.google.com/app/${id}`, assets: resources.assets, messages: resources.messages };
    assertDomainClosure(conversation);
    const archiveResources: Record<string, { path: string; entry: TakeoutSourceFile }> = {};
    for (const asset of resources.assets) {
        const bound = asset.source?.uri ? boundFiles.get(asset.source.uri) : undefined;
        if (bound) archiveResources[asset.id] = bound;
    }
    return { conversation, resourceHints: {}, acquisitionHints: resources.acquisitionHints, archiveResources,
        diagnostics: [...diagnostics, ...contentDiagnostics.map(d => ({ severity: d.severity, code: d.code, message: d.message, path: d.path }))] };
}
