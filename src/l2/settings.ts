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
}
