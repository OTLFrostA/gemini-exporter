export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
    | JsonPrimitive
    | JsonValue[]
    | { [key: string]: JsonValue };

export type ProviderExtensions = Record<string, JsonValue>;
