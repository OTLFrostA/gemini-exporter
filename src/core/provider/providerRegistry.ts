/**
 * src/core/provider/providerRegistry.ts
 * Central registry for AI providers.
 * Manages runtime provider registration, lookup by identifier,
 * and URL-based automatic provider resolution.
 */
import type { AIProvider } from "./aiProvider.js";

export class ProviderRegistryClass {
    private providers: Map<string, AIProvider> = new Map();
    private defaultProviderId: string = 'gemini';

    /**
     * Register a new AI provider.
     * P1-078: re-registering the SAME instance is a silent no-op; registering
     * a DIFFERENT instance under an occupied id warns loudly instead of
     * silently overwriting — two provider modules (or a test double) fighting
     * over one id must never have import order decide the winner invisibly.
     */
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

    /**
     * Unregister a provider by ID
     */
    unregister(id: string): boolean {
        return this.providers.delete(id);
    }

    /**
     * Get a provider by its unique ID
     */
    get(id: string): AIProvider | undefined {
        return this.providers.get(id);
    }

    /**
     * Get all registered providers
     */
    getAll(): AIProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Set the fallback default provider ID.
     * P1-079: fail fast on an unregistered id — previously this silently
     * stored a dangling id and getDefault() returned undefined, crashing
     * callers on `.listConversations()`.
     */
    setDefaultProviderId(id: string): void {
        if (!this.providers.has(id)) {
            throw new Error(`[ProviderRegistry] cannot set default provider to unregistered id "${id}"`);
        }
        this.defaultProviderId = id;
    }

    /**
     * Get the fallback default provider
     */
    getDefault(): AIProvider | undefined {
        return this.providers.get(this.defaultProviderId);
    }

    /**
     * Find matching provider by page URL.
     * P1-080: a provider that defines matchesUrl() gets the final word for
     * its own URLs — an explicit `false` is a deliberate refusal and must
     * NOT be overruled by a broader hostPatterns fallback. hostPatterns are
     * only consulted for providers without an explicit matcher, which also
     * removes the old registration-order dependence between the two passes.
     */
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
