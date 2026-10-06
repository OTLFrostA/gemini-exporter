export {
    type GeminiNormalizationOptions,
    type GeminiNormalizationResult,
    normalizeGeminiConversation,
    GeminiNormalizer,
} from './gemini/normalizeConversation.js';
export { normalizeDomainConversation } from './gemini/normalizeDomainConversation.js';
export {
    geminiStructuredToCanonical,
    convertGeminiInlines,
} from './gemini/structuredAdapter.js';
