import type { GeminiProviderContract } from "../core/provider/gemini/geminiContracts.js";

/**
 * Temporary compatibility for the current Gemini-dependent content consumers.
 * The production registry currently self-registers only Gemini. These consumers
 * still assume Gemini evidence; this alias is not a runtime capability guard and
 * must be removed when W2-04/05/06/07 migrate them to neutral data + explicit evidence.
 * Generic registry/resolver infrastructure must never depend on this alias.
 */
export type ApplicationProvider = GeminiProviderContract;
