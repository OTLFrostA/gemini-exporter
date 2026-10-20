import type { GeminiListRequestContext } from '../../parsers/gemini/rpc/listRequest.js';
import type { Account } from '../../../l2/accountRegistry.js';
import { CrossWorldEvents, type CrossWorldEventType } from './protocol.js';

export { CrossWorldEvents, type CrossWorldEventType };

export interface GeminiCredentialsPayload {
    at: string;
    sid: string;
    bl: string;
    accountSlot: string;
    lastUsed: number;
    url: string;
    accountObservation?: Omit<Account, 'id'>;
}

export interface GeminiConversationDeletedPayload {
    url: string;
    requestBody: string;
    responseText: string;
    requestAccountObservation: Omit<Account, 'id'> | null;
    id: string;
    slot: string;
}

export interface GeminiNetworkBatchexecutePayload {
    listRequest?: GeminiListRequestContext;
    detailRequest?: import('../../parsers/gemini/rpc/detailRequest.js').GeminiDetailRequestContext;
    truncated: boolean;
    requestedAt: number;
    /** Immutable Provider evidence captured at send time; ISOLATED resolves the Registry UUID. */
    requestAccountObservation: Omit<Account, 'id'> | null;
    text: string;
    slot: string;
    url: string;
}

export interface GeminiStreamStartPayload {
    requestAccountObservation: Omit<Account, 'id'> | null;
    id: string | null;
    slot: string;
}

export interface GeminiStreamCompletePayload {
    requestAccountObservation: Omit<Account, 'id'> | null;
    id: string | null;
    slot: string;
    url?: string;
}

export interface GeminiLiveSaveTriggerPayload {
    cid: string;
    reason?: string;
    mockMode?: boolean;
}

