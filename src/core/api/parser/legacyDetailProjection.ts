import type { GeminiDetailEvidence } from './detailEvidence.js';
import type { DetailParseResult, ParserMessage, ParserDocument } from './parseDetail.js';
import { sanitizeFileName, shortScope } from '../../utils/pathUtils.js';
import { highResVariant } from './attachments.js';

/** Historical export naming belongs only to the persisted compatibility projection. */
export function projectLegacyDetail(evidence: GeminiDetailEvidence): DetailParseResult {
    const scope = shortScope(evidence.id);
    const names = new Set<string>();
    const unique = (preferred: string): string => {
        if (!names.has(preferred)) { names.add(preferred); return preferred; }
        const dot = preferred.lastIndexOf('.');
        const base = dot !== -1 ? preferred.slice(0, dot) : preferred;
        const ext = dot !== -1 ? preferred.slice(dot) : '';
        let index = 2;
        while (names.has(`${base}_${index}${ext}`)) index++;
        const result = `${base}_${index}${ext}`;
        names.add(result);
        return result;
    };
    const messages: ParserMessage[] = evidence.messages.map(message => {
        const { rawProviderRequestId: _rawRequest, ...legacy } = message;
        const documentsOf = (): ParserDocument[] | undefined => message.documents?.map(document => {
            const { type, hasFabricatedText, ...facts } = document;
            const localName = message.role === 'user'
                ? unique(`files/${scope}${sanitizeFileName(document.title || 'attachment', 'attachment')}`)
                : unique(`files/${scope}${sanitizeFileName(document.title, 'doc').slice(0, 60)}.md`);
            return { ...facts, localName, type, ...(hasFabricatedText ? { hasFabricatedText } : {}) };
        });
        // The old parser allocated research document paths before assistant image paths.
        let documents = message.role === 'model' ? documentsOf() : undefined;
        const images = message.images?.map(image => {
            const { type, isImage, providerRequestId, imageOrdinal, generation, ...facts } = image;
            const resolvedUrl = highResVariant(image.sourceUrl);
            const localName = unique(`assets/${scope}${sanitizeFileName(image.fileName || 'img.jpg', 'img.jpg')}`);
            return message.role === 'user'
                ? { ...facts, resolvedUrl, localName, type, isImage: true }
                : { ...facts, resolvedUrl, localName, type, providerRequestId, imageOrdinal, ...(generation ? { generation } : {}) };
        });
        if (message.role === 'user') documents = documentsOf();
        let imageIndex = 0, documentIndex = 0;
        const attachments = message.attachments?.map(attachment => {
            if (attachment.type === 'image') {
                const image = images?.[imageIndex++];
                return { type: attachment.type, src: image?.resolvedUrl || attachment.src,
                    localName: image?.localName, alt: attachment.alt, isBlob: attachment.isBlob,
                    isImage: attachment.isImage, originalUrl: attachment.originalUrl,
                    ...(message.role === 'model' ? { token: attachment.token, providerRequestId: attachment.providerRequestId,
                        imageOrdinal: attachment.imageOrdinal, ...(attachment.isGenerated ? { isGenerated: true } : {}),
                        ...(attachment.generation ? { generation: attachment.generation } : {}) } : {}) };
            }
            return { type: attachment.type, name: attachment.name, title: attachment.title, url: attachment.url,
                localName: documents?.[documentIndex++]?.localName, contentMarkdown: attachment.contentMarkdown };
        });
        return { ...legacy, images, documents, attachments };
    });
    const { metadataConversation: _metadata, ...legacy } = evidence;
    return { ...legacy, messages };
}
