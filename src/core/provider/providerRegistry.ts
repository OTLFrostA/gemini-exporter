import type { AIProvider } from "./aiProvider.js";

export class ProviderRegistryClass {
    private providers: Map<string, AIProvider> = new Map();
    private defaultProviderId: string = 'gemini';

    register(provider: AIProvider): void {
        if (!provider || !provider.id) {
            throw new Error('Invalid provider: id is required');
        }
        const existing = this.providers.get(provider.id);
        if (existing && existing !== provider) {
            console.warn(
                `[ProviderRegistry] duplicate registration for id "${provider.id}": ` +
                `replacing "${existing.name}" with "${provider.name}"`
            );
        }
        this.providers.set(provider.id, provider);
    }

    unregister(id: string): boolean {
        return this.providers.delete(id);
    }

    get(id: string): AIProvider | undefined {
        return this.providers.get(id);
    }

    getAll(): AIProvider[] {
        return Array.from(this.providers.values());
    }

    setDefaultProviderId(id: string): void {
        if (!this.providers.has(id)) {
            throw new Error(`[ProviderRegistry] cannot set default provider to unregistered id "${id}"`);
        }
        this.defaultProviderId = id;
    }

    getDefault(): AIProvider | undefined {
        return this.providers.get(this.defaultProviderId);
    }

    findByUrl(url: string): AIProvider | undefined {
        if (!url) return undefined;
        for (const provider of this.providers.values()) {
            if (typeof provider.matchesUrl === 'function' && provider.matchesUrl(url)) {
                return provider;
            }
        }
        for (const provider of this.providers.values()) {
            if (typeof provider.matchesUrl === 'function') continue;
            if (Array.isArray(provider.hostPatterns)) {
                for (const pattern of provider.hostPatterns) {
                    if (this.matchPattern(pattern, url)) {
                        return provider;
                    }
                }
            }
        }
        return undefined;
    }

    /**
     * Helper to match wildcard host patterns (e.g. https://gemini.google.com/*)
     */
    private matchPattern(pattern: string, url: string): boolean {
        if (pattern === url) return true;
        try {
            const parsedUrl = new URL(url);
            if (pattern.startsWith('https://') || pattern.startsWith('http://')) {
                const cleanPattern = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
                const parsedPattern = new URL(cleanPattern.endsWith('/') ? cleanPattern : cleanPattern + '/');
                if (parsedUrl.origin === parsedPattern.origin) {
                    return parsedUrl.pathname.startsWith(parsedPattern.pathname);
                }
            }
        } catch {
            // Fallback for non-standard patterns
        }
        if (pattern.endsWith('/*')) {
            const prefix = pattern.slice(0, -1);
            return url.startsWith(prefix);
        }
        return false;
    }
}

export const ProviderRegistry = new ProviderRegistryClass();
export default ProviderRegistry;

declare global {
    var ProviderRegistry: ProviderRegistryClass;
}
if (typeof globalThis !== 'undefined') {
    (globalThis as any).ProviderRegistry = ProviderRegistry;
}
