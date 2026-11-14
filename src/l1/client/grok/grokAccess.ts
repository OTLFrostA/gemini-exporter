import { ensureOptionalProviderRegistered } from '../optionalProviderRegistration.js';
export { hasGrokAccess, readGrokSource } from './grokSource.js';

export function ensureGrokRegistered(): Promise<boolean> { return ensureOptionalProviderRegistered('grok'); }
