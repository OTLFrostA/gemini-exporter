import { DEFAULT_ACCOUNT_KEY, readAccount, readAccountParameters, type Account } from './accountRegistry.js';
import { sameConversationKey, type ConversationKey } from './conversationKey.js';
import { restoreConversationIndex, type ConversationIndex, type DomainConversationIndex } from './conversationIndex.js';
import type { ConversationDetail, DomainConversationDetail } from './conversationDetail.js';
import { restoreDomainDetail } from './runtimeValidation.js';

export const CLOUD_CONVERSATION_SCHEMA = 'gemini-exporter-cloud-conversation';
export const CLOUD_CONVERSATION_VERSION = 1;

/** Ephemeral synthetic v4 UUID used strictly inside L2 to run full schema + closure validation on device-agnostic payloads. */
const VALIDATION_PROBE_ACCOUNT_ID = '00000000-0000-4000-8000-000000000000';

export interface PortableCloudConversation {
    readonly schema: typeof CLOUD_CONVERSATION_SCHEMA;
    readonly version: typeof CLOUD_CONVERSATION_VERSION;
    readonly account: Omit<Account, 'id'>;
    readonly conversationId: ConversationKey['conversationId'];
    readonly index: Omit<DomainConversationIndex, 'key'>;
    /** Optional by design: omitted in privacy-minimal Index-only sync mode. */
    readonly detail?: Omit<DomainConversationDetail, 'key'>;
}

export interface PortableConversationSource {
    readonly index: ConversationIndex;
    readonly detail?: ConversationDetail;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Serialize a verified local Domain conversation (Index-only by default, or Index + Detail when opted in)
 * into a device-independent JSON string stripping the device-local random Account UUID.
 */
export function encodePortableCloudConversation(
    account: Readonly<Account>,
    conversation: PortableConversationSource,
): string {
    const verifiedAccount = readAccount(account);
    if (verifiedAccount.providerAccountId === DEFAULT_ACCOUNT_KEY) {
        throw new TypeError('Unidentified default placeholder accounts cannot be exported to cloud sync');
    }
    if (verifiedAccount.id !== conversation.index.key.accountId) {
        throw new TypeError('Cloud payload account or ConversationKey mismatch');
    }
    if (conversation.detail !== undefined && !sameConversationKey(conversation.index.key, conversation.detail.key)) {
        throw new TypeError('Cloud payload account or ConversationKey mismatch');
    }

    const verifiedIndex = restoreConversationIndex(conversation.index);
    const { id: _localAccountId, ...portableAccount } = verifiedAccount;
    const { key: _indexKey, ...portableIndex } = verifiedIndex;

    if (conversation.detail === undefined) {
        const indexOnlyPayload: PortableCloudConversation = {
            schema: CLOUD_CONVERSATION_SCHEMA,
            version: CLOUD_CONVERSATION_VERSION,
            account: portableAccount,
            conversationId: verifiedIndex.key.conversationId,
            index: portableIndex,
        };
        return JSON.stringify(indexOnlyPayload);
    }

    const verifiedDetail = restoreDomainDetail(conversation.detail);
    const { key: _detailKey, ...portableDetail } = verifiedDetail;
    const fullPayload: PortableCloudConversation = {
        schema: CLOUD_CONVERSATION_SCHEMA,
        version: CLOUD_CONVERSATION_VERSION,
        account: portableAccount,
        conversationId: verifiedIndex.key.conversationId,
        index: portableIndex,
        detail: portableDetail,
    };
    return JSON.stringify(fullPayload);
}

/**
 * Parse and validate an untrusted decrypted JSON string (supporting both Index-only and full Detail payloads)
 * through L2 Domain schema, table-grid bounds, durable-URI filter, and reference closure checks.
 */
export function decodePortableCloudConversation(jsonText: string): PortableCloudConversation {
    if (typeof jsonText !== 'string' || !jsonText) {
        throw new TypeError('Empty cloud conversation JSON');
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(jsonText);
    } catch {
        throw new TypeError('Malformed cloud conversation JSON');
    }
    if (!isPlainRecord(parsed)) {
        throw new TypeError('Invalid cloud conversation envelope object');
    }
    const allowedTopKeys = new Set(['schema', 'version', 'account', 'conversationId', 'index', 'detail']);
    if (Object.keys(parsed).some(k => !allowedTopKeys.has(k))) {
        throw new TypeError('Unexpected top-level field in cloud conversation payload');
    }
    if (parsed.schema !== CLOUD_CONVERSATION_SCHEMA || parsed.version !== CLOUD_CONVERSATION_VERSION) {
        throw new TypeError('Unsupported cloud conversation schema or version');
    }
    const accountParams = readAccountParameters(parsed.account);
    if (accountParams.providerAccountId === DEFAULT_ACCOUNT_KEY) {
        throw new TypeError('Cloud conversation payload cannot target default placeholder account');
    }
    if (typeof parsed.conversationId !== 'string'
        || !parsed.conversationId
        || parsed.conversationId !== parsed.conversationId.trim()) {
        throw new TypeError('Invalid cloud conversationId');
    }
    if (!isPlainRecord(parsed.index) || 'key' in parsed.index) {
        throw new TypeError('Invalid portable Index object');
    }

    const probeKey: ConversationKey = {
        accountId: VALIDATION_PROBE_ACCOUNT_ID,
        conversationId: parsed.conversationId,
    };
    const verifiedIndex = restoreConversationIndex({ ...parsed.index, key: probeKey });
    const { key: _ik, ...cleanIndex } = verifiedIndex;

    if (parsed.detail === undefined) {
        return {
            schema: CLOUD_CONVERSATION_SCHEMA,
            version: CLOUD_CONVERSATION_VERSION,
            account: accountParams,
            conversationId: parsed.conversationId,
            index: cleanIndex,
        };
    }

    if (!isPlainRecord(parsed.detail) || 'key' in parsed.detail) {
        throw new TypeError('Invalid portable Detail object');
    }
    const verifiedDetail = restoreDomainDetail({ ...parsed.detail, key: probeKey });
    const { key: _dk, ...cleanDetail } = verifiedDetail;

    return {
        schema: CLOUD_CONVERSATION_SCHEMA,
        version: CLOUD_CONVERSATION_VERSION,
        account: accountParams,
        conversationId: parsed.conversationId,
        index: cleanIndex,
        detail: cleanDetail,
    };
}
