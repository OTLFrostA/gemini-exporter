import { ProviderRegistry } from "./providerRegistry.js";
import type { ApplicationProvider } from "./gemini/geminiContracts.js";
// Providers self-register into ProviderRegistry on module evaluation; these
// side-effect imports keep the registry populated without the barrel entry.
import "./gemini/geminiProvider.js";

export function resolveProvider(): ApplicationProvider | undefined {
    const url = (typeof location !== "undefined" && location.href) || "";
    return ProviderRegistry.findByUrl(url) || ProviderRegistry.getDefault();
}
