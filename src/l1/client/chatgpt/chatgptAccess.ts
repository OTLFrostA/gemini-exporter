import { hasPlatformAccess } from '../platformAccess.js';
import { ensureOptionalProviderRegistered } from '../optionalProviderRegistration.js';

export function hasChatGPTAccess(): Promise<boolean> { return hasPlatformAccess('chatgpt'); }
export function ensureChatGPTRegistered(): Promise<boolean> { return ensureOptionalProviderRegistered('chatgpt'); }
