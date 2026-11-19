import { applicationHost } from '../host.js';
import { OperationError, operationError } from '../../shared/errors/operationError.js';
import {
    deriveBlindRecordId,
    openUtf8Record,
    sealUtf8Record,
    type OpenOptions,
    type SealOptions,
    type VaultKeyring,
} from '../../shared/crypto/index.js';
import type { Account } from '../../l2/accountRegistry.js';
import {
    decodePortableCloudConversation,
    encodePortableCloudConversation,
    type PortableCloudConversation,
    type PortableConversationSource,
} from '../../l2/cloudPayload.js';
import { ingestDetail, ingestDetailsBatch, ingestIndexes } from '../../l2/ingestion.js';

export interface SealedCloudConversation {
    readonly blindRecordId: string;
    readonly envelope: Uint8Array<ArrayBuffer>;
}

/**
 * Bind the envelope to the key fingerprint rather than a backend's session identity.
 */
export function portableVaultSubject(keyring: VaultKeyring): string {
    return `vault:${keyring.keyFingerprint}`;
}

/**
 * Validate, strip device-local UUIDs, compress, and AEAD-seal a Domain conversation
 * (Index-only by default, or Index + Detail when opted in).
 */
export async function sealCloudConversation(options: {
    readonly keyring: VaultKeyring;
    readonly revision: number;
    readonly account: Readonly<Account>;
    readonly conversation: PortableConversationSource;
    readonly sealOptions?: SealOptions;
}): Promise<SealedCloudConversation> {
    let jsonText: string;
    try {
        jsonText = encodePortableCloudConversation(options.account, options.conversation);
    } catch (error) {
        throw operationError(error, 'CLOUD_PAYLOAD_INVALID');
    }
    const blindRecordId = await deriveBlindRecordId(
        options.keyring,
        options.account.providerId,
        options.account.providerAccountId,
        options.conversation.index.key.conversationId,
    );
    const envelope = await sealUtf8Record(
        options.keyring,
        jsonText,
        { ownerSubject: portableVaultSubject(options.keyring), blindRecordId, revision: options.revision },
        options.sealOptions,
    );
    return { blindRecordId, envelope };
}

/**
 * Authenticate, decrypt, bounded-decompress, schema-validate, and verify inner-identity
 * consistency against the outer `blindRecordId` to defeat intra-vault slot-swapping.
 */
export async function openCloudConversation(options: {
    readonly keyring: VaultKeyring;
    readonly blindRecordId: string;
    readonly revision: number;
    readonly envelope: Uint8Array;
    readonly openOptions?: OpenOptions;
}): Promise<PortableCloudConversation> {
    const jsonText = await openUtf8Record(
        options.keyring,
        options.envelope,
        { ownerSubject: portableVaultSubject(options.keyring), blindRecordId: options.blindRecordId, revision: options.revision },
        options.openOptions,
    );
    let portable: PortableCloudConversation;
    try {
        portable = decodePortableCloudConversation(jsonText);
    } catch (error) {
        throw operationError(error, 'CLOUD_PAYLOAD_INVALID');
    }
    const expectedBlindId = await deriveBlindRecordId(
        options.keyring,
        portable.account.providerId,
        portable.account.providerAccountId,
        portable.conversationId,
    );
    if (expectedBlindId !== options.blindRecordId) {
        throw new OperationError(
            'CLOUD_DECRYPT_AUTH_FAILED',
            'Decrypted conversation identity does not match outer blindRecordId',
        );
    }
    return portable;
}

export interface CloudRestoreSummary {
    readonly accepted: number;
    readonly changed: number;
    readonly rejected: number;
    readonly touchedAccountIds: readonly string[];
}

/**
 * Remap portable `(providerId, providerAccountId)` identities to this device's local Account UUIDs
 * and admit decrypted conversations (both Index-only and full Detail entries) through L2 merge rules.
 */
export async function restoreCloudConversationsToLocal(
    items: readonly PortableCloudConversation[],
    sliceSize = 25,
): Promise<CloudRestoreSummary> {
    if (items.length === 0) {
        return { accepted: 0, changed: 0, rejected: 0, touchedAccountIds: [] };
    }
    const groups = new Map<string, { accountParams: Omit<Account, 'id'>; entries: PortableCloudConversation[] }>();
    for (const item of items) {
        const subjectKey = JSON.stringify([item.account.providerId, item.account.providerAccountId]);
        const existing = groups.get(subjectKey);
        if (existing) existing.entries.push(item);
        else groups.set(subjectKey, { accountParams: item.account, entries: [item] });
    }

    let accepted = 0;
    let changed = 0;
    let rejected = 0;
    const touchedAccountIds: string[] = [];
    const batchSize = Math.max(1, Math.trunc(sliceSize));

    for (const { accountParams, entries } of groups.values()) {
        const localAccount = await applicationHost().getOrCreateAccount(
            accountParams.providerId,
            accountParams.providerAccountId,
            accountParams.email,
            accountParams.displayName,
        );
        touchedAccountIds.push(localAccount.id);

        const indexOnlyEntries: PortableCloudConversation[] = [];
        const withDetailEntries: Array<PortableCloudConversation & { detail: NonNullable<PortableCloudConversation['detail']> }> = [];
        for (const entry of entries) {
            if (entry.detail !== undefined) {
                withDetailEntries.push({ ...entry, detail: entry.detail });
            } else {
                indexOnlyEntries.push(entry);
            }
        }

        if (indexOnlyEntries.length > 0) {
            for (let offset = 0; offset < indexOnlyEntries.length; offset += 100) {
                const slice = indexOnlyEntries.slice(offset, offset + 100);
                const indexResult = await ingestIndexes(
                    localAccount.id,
                    slice.map(entry => ({
                        conversationId: entry.conversationId,
                        fields: entry.index,
                    })),
                );
                accepted += indexResult.accepted;
                rejected += indexResult.rejected;
                changed += indexResult.added + indexResult.updated;
            }
        }

        for (let offset = 0; offset < withDetailEntries.length; offset += batchSize) {
            const slice = withDetailEntries.slice(offset, offset + batchSize);
            const outcomes = slice.length === 1
                ? [await ingestDetail(
                    localAccount.id,
                    slice[0].conversationId,
                    slice[0].detail,
                    slice[0].index,
                )]
                : await ingestDetailsBatch(
                    localAccount.id,
                    slice.map(entry => ({
                        conversationId: entry.conversationId,
                        detail: entry.detail,
                        indexFields: entry.index,
                    })),
                );
            for (const outcome of outcomes) {
                if (outcome.accepted) accepted++;
                else rejected++;
                if (outcome.changed) changed++;
            }
        }
        applicationHost().notifyDomainChanged(localAccount.id);
    }

    return { accepted, changed, rejected, touchedAccountIds };
}
