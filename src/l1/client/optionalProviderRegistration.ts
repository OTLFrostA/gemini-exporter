import { hasPlatformAccess } from './platformAccess.js';
import { ProviderRegistry } from './providerRegistry.js';
import { ChatGPTProvider } from './chatgpt/chatgptProvider.js';
import { ClaudeProvider } from './claude/claudeProvider.js';
import { GrokProvider } from './grok/grokProvider.js';
import type { AIProvider } from './aiProvider.js';

type OptionalPlatform = 'chatgpt' | 'claude' | 'grok';

const OPTIONAL_PROVIDER_FACTORIES: Readonly<Record<OptionalPlatform, () => AIProvider>> = {
    chatgpt: () => new ChatGPTProvider(),
    claude: () => new ClaudeProvider(),
    grok: () => new GrokProvider(),
};

/** Register an optional-permission provider once host access is granted. */
export async function ensureOptionalProviderRegistered(platform: OptionalPlatform): Promise<boolean> {
    if (!await hasPlatformAccess(platform)) return false;
    if (!ProviderRegistry.get(platform)) {
        ProviderRegistry.register(OPTIONAL_PROVIDER_FACTORIES[platform]());
    }
    return true;
}
