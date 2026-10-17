import type { ExportFormat } from '../export/types.js';

export interface GlobalSettings {
    defaultFormat: ExportFormat;
    useZip: boolean;
    skipExported: boolean;
    includeAssets: boolean;
    enabledDisk: boolean;
    developerMode: boolean;
    language?: 'zh' | 'en';
    badgePosition?: { left: number; top: number };
    tourShown?: true;
    lastSeenFeatureVersion?: string;
    takeoutPromptCompleted?: true;
    directWritePromptShown?: true;
    ratingPromptShown?: true;
}

