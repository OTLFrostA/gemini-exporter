import type { GeneratedMediaIdentity } from '../../types/conversation.js';
import { findGenerationModelMessage, hasGenerationImage, type GenerationMessage, type GenerationAttachment } from './legacyGeneratedMediaIdentity.js';

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isGeneratedMediaIdentity(value: unknown): value is GeneratedMediaIdentity {
    return isObjectRecord(value) && typeof value.chatId === 'string' && typeof value.generationOrdinal === 'number'
        && ['providerRequestId', 'prompt', 'turnId'].every(key => value[key] === undefined || typeof value[key] === 'string')
        && ['imageCount', 'imageOrdinal'].every(key => value[key] === undefined || typeof value[key] === 'number')
        && (value.time === undefined || value.time === null || typeof value.time === 'number');
}

export interface LegacyGeneratedMediaEvidence {
    filename: string;
    isGenerated?: boolean;
    providerRequestId?: string;
    imageOrdinal?: number;
    generation?: GeneratedMediaIdentity;
}

/** Legacy acquisition compatibility: resolve media while raw provider evidence is still available. */
export function supplementLegacyGeneratedMedia(
    chat: { id?: string; messages?: GenerationMessage[] | null },
    nid: string,
    takeoutMedia: readonly unknown[],
    options: { appendMarkdownRef?: boolean } = {},
): void {
    if (!Array.isArray(chat.messages)) return;
    const appendMarkdownRef = options.appendMarkdownRef ?? true;
    for (const tm of takeoutMedia) {
        if (!isObjectRecord(tm) || !tm.isGenerated || typeof tm.filename !== 'string') continue;
        const tmFilename = tm.filename;
        const tmRequestId = typeof tm.providerRequestId === 'string' ? tm.providerRequestId : undefined;
        const tmImageOrdinal = typeof tm.imageOrdinal === 'number' ? tm.imageOrdinal : undefined;
        const generation: GeneratedMediaIdentity | null = isGeneratedMediaIdentity(tm.generation)
            ? tm.generation
            : (tmRequestId ? {
                chatId: nid,
                providerRequestId: tmRequestId,
                generationOrdinal: 0,
                imageOrdinal: tmImageOrdinal,
            } : null);
        const eventTarget = generation
            ? findGenerationModelMessage({ id: typeof chat.id === 'string' ? chat.id : undefined, messages: chat.messages }, generation)
            : null;
        if (eventTarget && generation && hasGenerationImage(eventTarget, generation)) continue;
        const candidates: GenerationMessage[] = generation ? (eventTarget ? [eventTarget] : []) : chat.messages;
        const alreadyHas = candidates.some((m: GenerationMessage) =>
            (m.images && m.images.some((im) => im.fileName === tmFilename || (im.localName && im.localName.includes(tmFilename)))) ||
            (m.attachments && m.attachments.some((at) => at.fileName === tmFilename || (at.localName && at.localName.includes(tmFilename)))) ||
            (typeof m.content === 'string' && m.content.includes(tmFilename))
        );
        if (!alreadyHas) {
            const imgObj = {
                type: 'image',
                url: tmFilename,
                name: tmFilename,
                fileName: tmFilename,
                localName: `assets/${tmFilename}`,
                source: 'takeout',
                isGenerated: true,
                providerRequestId: tmRequestId || generation?.providerRequestId,
                imageOrdinal: tmImageOrdinal ?? generation?.imageOrdinal,
                ...(generation ? { generation } : {})
            };
            const targetModelMsg = eventTarget;
            if (targetModelMsg) {
                targetModelMsg.images = targetModelMsg.images || [];
                targetModelMsg.attachments = targetModelMsg.attachments || [];
                targetModelMsg.images.push(imgObj);
                targetModelMsg.attachments.push(imgObj);
                if (appendMarkdownRef) {
                    const currentContent = typeof targetModelMsg.content === 'string' ? targetModelMsg.content : '';
                    if (!currentContent.includes(tmFilename)) {
                        targetModelMsg.content = (currentContent ? currentContent + '\n\n' : '') + `![Generated Image](assets/${tmFilename})`;
                    }
                }
            } else {
                chat.messages.push({
                    role: 'model',
                    content: appendMarkdownRef ? `![Generated Image](assets/${tmFilename})` : '',
                    timestamp: generation?.time ?? null,
                    providerRequestId: tmRequestId || generation?.providerRequestId,
                    ...(generation ? { generation } : {}),
                    images: [imgObj],
                    attachments: [imgObj]
                });
            }
        }
    }
}

/** Deduplicate provider representations before Domain exists, never across message ownership. */
export function reconcileLegacyMediaLists<T extends GenerationAttachment>(attachments: readonly T[] = [], images: readonly T[] = []): T[] {
    const atts: T[] = [];
    for (const a of [...attachments, ...images.map(image => ({ ...image, type: image.type || 'image' }))]) {
        if (!a || typeof a !== 'object') continue;
        const key = a.localName || a.url || a.sourceUrl || a.resolvedUrl || a.src;
        const resourceMatch = atts.find(x => x === a || (key && (x.localName || x.url || x.sourceUrl || x.resolvedUrl || x.src) === key));
        const existing = resourceMatch ?? (a.token ? atts.find(x => x.token === a.token) : undefined);
        if (existing) {
            const preferGenerated = !resourceMatch && a.isGenerated && !existing.isGenerated;
            for (const [k, v] of Object.entries(a)) {
                if (v !== undefined && (Reflect.get(existing, k) === undefined || preferGenerated)) {
                    Object.assign(existing, { [k]: v });
                }
            }
            continue;
        }
        const aReqId = (a.providerRequestId || a.generation?.providerRequestId || '').toLowerCase().replace(/^r_/, '');
        if (aReqId) {
            const aOrd = a.imageOrdinal ?? a.generation?.imageOrdinal ?? (a.generation?.imageCount === 1 ? 0 : undefined);
            const existingGen = atts.find((x) => {
                const xReqId = (x.providerRequestId || x.generation?.providerRequestId || '').toLowerCase().replace(/^r_/, '');
                if (!xReqId || xReqId !== aReqId) return false;
                const aChat = String(a.generation?.chatId || '').trim().replace(/^c_/, '');
                const xChat = String(x.generation?.chatId || '').trim().replace(/^c_/, '');
                if (aChat && xChat && aChat !== xChat) return false;
                const xOrd = x.imageOrdinal ?? x.generation?.imageOrdinal ?? (x.generation?.imageCount === 1 ? 0 : undefined);
                return aOrd !== undefined && xOrd !== undefined && xOrd === aOrd;
            });
            if (existingGen) {
                for (const [k, v] of Object.entries(a)) {
                    if (v !== undefined && Reflect.get(existingGen, k) === undefined) {
                        Object.assign(existingGen, { [k]: v });
                    }
                }
                if (!existingGen.dataBuffer && a.dataBuffer) existingGen.dataBuffer = a.dataBuffer;
                if (!existingGen.blobBase64 && a.blobBase64) existingGen.blobBase64 = a.blobBase64;
                continue;
            }
        }
        atts.push({ ...a });
    }
    return atts;
}
