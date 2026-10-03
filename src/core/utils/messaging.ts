import type { BaseMessage, MessageAction } from '../../types/messages.js';

export function getErrorMessage(err: unknown): string {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err instanceof Error) return err.message;
    if (typeof err === 'object' && 'message' in err && typeof err.message === 'string') {
        return err.message;
    }
    return String(err);
}

// Typed request; Chrome replies remain unknown until a consumer validates them.
export async function sendTypedMessage<T extends BaseMessage>(
    message: T,
    timeoutMs: number = 10000
): Promise<unknown> {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        throw new Error('Chrome runtime messaging is not available in current execution context');
    }

    return new Promise<unknown>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                reject(new Error(`sendTypedMessage timeout after ${timeoutMs}ms for action "${message.action}"`));
            }, timeoutMs);
        }

        try {
            chrome.runtime.sendMessage(message, (response: unknown) => {
                if (timer) clearTimeout(timer);
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message || `Runtime error in action "${message.action}"`));
                    return;
                }
                resolve(response);
            });
        } catch (err: unknown) {
            if (timer) clearTimeout(timer);
            reject(new Error(getErrorMessage(err)));
        }
    });
}

// This checks only the discriminant, never the action-specific payload.
export function isMessageAction<A extends MessageAction>(msg: unknown, action: A): msg is { action: A } {
    return (
        typeof msg === 'object' &&
        msg !== null &&
        'action' in msg &&
        msg.action === action
    );
}

export default {
    getErrorMessage,
    sendTypedMessage,
    isMessageAction
};
