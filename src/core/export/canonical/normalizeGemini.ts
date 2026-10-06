export {
    type GeminiNormalizationOptions,
    type GeminiNormalizationResult,
    normalizeGeminiConversation,
    GeminiNormalizer,
} from './gemini/normalizeConversation.js';
export { normalizeDomainConversation } from './gemini/normalizeDomainConversation.js';
export {
    geminiStructuredToContent as geminiStructuredToCanonical,
    convertGeminiInlines,
} from '../../provider/gemini/structuredContentAdapter.js';
