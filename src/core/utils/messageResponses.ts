import type { ScanResponse } from '../../types/ui.js';

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}
function optionalBoolean(value: unknown): value is boolean | undefined {
    return value === undefined || typeof value === 'boolean';
}
function optionalNumber(value: unknown): value is number | undefined {
    return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

/** Validate just the fields promised to the scan UI; keep diagnostics/response identity. */
export function isScanResponse(value: unknown): value is ScanResponse {
    if (!isObjectRecord(value) || typeof value.success !== 'boolean' ||
        !optionalNumber(value.count) || !optionalNumber(value.total) ||
        !optionalString(value.error) || !optionalBoolean(value.hitGoogleLimit)) return false;
    const diagnostics = value.diagnostics;
    return diagnostics === undefined || (isObjectRecord(diagnostics) &&
        optionalBoolean(diagnostics.hitGoogleLimit) && optionalString(diagnostics.stopReason));
}

/** Only the top-level fields used by popup are checked; rich detail remains formatter input. */
export interface PopupExportInput extends Record<string, unknown> {
    id?: string | null;
    title?: string | null;
    messages: unknown[];
}
function isPopupExportInput(value: unknown): value is PopupExportInput {
    return isObjectRecord(value) && (value.id == null || typeof value.id === 'string') &&
        (value.title == null || typeof value.title === 'string') &&
        Array.isArray(value.messages);
}

export type PopupFetchResult =
    | { success: true; chat: PopupExportInput }
    | { success: false; error: string };

/** Retain the existing envelope and direct-chat fallback without asserting a parsed detail type. */
export function readPopupFetchResult(value: unknown): PopupFetchResult {
    if (!isObjectRecord(value) || typeof value.success !== 'boolean') {
        return { success: false, error: 'Gemini returned an unreadable conversation reply. Refresh its page and try again.' };
    }
    if (!value.success) {
        return { success: false, error: typeof value.error === 'string' && value.error ? value.error : '未知错误' };
    }
    const chat = value.data || value;
    return isPopupExportInput(chat) ? { success: true, chat }
        : { success: false, error: 'Gemini returned unreadable conversation data. Refresh its page and try again.' };
}
