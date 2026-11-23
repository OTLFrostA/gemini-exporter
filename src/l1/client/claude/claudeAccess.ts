import { ensureOptionalProviderRegistered } from '../optionalProviderRegistration.js';
import { ClaudeProvider } from './claudeProvider.js';
export { hasClaudeAccess, readClaudeSource } from './claudeSource.js';

/** Register only after the user grants Claude's optional host permission. */
export function ensureClaudeRegistered(): Promise<boolean> { return ensureOptionalProviderRegistered('claude', () => new ClaudeProvider()); }
