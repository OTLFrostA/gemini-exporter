import type { DomainConversationIndex } from '../../types/index.js';
import {
    sanitizeFileName,
    sanitizeRelativePath,
    normId,
    shortId,
    shortScope,
    isReservedRoute,
    RESERVED_ROUTES,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName,
    sanitizeFileNameLegacy,
    buildExportFileNameLegacy,
    resolveExportFileName,
    isVersionGreater
} from './pathUtils.js';

import {
    isRealTitle,
    cleanTitle,
    cleanZeroWidth,
    isBrandPlaceholderTitle,
    unescapeHtml,
    stripHtmlTags,
    resolveTitle,
    resolveDetailTitle,
    toTimestampMs,
    getEffectiveTimestamp,
    compareConversations,
    checkIsUpdated,
    resolveConversationExportState,
    isTakeoutConversation,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK,
    normalizeReliableTitleSource,
    resolveReliableTitleSource,
    type TitleResolution,
    type ConversationExportState,
    type ConversationExportStateKind,
    type ConversationBadgeDescriptor,
    type ResolveConversationExportStateOptions
} from './titleUtils.js';

import {
    formatExportProgress,
    type ExportProgressFormatted,
    type ExportProgressInput
} from './progressUtils.js';
import {
    mergeConversation,
    deduplicateConversations,
    type MergeConversationResult,
    type DeduplicateResult
} from './mergeUtils.js';
import {
    sendTypedMessage,
    isMessageAction,
    getErrorMessage
} from './messaging.js';
import {
    calculateBackoff,
    abortableSleep,
    type BackoffOptions,
    type RateLimiterOptions
} from './retryUtils.js';

export {
    sanitizeFileName,
    sanitizeRelativePath,
    normId,
    shortId,
    shortScope,
    isReservedRoute,
    RESERVED_ROUTES,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName,
    sanitizeFileNameLegacy,
    buildExportFileNameLegacy,
    resolveExportFileName,
    isVersionGreater,
    isRealTitle,
    cleanTitle,
    cleanZeroWidth,
    isBrandPlaceholderTitle,
    unescapeHtml,
    stripHtmlTags,
    resolveTitle,
    resolveDetailTitle,
    toTimestampMs,
    getEffectiveTimestamp,
    compareConversations,
    checkIsUpdated,
    resolveConversationExportState,
    isTakeoutConversation,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK,
    normalizeReliableTitleSource,
    resolveReliableTitleSource,
    type TitleResolution,
    type ConversationExportState,
    type ConversationExportStateKind,
    type ConversationBadgeDescriptor,
    type ResolveConversationExportStateOptions,
    formatExportProgress,
    type ExportProgressFormatted,
    type ExportProgressInput,
    mergeConversation,
    deduplicateConversations,
    type MergeConversationResult,
    type DeduplicateResult,
    sendTypedMessage,
    isMessageAction,
    getErrorMessage,
    calculateBackoff,
    abortableSleep,
    type BackoffOptions,
    type RateLimiterOptions
};

export interface GeminiUtilsModule {
    isDevMode: () => boolean;
    isRealTitle: (title?: string | null, id?: string | number) => boolean;
    cleanTitle: (rawTitle?: string | null) => string;
    cleanZeroWidth: typeof cleanZeroWidth;
    isBrandPlaceholderTitle: typeof isBrandPlaceholderTitle;
    unescapeHtml: (text?: string | null) => string;
    stripHtmlTags: (html?: string | null) => string;
    sanitizeFileName: (name?: string | null, fallback?: string) => string;
    sanitizeRelativePath: (p?: string | null, defaultName?: string) => string;
    normId: (id?: string | number | null) => string;
    shortId: (id?: string | number | null) => string;
    shortScope: (id?: string | number | null) => string;
    isReservedRoute: (id?: string | number | null) => boolean;
    RESERVED_ROUTES: Set<string>;
    isGeminiUrl: (urlStr?: string | null) => boolean;
    detectSlotFromUrl: (urlOrPath?: string | null) => string;
    extractConversationIdFromUrl: (urlOrPath?: string | null) => string | null;
    buildExportFileName: (title?: string | null, id?: string | null, ext?: string) => string;
    sanitizeFileNameLegacy: (name?: string | null, fallback?: string) => string;
    buildExportFileNameLegacy: (title?: string | null, id?: string | null, ext?: string) => string;
    resolveExportFileName: (title?: string | null, id?: string | null, ext?: string, exists?: (name: string) => boolean | Promise<boolean>) => Promise<string>;
    isVersionGreater: (v1?: string | null, v2?: string | null) => boolean;
    resolveTitle: typeof resolveTitle;

    resolveDetailTitle: typeof resolveDetailTitle;
    toTimestampMs: typeof toTimestampMs;
    getEffectiveTimestamp: (chat?: Partial<DomainConversationIndex> | null) => number;
    compareConversations: typeof compareConversations;
    checkIsUpdated: (c: any, rec?: any) => boolean;
    resolveConversationExportState: typeof resolveConversationExportState;
    isTakeoutConversation: typeof isTakeoutConversation;
    formatExportProgress: (progress?: ExportProgressInput | number | null, txt?: string, isEn?: boolean) => ExportProgressFormatted;
    mergeConversation: typeof mergeConversation;
    deduplicateConversations: typeof deduplicateConversations;
    TITLE_SOURCE_PRIORITY: string[];
    TITLE_TIER_RANK: Record<string, number>;
    getErrorMessage: (err: unknown) => string;
}

declare global {
    var __gemExporterDevMode: boolean | undefined;
    var __gemExporterVerboseLog: boolean | undefined;
    var __gemExporterLogAll: boolean | undefined;
}

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
    shortId,
    shortScope,
    isReservedRoute,
    RESERVED_ROUTES,
    isGeminiUrl,
    detectSlotFromUrl,
    extractConversationIdFromUrl,
    buildExportFileName,
    sanitizeFileNameLegacy,
    buildExportFileNameLegacy,
    resolveExportFileName,
    isVersionGreater,
    resolveTitle,

    resolveDetailTitle,
    toTimestampMs,
    getEffectiveTimestamp,
    compareConversations,
    checkIsUpdated,
    resolveConversationExportState,
    isTakeoutConversation,
    formatExportProgress,
    mergeConversation,
    deduplicateConversations,
    TITLE_SOURCE_PRIORITY,
    TITLE_TIER_RANK,
    getErrorMessage
};


export default GeminiUtils;
