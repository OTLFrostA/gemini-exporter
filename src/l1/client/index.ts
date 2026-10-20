// Provider acquisition capabilities and registry.
export * from "./aiProvider.js";
export * from "./providerRegistry.js";
// Explicitly named Gemini production adapter and companion evidence contracts.
// Domain admission and persistence contracts live in core/domain.
export * from "./gemini/geminiProvider.js";
export type * from "./gemini/geminiContracts.js";
// @unverified-provider-scaffold ChatGPT adapter is scaffold-only: exported but
// never auto-registered until 9222 live payloads verify list/detail/assets.
export * from "./chatgpt/chatgptProvider.js";
export * from "./chatgpt/chatgptAccess.js";
export type * from "../parsers/chatgpt/chatgptTypes.js";
