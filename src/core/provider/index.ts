// Neutral lifecycle/data contracts and registry.
export * from "./aiProvider.js";
export * from "./providerRegistry.js";
// Explicitly named Gemini production adapter and companion evidence contracts.
// Domain contracts live in core/domain; lifecycle contracts still serve the legacy sync/storage path.
export * from "./gemini/geminiProvider.js";
export type * from "./gemini/geminiContracts.js";
