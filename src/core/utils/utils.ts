// utils.ts - Shared utilities facade for Gemini Exporter

import type { Conversation } from '../../types/index.js';
import {
    sanitizeFileName,
    sanitizeRelativePath,
    normId,
    isReservedRoute,
    RESERVED_ROUTES,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName
} from './pathUtils.js';
import {
    isRealTitle,
    cleanTitle,
    cleanZeroWidth,
    isBrandPlaceholderTitle,
    unescapeHtml,
    stripHtmlTags,
    resolveTitle,
    setTitleBySource,
    getEffectiveTimestamp,
    compareConversations,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK,
    type TitleResolution
} from './titleUtils.js';
import {
    formatExportProgress,
    type ExportProgressFormatted,
    type ExportProgressInput
} from './progressUtils.js';
import {
    mergeConversation,
    deduplicateConversations,
    type MergeConversationOptions,
    type MergeConversationResult,
    type DeduplicateResult
} from './mergeUtils.js';
import {
    sendTypedMessage,
    isMessageAction,
    getErrorMessage
} from './messaging.js';

export {
    // Path & Route
    sanitizeFileName,
    sanitizeRelativePath,
    normId,
    isReservedRoute,
    RESERVED_ROUTES,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName,
    // Title
    isRealTitle,
    cleanTitle,
    cleanZeroWidth,
    isBrandPlaceholderTitle,
    unescapeHtml,
    stripHtmlTags,
    resolveTitle,
    setTitleBySource,
    getEffectiveTimestamp,
    compareConversations,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK,
    type TitleResolution,
    // Progress
    formatExportProgress,
    type ExportProgressFormatted,
    type ExportProgressInput,
    // Merge
    mergeConversation,
    deduplicateConversations,
    type MergeConversationOptions,
    type MergeConversationResult,
    type DeduplicateResult,
    // Messaging
    sendTypedMessage,
    isMessageAction,
    getErrorMessage
};

export interface GeminiUtilsModule {
    isDevMode: () => boolean;
    isRealTitle: (title?: string | null, id?: string | number) => boolean;
    cleanTitle: (rawTitle?: string | null) => string;
    cleanZeroWidth: (t: any) => string;
    isBrandPlaceholderTitle: (t: any) => boolean;
    unescapeHtml: (text?: string | null) => string;
    stripHtmlTags: (html?: string | null) => string;
    sanitizeFileName: (name?: string | null, fallback?: string) => string;
    sanitizeRelativePath: (p?: string | null, defaultName?: string) => string;
    normId: (id?: string | number | null) => string;
    isReservedRoute: (id?: string | number | null) => boolean;
    RESERVED_ROUTES: Set<string>;
    isGeminiUrl: (urlStr?: string | null) => boolean;
    detectSlotFromUrl: (urlOrPath?: string | null) => string;
    extractConversationIdFromUrl: (urlOrPath?: string | null) => string | null;
    buildExportFileName: (title?: string | null, id?: string | null, ext?: string) => string;
    resolveTitle: (chat?: Partial<Conversation> | null) => TitleResolution;
    setTitleBySource: (chat?: any, source?: string, rawTitle?: string) => TitleResolution;
    getEffectiveTimestamp: (chat?: Partial<Conversation> | null) => number;
    compareConversations: (a?: Partial<Conversation> | null, b?: Partial<Conversation> | null) => number;
    formatExportProgress: (progress?: ExportProgressInput | number | null, txt?: string, isEn?: boolean) => ExportProgressFormatted;
    mergeConversation: (existing: any, incoming: any, options?: MergeConversationOptions) => MergeConversationResult;
    deduplicateConversations: (list: any[], options?: MergeConversationOptions) => DeduplicateResult;
    TITLE_SOURCE_PRIORITY: string[];
    TITLE_TIER_RANK: Record<string, number>;
    getErrorMessage: (err: unknown) => string;
}

declare global {
    var GeminiUtils: GeminiUtilsModule;
    var __gemExporterDevMode: boolean | undefined;
    var __gemExporterVerboseLog: boolean | undefined;
    var __gemExporterLogAll: boolean | undefined;
}

/**
 * Single source for the synchronous dev/verbose flags
 */
export function isDevMode(): boolean {
    if (typeof globalThis !== 'undefined' && (globalThis.__gemExporterDevMode || globalThis.__gemExporterVerboseLog || globalThis.__gemExporterLogAll)) return true;
    if (typeof window !== 'undefined' && ((window as any).__gemExporterDevMode || (window as any).__gemExporterVerboseLog || (window as any).__gemExporterLogAll)) return true;
    return false;
}

export const GeminiUtils: GeminiUtilsModule = {
    isDevMode,
    isRealTitle,
    cleanTitle,
    cleanZeroWidth,
    isBrandPlaceholderTitle,
    unescapeHtml,
    stripHtmlTags,
    sanitizeFileName,
    sanitizeRelativePath,
    normId,
    isReservedRoute,
    RESERVED_ROUTES,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName,
    resolveTitle,
    setTitleBySource,
    getEffectiveTimestamp,
    compareConversations,
    formatExportProgress,
    mergeConversation,
    deduplicateConversations,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK,
    getErrorMessage
};

if (typeof globalThis !== 'undefined') {
    (globalThis as any).GeminiUtils = GeminiUtils;
}
if (typeof module === 'object' && module.exports) {
    module.exports = GeminiUtils;
}

export default GeminiUtils;
