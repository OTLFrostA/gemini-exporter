import type { DomainConversationDetail } from '../../domain/conversationDetail.js';
import type { ResourceAcquisitionHints } from '../../parsers/shared/resources/resourceAcquisitionHints.js';

export const DOMAIN_STORAGE_VERSION = 2;
export const DOMAIN_CONTRACT_VERSION = 1;
export const DOMAIN_DB_NAME = 'gemini_exporter_domain';
export const DOMAIN_DB_VERSION = 1;

/** Storage identity includes the account; provider IDs and conversation IDs are opaque. */
export interface DomainStorageIdentity { providerId: string; accountSlot: string; conversationId: string }
/** Acquired/archive bytes are durable acquisition context, never semantic Domain fields. */
export interface StoredDomainResource { assetId: string; bytes: Uint8Array; sourcePath?: string }
export interface DomainStorageRecord {
    key: string;
    storageVersion: typeof DOMAIN_STORAGE_VERSION;
    domainVersion: typeof DOMAIN_CONTRACT_VERSION;
    identity: DomainStorageIdentity;
    origin: 'source' | 'legacy-storage';
    revision: string;
    savedAt: number;
    conversation: DomainConversationDetail;
    acquisitionHints: ResourceAcquisitionHints;
    resources: StoredDomainResource[];
}
export interface DomainMigrationIssue { key: string; code: string; message: string }
export interface DomainMigrationReport { converted: number; issues: DomainMigrationIssue[] }
