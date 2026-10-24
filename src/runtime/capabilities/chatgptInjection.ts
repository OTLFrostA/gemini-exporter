import { syncPlatformContentScripts } from './platformInjection.js';
export function syncChatGPTContentScripts(): Promise<void> { return syncPlatformContentScripts('chatgpt'); }
