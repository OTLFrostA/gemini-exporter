/** Storage-local contracts. Historical values are preserved, never repaired. */
type StoredPrimitive = string | number | boolean | null | undefined;
export type StoredValue = StoredPrimitive | StoredValue[] | StoredObject;
export interface StoredObject { [key: string]: StoredValue; }

export interface StoredConversation extends StoredObject {
    id?: string | number | null;
    title?: string;
    titleSource?: string;
    titles?: Record<string, string | undefined>;
    timestamp?: StoredValue;
    updatedAt?: StoredValue;
    createdAt?: StoredValue;
    chatTime?: StoredValue;
    lastSeen?: StoredValue;
    messageCount?: number;
    messages?: StoredValue;
    turns?: StoredValue;
    url?: string;
    href?: string;
    source?: string;
    isTakeoutOnly?: boolean;
    hitGoogleLimit?: boolean;
}

export interface StoredExportRecord extends StoredObject {
    format?: string;
    exportedAt?: number | string;
    chatTime?: StoredValue;
    title?: string;
    messageCount?: number;
    files?: string[];
    status?: string;
    hasFailedAssets?: boolean;
}

export interface StoredAccountSlot extends StoredObject {
    email?: string;
    name?: string;
    slot?: string;
    accountId?: string;
    gaiaId?: string;
    count?: number;
    lastSync?: number | string;
}

// Invalid historical objects remain explicit alternatives. They are not a
// catch-all that erases the ordinary record's field contract.
type IncompatibleFields<Model, Keys extends keyof Model> = {
    [Key in Keys]-?: StoredObject & { [Field in Key]-?: Exclude<StoredValue, Model[Field]> }
}[Keys];
type ConversationKeys = 'id' | 'title' | 'titleSource' | 'titles' | 'messageCount' | 'url' | 'href' | 'source' | 'isTakeoutOnly' | 'hitGoogleLimit';
type ExportKeys = 'format' | 'exportedAt' | 'title' | 'messageCount' | 'files' | 'status' | 'hasFailedAssets';
type SlotKeys = 'email' | 'name' | 'slot' | 'accountId' | 'gaiaId' | 'count' | 'lastSync';
type LegacyStoredConversation = IncompatibleFields<StoredConversation, ConversationKeys>;
type LegacyStoredExportRecord = IncompatibleFields<StoredExportRecord, ExportKeys>;
type LegacyStoredAccountSlot = IncompatibleFields<StoredAccountSlot, SlotKeys>;
export type StoredConversationFields = StoredConversation | LegacyStoredConversation;
export type StoredConversationRow = StoredConversationFields | StoredPrimitive | StoredValue[];
export type StoredExportRecordMap = Record<string, StoredExportRecord | LegacyStoredExportRecord | StoredPrimitive | StoredValue[]>;
export type StoredAccountSlotMap = Record<string, StoredAccountSlot | LegacyStoredAccountSlot | StoredPrimitive | StoredValue[]>;
export interface StoredSyncStatus { timestamp: StoredValue; count: StoredValue; }

/** Validate the storage value capability, not a complete domain record. */
function isStoredValue(value: unknown): value is StoredValue {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.every(isStoredValue);
    return typeof value === 'object' && Object.values(value).every(isStoredValue);
}

export function readStoredValue(value: unknown): StoredValue {
    if (!isStoredValue(value)) throw new TypeError('Non-serializable storage value');
    return value;
}

export function isStoredObject(value: unknown): value is StoredObject {
    return typeof value === 'object' && value !== null && Object.values(value).every(isStoredValue);
}

export function readStoredObject(value: unknown): StoredObject {
    if (!isStoredObject(value)) throw new TypeError('Expected a stored object');
    return value;
}

function optionalStrings(value: StoredObject, keys: string[]): boolean {
    return keys.every(key => value[key] === undefined || typeof value[key] === 'string');
}
function optionalNumber(value: StoredValue): boolean {
    return value === undefined || typeof value === 'number';
}
function optionalBoolean(value: StoredValue): boolean {
    return value === undefined || typeof value === 'boolean';
}
function isRecordContainer(value: unknown): value is StoredObject {
    return isStoredObject(value) && !Array.isArray(value);
}
function isStoredConversation(value: unknown): value is StoredConversation {
    return isRecordContainer(value)
        && (value.id === undefined || value.id === null || typeof value.id === 'string' || typeof value.id === 'number')
        && optionalStrings(value, ['title', 'titleSource', 'url', 'href', 'source'])
        && optionalNumber(value.messageCount)
        && optionalBoolean(value.isTakeoutOnly) && optionalBoolean(value.hitGoogleLimit)
        && (value.titles === undefined || (isRecordContainer(value.titles)
            && Object.values(value.titles).every(title => title === undefined || typeof title === 'string')));
}
function isLegacyStoredConversation(value: unknown): value is LegacyStoredConversation {
    return isRecordContainer(value) && !isStoredConversation(value);
}
export function readStoredConversationFields(value: unknown): StoredConversationFields {
    if (isStoredConversation(value) || isLegacyStoredConversation(value)) return value;
    throw new TypeError('Expected stored conversation fields');
}
function isStoredPrimitive(value: unknown): value is StoredPrimitive {
    return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
export function isStoredConversationRow(value: unknown): value is StoredConversationRow {
    return isStoredPrimitive(value) || (Array.isArray(value) && value.every(isStoredValue))
        || isStoredConversation(value) || isLegacyStoredConversation(value);
}
function isStoredExportRecord(value: unknown): value is StoredExportRecord {
    return isRecordContainer(value) && optionalStrings(value, ['format', 'title', 'status'])
        && (value.exportedAt === undefined || typeof value.exportedAt === 'string' || typeof value.exportedAt === 'number')
        && optionalNumber(value.messageCount) && optionalBoolean(value.hasFailedAssets)
        && (value.files === undefined || (Array.isArray(value.files) && value.files.every(file => typeof file === 'string')));
}
function isLegacyStoredExportRecord(value: unknown): value is LegacyStoredExportRecord {
    return isRecordContainer(value) && !isStoredExportRecord(value);
}
function isStoredExportEntry(value: unknown): value is StoredExportRecordMap[string] {
    return isStoredPrimitive(value) || (Array.isArray(value) && value.every(isStoredValue))
        || isStoredExportRecord(value) || isLegacyStoredExportRecord(value);
}
function isStoredExportMap(value: unknown): value is StoredExportRecordMap {
    return typeof value === 'object' && value !== null && Object.values(value).every(isStoredExportEntry);
}
export function readStoredExportMap(value: unknown): StoredExportRecordMap {
    if (!isStoredExportMap(value)) throw new TypeError('Expected stored export records');
    return value;
}
function isStoredAccountSlot(value: unknown): value is StoredAccountSlot {
    return isRecordContainer(value) && optionalStrings(value, ['email', 'name', 'slot', 'accountId', 'gaiaId'])
        && optionalNumber(value.count)
        && (value.lastSync === undefined || typeof value.lastSync === 'string' || typeof value.lastSync === 'number');
}
function isLegacyStoredAccountSlot(value: unknown): value is LegacyStoredAccountSlot {
    return isRecordContainer(value) && !isStoredAccountSlot(value);
}
function isStoredSlotEntry(value: unknown): value is StoredAccountSlotMap[string] {
    return isStoredPrimitive(value) || (Array.isArray(value) && value.every(isStoredValue))
        || isStoredAccountSlot(value) || isLegacyStoredAccountSlot(value);
}
function isStoredSlotMap(value: unknown): value is StoredAccountSlotMap {
    return typeof value === 'object' && value !== null && Object.values(value).every(isStoredSlotEntry);
}
export function readStoredSlotMap(value: unknown): StoredAccountSlotMap {
    if (!isStoredSlotMap(value)) throw new TypeError('Expected stored account slots');
    return value;
}
