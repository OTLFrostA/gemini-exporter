/**
 * src/core/export/canonical/json.ts
 * Canonical JSON value model and provider extension bag.
 *
 * Adapted from gemini-exporter-rendering-contract-v1 (canonical/src/json.ts),
 * v1.0.0-draft. See SOURCE.md for the source trace and adaptations.
 */

export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
    | JsonPrimitive
    | JsonValue[]
    | { [key: string]: JsonValue };

/**
 * Provider-specific data is allowed only in a namespaced JSON extension bag.
 * Example: { gemini: { candidateId: "..." } }
 */
export type ProviderExtensions = Record<string, JsonValue>;
