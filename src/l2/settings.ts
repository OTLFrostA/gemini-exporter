import type { ExportFormat, ExportDelivery } from '../shared/types/export.js';

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
    /** Optional shared access/invite code for self-hosted Cloud Vault servers. */
    cloudSyncAccessCode?: string;
}
