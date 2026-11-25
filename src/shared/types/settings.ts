import type { ExportFormat, ExportDelivery } from './export.js';
import { isRecord } from '../utils/typeGuards.js';
import { readDriveExportConnection, type DriveExportConnection } from './driveExport.js';

export const SETTINGS_KEY = 'gemini_exporter_v2_settings';
export const LEGACY_DIRECT_WRITE_PROMPT_KEY = 'gemini_suppress_direct_write_prompt';

export interface GlobalSettings {
    defaultFormat: ExportFormat;
    skipExported: boolean;
    includeAssets: boolean;
    enabledDisk: boolean;
    /** Manual export destination also gates background Live Save. */
    exportDelivery?: ExportDelivery;
    developerMode: boolean;
    theme?: 'dark' | 'light';
    language?: 'zh' | 'en';
    badgePosition?: { left: number; top: number };
    lastSeenFeatureVersion?: string;
    takeoutPromptCompleted?: true;
    ratingPromptDismissed?: true;
    /** Automatically suggested large-batch folder delivery has already been shown. */
    directWritePromptCompleted?: true;
    /** Automatically sync conversation updates to the connected encrypted vault. */
    cloudSyncEnabled?: boolean;
    /** When false or omitted (default), only conversation Index metadata is synced; message bodies stay local. */
    cloudSyncIncludeDetail?: boolean;
    /** Configured Cloud Vault base URL (HTTPS or local loopback). */
    cloudSyncServerUrl?: string;
    /** Opt-in readable Google Drive export, independent from encrypted Vault. */
    driveExport?: DriveExportConnection | null;
}

/** Normalize raw untrusted settings storage into a strongly typed GlobalSettings snapshot. */
export function normalizeGlobalSettings(rawInput: unknown, legacySuppressPrompt?: unknown): GlobalSettings {
    const raw = isRecord(rawInput) ? rawInput : {};
    const enabledDisk = typeof raw.enabledDisk === 'boolean' ? raw.enabledDisk : false;
    const defaultFormat = raw.defaultFormat === 'markdown' || raw.defaultFormat === 'html'
        || raw.defaultFormat === 'pdf' || raw.defaultFormat === 'docx' || raw.defaultFormat === 'json'
        ? raw.defaultFormat : 'markdown';
    const exportDelivery = raw.exportDelivery === 'browserDownload' || raw.exportDelivery === 'folderWriter'
        ? raw.exportDelivery : (enabledDisk ? 'folderWriter' : 'browserDownload');
    const pos = raw.badgePosition;
    const badgePosition = isRecord(pos) && typeof pos.left === 'number' && Number.isFinite(pos.left)
        && typeof pos.top === 'number' && Number.isFinite(pos.top) ? { left: pos.left, top: pos.top } : undefined;
    return {
        defaultFormat,
        skipExported: typeof raw.skipExported === 'boolean' ? raw.skipExported : true,
        includeAssets: typeof raw.includeAssets === 'boolean' ? raw.includeAssets : false,
        enabledDisk,
        exportDelivery,
        developerMode: typeof raw.developerMode === 'boolean' ? raw.developerMode : false,
        ...(raw.theme === 'dark' || raw.theme === 'light' ? { theme: raw.theme } : {}),
        ...(raw.language === 'zh' || raw.language === 'en' ? { language: raw.language } : {}),
        ...(badgePosition ? { badgePosition } : {}),
        ...(typeof raw.lastSeenFeatureVersion === 'string' ? { lastSeenFeatureVersion: raw.lastSeenFeatureVersion } : {}),
        ...(raw.takeoutPromptCompleted === true ? { takeoutPromptCompleted: true } : {}),
        ...(raw.ratingPromptDismissed === true ? { ratingPromptDismissed: true } : {}),
        ...(raw.directWritePromptCompleted === true || legacySuppressPrompt === true
            ? { directWritePromptCompleted: true } : {}),
        ...(typeof raw.cloudSyncEnabled === 'boolean' ? { cloudSyncEnabled: raw.cloudSyncEnabled } : {}),
        ...(typeof raw.cloudSyncIncludeDetail === 'boolean' ? { cloudSyncIncludeDetail: raw.cloudSyncIncludeDetail } : {}),
        ...(typeof raw.cloudSyncServerUrl === 'string' ? { cloudSyncServerUrl: raw.cloudSyncServerUrl } : {}),
        ...(raw.driveExport !== undefined ? { driveExport: readDriveExportConnection(raw.driveExport) } : {}),
    };
}

export function isLiveSaveEffective(settings: GlobalSettings, directoryAvailable: boolean): boolean {
    return settings.enabledDisk && settings.exportDelivery === 'folderWriter'
        && settings.defaultFormat === 'markdown' && directoryAvailable;
}

export function isAutoCaptureEnabled(settings: GlobalSettings, directoryAvailable: boolean): boolean {
    return isLiveSaveEffective(settings, directoryAvailable) || settings.cloudSyncEnabled === true || settings.driveExport != null;
}
