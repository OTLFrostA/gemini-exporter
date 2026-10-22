/**
 * Optional-host entry point for ChatGPT runtime access.
 *
 * The manifest declares ChatGPT origins as `optional_host_permissions` only,
 * so updates never prompt or disable existing users. Nothing here runs on its
 * own: Options requests access from its Connect ChatGPT button. Account
 * discovery registers the provider only after the user grants access.
 */
import { ProviderRegistry } from '../providerRegistry.js';
import { ChatGPTProvider } from './chatgptProvider.js';

export const CHATGPT_OPTIONAL_ORIGINS: readonly string[] = [
    'https://chatgpt.com/*',
    'https://chat.openai.com/*',
];

function origins(): string[] {
    return [...CHATGPT_OPTIONAL_ORIGINS];
}

/** True when the user already granted the optional ChatGPT origins. */
export async function hasChatGPTAccess(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
    try {
        return await chrome.permissions.contains({ origins: origins() });
    } catch {
        return false;
    }
}

/**
 * Ask the user for the optional ChatGPT origins. Resolves true only when
 * granted; never throws, so a dismiss/cancel stays a quiet false.
 */
export async function requestChatGPTAccess(): Promise<boolean> {
    if (await hasChatGPTAccess()) return true;
    if (typeof chrome === 'undefined' || !chrome.permissions?.request) return false;
    try {
        return await chrome.permissions.request({ origins: origins() });
    } catch {
        return false;
    }
}

/**
 * Register the ChatGPT adapter exactly when access is granted. Idempotent and
 * inert otherwise: without a grant the registry (and every Gemini flow built
 * on it) is untouched.
 */
export async function ensureChatGPTRegistered(): Promise<boolean> {
    if (!(await hasChatGPTAccess())) return false;
    if (!ProviderRegistry.get('chatgpt')) {
        ProviderRegistry.register(new ChatGPTProvider());
    }
    return true;
}
