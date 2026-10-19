import { isVersionGreater } from '../../core/utils/pathUtils.js';
export interface FeatureReleaseConfig { version: string; stepId: string }
// Existing product announcements, newest first. Do not infer announcements from releases.
export const FEATURE_RELEASES: FeatureReleaseConfig[] = [
    { version: '1.7.0', stepId: 'export' }, { version: '1.5.0', stepId: 'live_save' }
];
export function getLatestEligibleFeature(lastSeen: string, current: string): FeatureReleaseConfig | null {
    const baseline = /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(lastSeen) ? lastSeen : current;
    return FEATURE_RELEASES.find(feature => !isVersionGreater(feature.version, current) && isVersionGreater(feature.version, baseline)) ?? null;
}
