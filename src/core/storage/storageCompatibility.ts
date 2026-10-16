/** Storage-local contracts. Historical values are preserved, never repaired. */
type StoredPrimitive = string | number | boolean | null | undefined;
export type StoredValue = StoredPrimitive | StoredValue[] | StoredObject;
export interface StoredObject { [key: string]: StoredValue; }

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

// Invalid historical objects remain explicit alternatives. They are not a
// catch-all that erases the ordinary record's field contract.
type IncompatibleFields<Model, Keys extends keyof Model> = {
    [Key in Keys]-?: StoredObject & { [Field in Key]-?: Exclude<StoredValue, Model[Field]> }
}[Keys];
type ExportKeys = 'format' | 'exportedAt' | 'title' | 'messageCount' | 'files' | 'status' | 'hasFailedAssets';
type LegacyStoredExportRecord = IncompatibleFields<StoredExportRecord, ExportKeys>;
export type StoredExportRecordMap = Record<string, StoredExportRecord | LegacyStoredExportRecord | StoredPrimitive | StoredValue[]>;
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
function isStoredPrimitive(value: unknown): value is StoredPrimitive {
    return value === null || value === undefined || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
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
