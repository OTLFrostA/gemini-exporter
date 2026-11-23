/**
 * Lightweight, zero-dependency JSPB (JSON-serialized Protobuf) wire validation
 * primitives and named Gemini structured-content protocol constants.
 */

export { GEMINI_ANNOTATION_TYPES, GEMINI_NODE_TYPES } from '../shared/structuredTypes.js';

export const GEMINI_WIRE_STYLE_FLAGS: {
    readonly EMPHASIS: 1;
    readonly STRONG: 2;
    readonly INLINE_CODE: 3;
    readonly STRIKETHROUGH: 4;
} = {
    EMPHASIS: 1,
    STRONG: 2,
    INLINE_CODE: 3,
    STRIKETHROUGH: 4,
};

export const GEMINI_WIRE_NODE_SLOTS: {
    readonly EXTENSION_OR_ATTACHMENT: 0;
    readonly TEXT_BLOCK: 1;
    readonly LEGACY_ATTACHMENT: 2;
    readonly CODE_BLOCK: 3;
    readonly FLIGHT_CARD: 4;
    readonly BUSINESS_CARD: 5;
    readonly MAP_CARD: 6;
    readonly FINANCE_CARD: 8;
    readonly IMAGEN_PANEL: 9;
    readonly TABLE: 10;
    readonly UNORDERED_LIST: 11;
    readonly ORDERED_LIST: 12;
    readonly COMPOSITE_TEXT: 13;
    readonly LEGACY_BLOCKQUOTE: 15;
    readonly BLOCKQUOTE: 16;
    readonly THEMATIC_BREAK: 19;
    readonly LINE_BREAK: 23;
    readonly DOCUMENT_CHIP: 24;
    readonly RESEARCH_PLAN: 27;
    readonly MAIL_CARD: 30;
    readonly SOURCE_REFERENCE: 31;
    readonly MATH_BLOCK: 34;
} = {
    EXTENSION_OR_ATTACHMENT: 0,
    TEXT_BLOCK: 1,
    LEGACY_ATTACHMENT: 2,
    CODE_BLOCK: 3,
    FLIGHT_CARD: 4,
    BUSINESS_CARD: 5,
    MAP_CARD: 6,
    FINANCE_CARD: 8,
    IMAGEN_PANEL: 9,
    TABLE: 10,
    UNORDERED_LIST: 11,
    ORDERED_LIST: 12,
    COMPOSITE_TEXT: 13,
    LEGACY_BLOCKQUOTE: 15,
    BLOCKQUOTE: 16,
    THEMATIC_BREAK: 19,
    LINE_BREAK: 23,
    DOCUMENT_CHIP: 24,
    RESEARCH_PLAN: 27,
    MAIL_CARD: 30,
    SOURCE_REFERENCE: 31,
    MATH_BLOCK: 34,
};

export function isWireArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}

export function isWireRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Narrow to a JSPB tuple whose trailing slots past `maxLength` are nullish. */
export function isBoundedTuple(value: unknown, maxLength: number): value is unknown[] {
    return Array.isArray(value) && value.slice(maxLength).every(item => item == null);
}

/** Validate that `tuple` has no non-nullish sibling slots other than `slot`. */
export function isExclusiveSlot(tuple: readonly unknown[], slot: number): boolean {
    return tuple.every((value, index) => value == null || index === slot);
}

/** Extract the single populated protobuf oneof slot, or null if zero/multiple slots are active. */
export function singleWireSlot(tuple: readonly unknown[]): { slot: number; payload: unknown } | null {
    let activeSlot = -1;
    for (let i = 0; i < tuple.length; i++) {
        if (tuple[i] != null) {
            if (activeSlot !== -1) return null;
            activeSlot = i;
        }
    }
    return activeSlot === -1 ? null : { slot: activeSlot, payload: tuple[activeSlot] };
}

export function isNonNegativeSafeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isPositiveSafeInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

export function isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

export function isOptionalString(value: unknown): value is string | null | undefined {
    return value == null || typeof value === 'string';
}

export function isHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        const protocol = new URL(value).protocol;
        return protocol === 'https:' || protocol === 'http:';
    } catch {
        return false;
    }
}

export function isHttpsUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    try {
        return new URL(value).protocol === 'https:';
    } catch {
        return false;
    }
}

/** Validate a record that owns only a single expected extension key (e.g. '39', '133', '1144'). */
export function singleExtensionPayload(value: unknown, extensionKey: string): unknown {
    if (!isWireRecord(value)) return undefined;
    const keys = Object.keys(value);
    return keys.length === 1 && keys[0] === extensionKey ? value[extensionKey] : undefined;
}
