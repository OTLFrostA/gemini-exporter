export const DOMAIN_DB_NAME = 'gemini_exporter_v2';
export const DOMAIN_DB_VERSION = 1;
export const ACCOUNT_STORE = 'accounts';

export interface DomainStorageIdentity { providerId: string; accountId: string; conversationId: string }
/** Acquisition context only, never part of a persisted Detail. */
export interface StoredDomainResource { assetId: string; bytes: Uint8Array; sourcePath?: string }
