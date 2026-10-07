import type { GeminiDetailEvidence } from '../../parsers/gemini/rpc/detailEvidence.js';
import type { Message, TitleSources, Attachment, MessageDocument } from '../../../types/index.js';
import type { Citation, TitleResult } from '../../parsers/gemini/rpc/extractors.js';
import type { ImageAttachment, DocLink } from './attachments.js';
import { extractImages, extractResponseImages } from './attachments.js';
import { projectLegacyDetail } from './legacyDetailProjection.js';
import { decodeGeminiDetail, decodeDetailEvidence, isTurn, isTurnsArray, findTurnsDeep, extractTurnRequestId, DOC_TITLE_FALLBACK_RE } from '../../parsers/gemini/rpc/detailDecoder.js';
/** Parser diagnostics describe observations, not validated wire records. */
export interface DetailParseDiagnostics {
    turnsLen?: number;
    innerKeys?: string[] | null;
    innerPreview?: string;
    topPreview?: string | null;
    schemaDriftWarnings?: string[];
}

export interface ParserDocument extends MessageDocument {
    id: string;
    title: string;
    createdAt?: number | null;
    chipUrl: string;
    sections: string[];
    links: DocLink[];
    contentMarkdown?: string;
    url: string;
    candidates?: string[];
    localName: string;
    type: string;
    hasFabricatedText?: boolean;
}

export interface ParserAttachment extends Attachment {
    alt?: string;
    isBlob?: boolean;
    originalUrl?: string;
    token?: string;
    contentMarkdown?: string;
}

/** Known parser assembly outputs; raw evidence remains unknown on media nodes. */
export interface ParserMessage extends Omit<Message, "documents" | "citations" | "images" | "attachments" | "structuredContent"> {
    documents?: ParserDocument[];
    citations?: Citation[];
    images?: (ImageAttachment & Attachment)[];
    attachments?: ParserAttachment[];
    structuredContent?: import("../../parsers/gemini/rpc/structuredContent.js").GeminiStructuredDocument;
}

export interface DetailParseResult {
    id: string;
    title: string;
    titleSource: TitleResult["source"];
    titles: TitleSources;
    messages: ParserMessage[];
    createdAt: number | null;
    chatTime: number | null;
    timestamp: number | null;
    updatedAt: number | null;
    url: string;
    nextPageToken: string | null;
    attachmentCount: number;
    schemaDrift?: string[];
    turnsRejected?: number;
    truncated?: boolean;
    isTruncated?: boolean;
    truncateReason?: string;
    /** Decoded wire evidence; no wire-schema validation is implied. */
    _raw?: unknown;
    _debug?: DetailParseDiagnostics | null;
}

export interface GeminiParserParseDetailModule {
    isTurn: (turn: unknown) => boolean;
    isTurnsArray: (arr: unknown) => boolean;
    findTurnsDeep: (root: unknown, depth?: number) => unknown[] | null;
    parseDetail: (text: string, targetConvId?: string, overrides?: unknown) => DetailParseResult;
    decodeGeminiDetail: (text: string, targetConvId?: string, overrides?: unknown) => GeminiDetailEvidence;
    extractTurnRequestId?: (turn: unknown) => string | undefined;
    DOC_TITLE_FALLBACK_RE?: RegExp;
}

/** Persisted compatibility boundary: preserve the existing public result and property presence. */
function parseDetail(text: string, targetConvId?: string, overrides: unknown = {}): DetailParseResult {
    // Compatibility media names retain the historical sequence, including discarded duplicates.
    return projectLegacyDetail(decodeDetailEvidence(text, targetConvId, overrides,
        { images: extractImages, responseImages: extractResponseImages }));
}

export {
    decodeGeminiDetail,
    isTurn,
    isTurnsArray,
    findTurnsDeep,
    parseDetail,
    extractTurnRequestId,
    DOC_TITLE_FALLBACK_RE
};

export const GeminiParserParseDetail: GeminiParserParseDetailModule = {
    decodeGeminiDetail,
    isTurn,
    isTurnsArray,
    findTurnsDeep,
    parseDetail,
    extractTurnRequestId,
    DOC_TITLE_FALLBACK_RE
};

if (typeof module === 'object' && module.exports) module.exports = GeminiParserParseDetail;

export default GeminiParserParseDetail;