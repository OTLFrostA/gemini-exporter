import { ensureUpgraded } from '../../migration/upgradeV1.js';
import { provideWorkerReadiness } from '../api/runtimeReady.js';

let ready: Promise<void> | undefined;
/** The worker owns the one-time upgrade; callers never open the legacy database. */
export function ensureV2Ready(): Promise<void> {
    return ready ??= ensureUpgraded().catch((error: unknown) => { ready = undefined; throw error; });
}

provideWorkerReadiness(ensureV2Ready);

