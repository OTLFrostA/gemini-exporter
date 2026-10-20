import type { AIProvider } from './aiProvider.js';
import type { SourceResourceContext } from '../resources/sourceResources.js';
import { ProviderRegistry } from './providerRegistry.js';
import { GeminiProvider } from './gemini/geminiProvider.js';
import { ChatGPTProvider } from './chatgpt/chatgptProvider.js';

/** L1 owns platform-specific construction; Application owns the task lifetime. */
export function createTaskProvider(providerId: string, resources: SourceResourceContext): AIProvider {
    switch (providerId) {
        case 'gemini': return new GeminiProvider(undefined, undefined, resources);
        case 'chatgpt': return new ChatGPTProvider({ resources });
        default: {
            const provider = ProviderRegistry.get(providerId);
            if (!provider) throw new Error('Account provider unavailable');
            return provider;
        }
    }
}
