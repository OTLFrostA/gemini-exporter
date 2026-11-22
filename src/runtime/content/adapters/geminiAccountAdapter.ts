import { readAccountParameters, type Account } from '../../../l2/accountRegistry.js';
import { CrossWorldEvents } from '../../../l1/protocol/gemini/protocol.js';
import { detectSlotFromUrl } from '../../../l1/protocol/gemini/url.js';
import type { PlatformAccountAdapter } from '../accountContext.js';
import { registerCleanup } from '../cleanupRegistry.js';

export function createGeminiAccountAdapter(): PlatformAccountAdapter {
    return {
        providerId: 'gemini',
        currentSlot: () => detectSlotFromUrl(typeof location !== 'undefined' ? location.href : undefined),
        observeAccount: (slot: string): Promise<Omit<Account, 'id'> | null> => new Promise((resolve, reject) => {
            const requestId = crypto.randomUUID();
            let unregister = () => {};
            const finish = (observation: Omit<Account, 'id'> | null, error?: unknown): void => {
                clearTimeout(timer);
                window.removeEventListener('message', receive);
                unregister();
                if (error) reject(error); else resolve(observation);
            };
            const receive = (event: MessageEvent<unknown>): void => {
                if (event.source !== window || event.origin !== location.origin) return;
                const data = event.data;
                if (!data || typeof data !== 'object' || Array.isArray(data)
                    || !('type' in data) || data.type !== CrossWorldEvents.ACCOUNT_OBSERVED
                    || !('payload' in data)) return;
                const payload = data.payload;
                if (!payload || typeof payload !== 'object' || Array.isArray(payload)
                    || !('requestId' in payload) || payload.requestId !== requestId
                    || !('slot' in payload) || payload.slot !== slot
                    || !('observation' in payload)) return;
                try { finish(payload.observation === null ? null : readAccountParameters(payload.observation)); }
                catch (error) { finish(null, error); }
            };
            const timer = setTimeout(() => finish(null), 2000);
            window.addEventListener('message', receive);
            unregister = registerCleanup(() => finish(null));
            window.postMessage({ type: CrossWorldEvents.ACCOUNT_REQUESTED, payload: { requestId } }, location.origin);
        }),
    };
}
