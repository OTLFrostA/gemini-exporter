import { chatgptAccountObservation } from '../../../l1/client/chatgpt/accountObservation.js';
import type { PlatformAccountAdapter } from './platformAccountAdapter.js';

export function createChatGPTAccountAdapter(): PlatformAccountAdapter {
    return {
        providerId: 'chatgpt',
        currentSlot: () => 'u0',
        observeAccount: () => fetch('/api/auth/session', { credentials: 'include' })
            .then(async response => response.ok ? chatgptAccountObservation(await response.json()) : null),
    };
}
