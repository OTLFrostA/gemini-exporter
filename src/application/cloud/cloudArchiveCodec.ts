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
import type { ReadonlyDomain } from '../../l2/runtimeValidation.js';
import {
    decodePortableCloudConversation,
    encodePortableCloudConversation,
    type PortableCloudConversation,
} from '../../l2/cloudPayload.js';
import { ingestDetail, ingestDetailsBatch } from '../../l2/ingestion.js';
import { getOrCreateAccount } from '../../runtime/api/accountRegistry.js';
import { notifyDomainChanged } from '../../runtime/api/domainChanges.js';

export interface SealedCloudConversation {
    readonly blindRecordId: string;
    readonly envelope: Uint8Array<ArrayBuffer>;
}

/**
 * Validate, strip device-local UUIDs, compress, and AEAD-seal a Domain conversation
 * with strict AAD binding to `(ownerSubject, blindRecordId, revision)`.
 */
export async function sealCloudConversation(options: {
    readonly keyring: VaultKeyring;
    readonly ownerSubject: string;
    readonly revision: number;
    readonly account: Readonly<Account>;
    readonly conversation: ReadonlyDomain;
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
        { ownerSubject: options.ownerSubject, blindRecordId, revision: options.revision },
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
    readonly ownerSubject: string;
    readonly blindRecordId: string;
    readonly revision: number;
    readonly envelope: Uint8Array;
    readonly openOptions?: OpenOptions;
}): Promise<PortableCloudConversation> {
    const jsonText = await openUtf8Record(
        options.keyring,
        options.envelope,
        { ownerSubject: options.ownerSubject, blindRecordId: options.blindRecordId, revision: options.revision },
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
 * and admit decrypted conversations through L2's authoritative Index/Detail merge rules.
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
        const localAccount = await getOrCreateAccount(
            accountParams.providerId,
            accountParams.providerAccountId,
            accountParams.email,
            accountParams.displayName,
        );
        touchedAccountIds.push(localAccount.id);

        for (let offset = 0; offset < entries.length; offset += batchSize) {
            const slice = entries.slice(offset, offset + batchSize);
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
        notifyDomainChanged(localAccount.id);
    }

    return { accepted, changed, rejected, touchedAccountIds };
}
