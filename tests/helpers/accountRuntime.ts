import { invalidateAccountContext } from '../../src/content/accountContext.js';

export const ACCOUNT_UUID = '10000000-0000-4000-8000-000000000001';
export const OTHER_ACCOUNT_UUID = '10000000-0000-4000-8000-000000000002';
export const ACCOUNT_OBSERVATION = { providerId: 'gemini', providerAccountId: '10000000001' };

/** Exercise the actual resolver with a MAIN observation bridge and committed Registry receipt. */
export function accountRuntime(slot = 'u0') {
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    if (!originalLocation) Object.defineProperty(globalThis, 'location', { configurable: true, value: { href: `https://gemini.google.com/u/${slot.slice(1)}/app`, origin: 'https://gemini.google.com' } });
    const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const runtime = chrome.runtime ?? (chrome.runtime = {} as typeof chrome.runtime);
    const sendMessage = runtime.sendMessage;
    const state = { observation: { ...ACCOUNT_OBSERVATION } as typeof ACCOUNT_OBSERVATION | null };
    const listeners = new Set<(event: MessageEvent) => void>();
    const windowMock = {
        addEventListener(type: string, listener: (event: MessageEvent) => void) { if (type === 'message') listeners.add(listener); },
        removeEventListener(_type: string, listener: (event: MessageEvent) => void) { listeners.delete(listener); },
        postMessage(message: { type: string; payload: { requestId: string } }) {
            if (message.type !== 'GEMINI_ACCOUNT_REQUESTED') return;
            queueMicrotask(() => {
                const slot = /\/u\/(\d+)/.exec(location.href)?.[1] ?? '0';
                for (const listener of [...listeners]) listener({ source: windowMock, origin: location.origin,
                    data: { type: 'GEMINI_ACCOUNT_OBSERVED', payload: { requestId: message.payload.requestId,
                        observation: state.observation, slot: 'u' + slot } } } as unknown as MessageEvent);
            });
        }
    };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock });
    runtime.sendMessage = (async (message: { action: string; observation?: typeof ACCOUNT_OBSERVATION }) => {
        if (message.action === 'accountRegistry') return { ok: true, value: { resolution: 'existing', account: {
            ...message.observation, id: message.observation?.providerAccountId === ACCOUNT_OBSERVATION.providerAccountId ? ACCOUNT_UUID : OTHER_ACCOUNT_UUID
        } } };
        return sendMessage ? Reflect.apply(sendMessage, runtime, [message]) : undefined;
    }) as typeof runtime.sendMessage;
    invalidateAccountContext();
    return { state, restore() {
        invalidateAccountContext(); runtime.sendMessage = sendMessage;
        if (!originalLocation) Reflect.deleteProperty(globalThis, 'location');
        if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window');
    } };
}
