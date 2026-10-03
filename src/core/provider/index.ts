// Neutral lifecycle/data contracts and registry.
export * from "./aiProvider.js";
export * from "./providerRegistry.js";
// Explicitly named Gemini production adapter and companion evidence contracts.
// Domain types remain in src/types; they are not provider-neutral exports.
export * from "./gemini/geminiProvider.js";
export type * from "./gemini/geminiContracts.js";
