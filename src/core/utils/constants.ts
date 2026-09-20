declare const __EXT_VERSION__: string | undefined;

export type AllowedFormat = 'markdown' | 'json_openai' | 'json' | 'json_raw';

export interface StorageKeyMap {
    FORMAT: string;
    ZIP: string;
    DEV_MODE: string;
    LANG: string;
    PENDING_TAKEOUT_PROMPT: string;
    SUPPRESS_DIRECT_WRITE_PROMPT: string;
    CREDENTIALS_MAP: string;
    CREDENTIALS: string;
}

export interface GeminiConstantsModule {
    ALLOWED_FORMATS: AllowedFormat[];
    DEFAULT_FORMAT: AllowedFormat;
    DIRECT_WRITE_THRESHOLD: number;
    FEEDBACK_URL: string;
    STORAGE_KEYS: StorageKeyMap;
    EXT_VERSION: string;
    getExtensionVersion: (customVersion?: string) => string;
    exportedIdsKey: (slot: string | null | undefined) => string;
}

export const ALLOWED_FORMATS: AllowedFormat[] = ['markdown', 'json_openai', 'json', 'json_raw'];
export const DEFAULT_FORMAT: AllowedFormat = 'markdown';
export const DIRECT_WRITE_THRESHOLD = 50;
export const FEEDBACK_URL = 'https://tally.so/r/Y56ZBB';
export const STORAGE_KEYS: StorageKeyMap = {
    FORMAT: 'gemini_export_format',
    ZIP: 'gemini_export_zip',
    DEV_MODE: 'gemini_dev_mode',
    LANG: 'gemini_exporter_lang',
    PENDING_TAKEOUT_PROMPT: 'gemini_pending_takeout_prompt',
    SUPPRESS_DIRECT_WRITE_PROMPT: 'gemini_suppress_direct_write_prompt',
    CREDENTIALS_MAP: 'gemini_credentials_map',
    CREDENTIALS: 'gemini_credentials'
};

export const EXT_VERSION: string = typeof __EXT_VERSION__ !== 'undefined' ? __EXT_VERSION__ : '';

export function getExtensionVersion(customVersion?: string): string {
    if (customVersion) return customVersion;
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
            const manifest = chrome.runtime.getManifest();
            if (manifest && manifest.version) return manifest.version;
        }
    } catch { /* intentional */ }
    return EXT_VERSION;
}

export const GeminiConstants: GeminiConstantsModule = {
    ALLOWED_FORMATS,
    DEFAULT_FORMAT,
    DIRECT_WRITE_THRESHOLD,
    STORAGE_KEYS,
    FEEDBACK_URL,
    EXT_VERSION,
    getExtensionVersion,
    exportedIdsKey
};

/**
 * Canonical chrome.storage key for a slot's exported-ids record.
 * Normalizes empty/null/undefined slots to the default 'u0' -> legacy 'exportedIds' key.
 */
export function exportedIdsKey(slot?: string | null): string {
    const s = slot || 'u0';
    return s === 'u0' ? 'exportedIds' : `gemini_exported_${s}`;
}

if (typeof module === 'object' && module.exports) module.exports = GeminiConstants;

export default GeminiConstants;

