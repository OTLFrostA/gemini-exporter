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
    /** Opt-in automatic zero-knowledge E2EE cloud backup for subsequent conversation updates. */
    cloudSyncEnabled?: boolean;
    /** When false or omitted (default), only conversation Index metadata is synced; message bodies stay local. */
    cloudSyncIncludeDetail?: boolean;
    /** Configured zero-knowledge Cloud Vault endpoint origin (HTTPS). */
    cloudSyncServerUrl?: string;
    /** Configured Google OAuth 2.0 Web Client ID used for OIDC authentication. */
    cloudSyncGoogleClientId?: string;
}
