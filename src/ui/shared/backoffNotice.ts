import type { Diagnostic } from '../../shared/diagnostics/diagnostic.js';
import { text } from './settings.js';

/** Request-scoped waits may overlap: completing one must not hide another. */
export function createBackoffNotice() {
    const waits = new Map<string, number>();
    return {
        observe(diagnostic: Pick<Diagnostic, 'code' | 'details'>): void {
            if (diagnostic.code !== 'CHATGPT_BACKOFF_WAIT' && diagnostic.code !== 'CHATGPT_BACKOFF_END') return;
            const details = diagnostic.details;
            if (!details || typeof details !== 'object' || Array.isArray(details)) return;
            // Export resource diagnostics retain the provider observation inside this envelope.
            const data = details.observation ?? details;
            if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.requestId !== 'string') return;
            if (diagnostic.code === 'CHATGPT_BACKOFF_END') waits.delete(data.requestId);
            else if (typeof data.retryAt === 'number' && Number.isFinite(data.retryAt)) waits.set(data.requestId, data.retryAt);
        },
        message(): string | null {
            if (!waits.size) return null;
            const seconds = Math.max(0, Math.ceil((Math.max(...waits.values()) - Date.now()) / 1000));
            return text(`ChatGPT rate limited (429): backing off; retry in ${seconds}s`,
                `ChatGPT 请求受限（429），正在退避，${seconds} 秒后重试`);
        },
    };
}
