import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import { isSourcePlatform, platformDisplayName } from '../../shared/platformHosts.js';
import { isRecord } from '../../shared/utils/typeGuards.js';
import { text } from './settings.js';

const BACKOFF_CODE = /^([A-Z0-9]+)_(BACKOFF_WAIT|BACKOFF_END|RATE_LIMITED|COOLDOWN_ACTIVE)$/;

function providerLabelFromPrefix(prefix: string): string {
    const lower = prefix.toLowerCase();
    return isSourcePlatform(lower) ? platformDisplayName(lower) : prefix;
}

/** Request-scoped waits may overlap: completing one must not hide another. */
export function createBackoffNotice() {
    const waits = new Map<string, number>();
    let cooldownUntil = 0;
    let activeProvider = 'ChatGPT';
    const message = (): string | null => {
        if (cooldownUntil > Date.now()) {
            const minutes = Math.ceil((cooldownUntil - Date.now()) / 60000);
            return text(`${activeProvider} rate limited (429): export stopped; account cooling down for ${minutes} min. Retry manually later.`,
                `${activeProvider} 请求受限（429），本次导出已停止；账号冷却剩余 ${minutes} 分钟，请稍后手动重试`);
        }
        if (!waits.size) return null;
        const seconds = Math.max(0, Math.ceil((Math.max(...waits.values()) - Date.now()) / 1000));
        return text(`${activeProvider} rate limited (429): backing off; retry in ${seconds}s`,
            `${activeProvider} 请求受限（429），正在退避，${seconds} 秒后重试`);
    };
    return {
        observe(diagnostic: Pick<Diagnostic, 'code' | 'details'>): boolean {
            const match = BACKOFF_CODE.exec(diagnostic.code);
            if (!match) return false;
            const [, rawPrefix, action] = match;
            const details = diagnostic.details;
            if (!isRecord(details)) return false;
            activeProvider = providerLabelFromPrefix(rawPrefix);
            // Export resource diagnostics retain the provider observation inside this envelope.
            const data = isRecord(details.observation) ? details.observation : details;
            if ((action === 'RATE_LIMITED' || action === 'COOLDOWN_ACTIVE') && typeof data.retryAt === 'number') {
                cooldownUntil = Math.max(cooldownUntil, data.retryAt);
                return true;
            }
            if (typeof data.requestId !== 'string') return false;
            if (action === 'BACKOFF_END') {
                waits.delete(data.requestId);
                return true;
            }
            if (typeof data.retryAt === 'number' && Number.isFinite(data.retryAt)) {
                waits.set(data.requestId, data.retryAt);
                return true;
            }
            return false;
        },
        message,
        startTicker(onTick: () => void): () => void {
            const timer = setInterval(() => {
                if (message()) onTick();
            }, 1000);
            return () => clearInterval(timer);
        },
    };
}
