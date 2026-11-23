import { CoverageSession } from './streamCoverage.js';
const sessions = new Map<string, CoverageSession>();
let resetEpoch = 0;

function pruneSessions(): void {
    while (sessions.size > 64) {
        const oldest = sessions.keys().next();
        if (oldest.done) break;
        sessions.delete(oldest.value);
    }
}

export function coverageResetEpoch(): number {
    return resetEpoch;
}

export function indexCoverageSession(accountId: string, streamId: string): CoverageSession {
    const key = JSON.stringify([accountId, streamId]);
    let session = sessions.get(key);
    if (!session) {
        session = new CoverageSession();
        sessions.set(key, session);
        pruneSessions();
    }
    return session;
}

export function commitIndexCoverageSession(accountId: string, streamId: string, session: CoverageSession): void {
    sessions.set(JSON.stringify([accountId, streamId]), session);
    pruneSessions();
}

export function resetAccountCoverageSessions(accountId: string): void {
    resetEpoch++;
    const prefix = JSON.stringify([accountId, '']).slice(0, -3);
    for (const key of sessions.keys()) {
        if (key.startsWith(prefix)) sessions.delete(key);
    }
}

export function resetIndexCoverageSessions(): void {
    resetEpoch++;
    sessions.clear();
}
