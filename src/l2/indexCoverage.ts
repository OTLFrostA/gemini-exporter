import { CoverageSession } from './streamCoverage.js';
const sessions = new Map<string, CoverageSession>();

export function indexCoverageSession(accountId: string, streamId: string): CoverageSession {
    const key = JSON.stringify([accountId, streamId]);
    let session = sessions.get(key);
    if (!session) {
        session = new CoverageSession(); sessions.set(key, session);
        if (sessions.size > 64) {
            const oldest = sessions.keys().next();
            if (!oldest.done) sessions.delete(oldest.value);
        }
    }
    return session;
}

export function commitIndexCoverageSession(accountId: string, streamId: string, session: CoverageSession): void {
    sessions.set(JSON.stringify([accountId, streamId]), session);
}

export function resetAccountCoverageSessions(accountId: string): void {
    const prefix = JSON.stringify([accountId, '']).slice(0, -3);
    for (const key of sessions.keys()) {
        if (key.startsWith(prefix)) sessions.delete(key);
    }
}

export function resetIndexCoverageSessions(): void { sessions.clear(); }
