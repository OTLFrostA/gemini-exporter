import type { GeminiParserExtractorsModule, GeminiJspbSchema, TurnDriftReport } from "../../parsers/gemini/rpc/extractors.js";
import type { GeminiParserAttachmentsModule } from "./attachments.js";
import type { GeminiParserParseListModule, ListParseResult } from "../../parsers/gemini/rpc/parseList.js";
import type { GeminiParserParseDetailModule } from "./parseDetail.js";

export interface GeminiResponseParserFacade {
    GEMINI_JSPB_SCHEMA: GeminiJspbSchema;
    detectTurnSchemaDrift: (turn: unknown, convId?: string) => TurnDriftReport;
    extractModelCandidates: (turn: unknown) => unknown[];
    extractCandidateText: (cand: unknown) => string;
    robustFirstPayload: (t?: string | null) => unknown[] | null;
    extractTurnTimestamp: (turnData: unknown) => number | null;
    extractImageSelectionIndex: (sourceUrl?: string | null) => number | undefined;
    getImageDedupKey: GeminiParserAttachmentsModule["getImageDedupKey"];
    filterNewImages: GeminiParserAttachmentsModule["filterNewImages"];
    highResVariant: GeminiParserAttachmentsModule["highResVariant"];
    extractImages: GeminiParserAttachmentsModule["extractImages"];
    extractUserFiles: GeminiParserAttachmentsModule["extractUserFiles"];
    extractDocumentsMeta: GeminiParserAttachmentsModule["extractDocumentsMeta"];
    findDocContentById: GeminiParserAttachmentsModule["findDocContentById"];
    parseDocSections: GeminiParserAttachmentsModule["parseDocSections"];
    findDocMarkdownByClues: GeminiParserAttachmentsModule["findDocMarkdownByClues"];
    extractThoughts: (candidateBlock: unknown) => string | null;
    extractCitations: GeminiParserExtractorsModule["extractCitations"];
    extractConversationId: (inner: unknown, turns?: unknown[]) => string;
    extractConversationTitle: GeminiParserExtractorsModule["extractConversationTitle"];
    isRealTitle: (t?: string | null, fallbackId?: string | number) => boolean;
    cleanTitle: (t?: string | null) => string;
    normId: (id?: string | number | null) => string;
    extractListItemTimestamp: (item: unknown) => number | null;
    parseList: (text: string) => ListParseResult;
    parseDetail: GeminiParserParseDetailModule["parseDetail"];
    safeStructureClean: (s?: string | null) => string;
    deepWalk: GeminiParserExtractorsModule["deepWalk"];
    smartSummarizePrompt: (t?: string | null) => string;
    extractMetaTitleFromTop: (top: unknown[], targetConvId?: string) => string | null;
    isInternalChipUrl: (u?: string | null) => boolean;
    findTurnsDeep: (root: unknown, depth?: number) => unknown[] | null;
}

export interface GeminiParserModule {
    GeminiResponseParserClass: GeminiResponseParserFacade;
    isRealTitle: (t?: string | null, fallbackId?: string | number) => boolean;
    cleanTitle: (t?: string | null) => string;
    normId: (id?: string | number | null) => string;
    GEMINI_JSPB_SCHEMA: GeminiJspbSchema;
    detectTurnSchemaDrift: (turn: unknown, convId?: string) => TurnDriftReport;
    extractListItemTimestamp: (item: unknown) => number | null;
    extractors: GeminiParserExtractorsModule;
    attachments: GeminiParserAttachmentsModule;
    parseList: GeminiParserParseListModule;
    parseDetail: GeminiParserParseDetailModule;
}

import * as ext from "../../parsers/gemini/rpc/extractors.js";
import * as att from "./attachments.js";
import * as listMod from "../../parsers/gemini/rpc/parseList.js";
import * as detailMod from "./parseDetail.js";

const {
    GEMINI_JSPB_SCHEMA,
    detectTurnSchemaDrift,
    extractModelCandidates,
    extractCandidateText,
    robustFirstPayload,
    extractTurnTimestamp,
    extractThoughts,
    extractCitations,
    extractConversationId,
    extractConversationTitle,
    isRealTitle,
    cleanTitle,
    normId,
    safeStructureClean,
    deepWalk,
    smartSummarizePrompt,
    extractMetaTitleFromTop
} = ext;

const {
    extractImageSelectionIndex,
    getImageDedupKey,
    filterNewImages,
    highResVariant,
    extractImages,
    extractUserFiles,
    extractDocumentsMeta,
    findDocContentById,
    parseDocSections,
    findDocMarkdownByClues,
    isInternalChipUrl
} = att;

const { extractListItemTimestamp, parseList } = listMod;
const { parseDetail, findTurnsDeep } = detailMod;

    const GeminiResponseParserClass: GeminiResponseParserFacade = {
        GEMINI_JSPB_SCHEMA,
        detectTurnSchemaDrift,
        extractModelCandidates,
        extractCandidateText,
        robustFirstPayload,
        extractTurnTimestamp,
        extractImageSelectionIndex,
        getImageDedupKey,
        filterNewImages,
        highResVariant,
        extractImages,
        extractUserFiles,
        extractDocumentsMeta,
        findDocContentById,
        parseDocSections,
        findDocMarkdownByClues,
        extractThoughts,
        extractCitations,
        extractConversationId,
        extractConversationTitle,
        isRealTitle,
        cleanTitle,
        normId,
        extractListItemTimestamp,
        parseList,
        parseDetail,
        safeStructureClean,
        deepWalk,
        smartSummarizePrompt,
        extractMetaTitleFromTop,
        isInternalChipUrl,
        findTurnsDeep
    };

export {
    GeminiResponseParserClass,
    isRealTitle,
    cleanTitle,
    normId,
    GEMINI_JSPB_SCHEMA,
    detectTurnSchemaDrift,
    extractListItemTimestamp,
    parseList,
    parseDetail,
    extractDocumentsMeta,
};
export {
    extractStructuredContent,
    decodeGeminiStructuredPayload,
    decodeGeminiStructuredNode,
    decodeGeminiAnnotation,
    type GeminiStructuredDocument,
    type GeminiStructuredNode,
    type GeminiAnnotation,
} from "../../parsers/gemini/rpc/structuredContent.js";

export const GeminiParser: GeminiParserModule = {
    GeminiResponseParserClass,
    isRealTitle,
    cleanTitle,
    normId,
    GEMINI_JSPB_SCHEMA,
    detectTurnSchemaDrift,
    extractListItemTimestamp,
    extractors: ext,
    attachments: att,
    parseList: listMod,
    parseDetail: detailMod
};

if (typeof module === 'object' && module.exports) module.exports = GeminiParser;

export default GeminiParser;

export type { ListParseResult, ConversationListItem, ListParseDiagnostics } from "../../parsers/gemini/rpc/parseList.js";
export type { DetailParseResult, DetailParseDiagnostics, ParserMessage, ParserDocument } from "./parseDetail.js";
