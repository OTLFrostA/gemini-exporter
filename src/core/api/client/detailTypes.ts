/** Application detail transport view; semantic data lives in the native Domain result. */
import type { ResourceConversationParseResult } from '../../parsers/parsingResult.js';
import type { Message, TitleSources, Attachment, MessageDocument } from '../../../types/index.js';
import type { Citation, TitleResult } from '../../parsers/gemini/rpc/extractors.js';
import type { ImageAttachment, DocLink } from '../../compatibility/gemini/attachments.js';
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
    /** Native result travels beside the old application view, never inside stored records. */
    parsed?: ResourceConversationParseResult;
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

