import type { AIProvider } from "./aiProvider.js";

export class ProviderRegistryClass<TProvider extends AIProvider = AIProvider> {
    private providers: Map<string, TProvider> = new Map();

    register(provider: TProvider): void {
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

    get(id: string): TProvider | undefined {
        return this.providers.get(id);
    }
}

export const ProviderRegistry = new ProviderRegistryClass();
