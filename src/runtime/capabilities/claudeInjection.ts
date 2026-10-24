import { syncPlatformContentScripts } from './platformInjection.js';
export function syncClaudeContentScripts(): Promise<void> { return syncPlatformContentScripts('claude'); }
