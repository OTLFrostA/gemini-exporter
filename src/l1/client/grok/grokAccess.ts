import { ensureOptionalProviderRegistered } from '../optionalProviderRegistration.js';
import { GrokProvider } from './grokProvider.js';
export { hasGrokAccess, readGrokSource } from './grokSource.js';

export function ensureGrokRegistered(): Promise<boolean> { return ensureOptionalProviderRegistered('grok', () => new GrokProvider()); }
