// src/ui/tour/featureReleases.ts - Registry for major version feature announcements
import { isVersionGreater } from '../../core/utils/pathUtils.js';

export interface FeatureReleaseConfig {

    version: string;
    featureId: string;
    stepId: string;
    badgeKey?: string;
}

/**
 * Ordered list of feature releases eligible for one-time spotlight announcement.
 * When an existing user upgrades and their last_seen_feature_version is lower than the release version,
 * the spotlight for the highest eligible unvisited release is shown.
 */
export const FEATURE_RELEASES: FeatureReleaseConfig[] = [
    {
        version: '1.5.0',
        featureId: 'live_save',
        stepId: 'live_save',
        badgeKey: 'tourFeatureBadge'
    }
];

export function getLatestEligibleFeature(lastSeenVersion: string, currentAppVersion: string): FeatureReleaseConfig | null {
    const effectiveLastSeen = lastSeenVersion || '1.0.0';

    for (const rel of FEATURE_RELEASES) {
        if (!isVersionGreater(rel.version, currentAppVersion) && isVersionGreater(rel.version, effectiveLastSeen)) {
            return rel;
        }
    }
    return null;
}

