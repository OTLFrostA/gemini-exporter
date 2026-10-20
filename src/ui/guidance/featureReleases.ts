import { isVersionGreater } from '../../shared/utils/pathUtils.js';
export interface FeatureReleaseConfig { version: string; stepId: string }
// Existing product announcements, newest first. Do not infer announcements from releases.
// Only explicitly approved v2 announcements belong here; do not replay legacy v1 releases.
export const FEATURE_RELEASES: FeatureReleaseConfig[] = [];
export function getLatestEligibleFeature(lastSeen: string, current: string): FeatureReleaseConfig | null {
    const baseline = /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(lastSeen) ? lastSeen : current;
    return FEATURE_RELEASES.find(feature => !isVersionGreater(feature.version, current) && isVersionGreater(feature.version, baseline)) ?? null;
}
