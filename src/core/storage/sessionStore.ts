// src/core/storage/sessionStore.ts - Single Source of Truth for export session state persistence
export interface ExportSessionData {
    status?: 'running' | 'completed' | 'interrupted' | 'error' | string;
    slot?: string;
    total?: number;
    current?: number;
    lastChatId?: string;
    lastChatTitle?: string;
    format?: string;
    useZip?: boolean;
    error?: string;
    updatedAt?: number;
    [key: string]: any;
}

import { STORAGE_KEYS } from '../utils/constants.js';

export const EXPORT_SESSION_KEY = STORAGE_KEYS.LAST_EXPORT_SESSION;

/**
 * Retrieves the current active or last recorded export session from Chrome local storage.
 */
export async function getSession(): Promise<ExportSessionData | null> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get([EXPORT_SESSION_KEY]);
            return (data && data[EXPORT_SESSION_KEY]) ? (data[EXPORT_SESSION_KEY] as ExportSessionData) : null;
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[GemExporter:sessionStore] getSession error', e);
        }
    }
    return null;
}

/**
 * Replaces the export session state with a fresh session snapshot.
 */
export async function setSession(session: Partial<ExportSessionData>): Promise<void> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const payload = {
                ...session,
                updatedAt: session.updatedAt || Date.now()
            };
            await chrome.storage.local.set({ [EXPORT_SESSION_KEY]: payload });
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[GemExporter:sessionStore] setSession error', e);
        }
    }
}

/**
 * Atomically merges a partial update into the current export session.
 */
export async function updateSession(patch: Partial<ExportSessionData>): Promise<void> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const current = (await getSession()) || {};
            const merged = {
                ...current,
                ...patch,
                updatedAt: Date.now()
            };
            await chrome.storage.local.set({ [EXPORT_SESSION_KEY]: merged });
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[GemExporter:sessionStore] updateSession error', e);
        }
    }
}

/**
 * Clears the export session from Chrome local storage.
 */
export async function clearSession(): Promise<void> {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.remove([EXPORT_SESSION_KEY]);
        }
    } catch (e) {
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[GemExporter:sessionStore] clearSession error', e);
        }
    }
}

export const SessionStore = {
    EXPORT_SESSION_KEY,
    getSession,
    setSession,
    updateSession,
    clearSession
};

export default SessionStore;

