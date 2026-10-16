import type { GeminiListRequestContext } from '../parsers/gemini/rpc/listRequest.js';
import type { AccountObservation } from '../domain/accountRegistry.js';
import { CrossWorldEvents, type CrossWorldEventType } from './protocol.js';

export { CrossWorldEvents, type CrossWorldEventType };

export interface GeminiCredentialsPayload {
    at: string;
    sid: string;
    bl: string;
    accountSlot: string;
    lastUsed: number;
    url: string;
    accountObservation?: AccountObservation;
}

export interface GeminiConversationDeletedPayload {
    id: string;
    slot: string;
}

export interface GeminiNetworkBatchexecutePayload {
    listRequest?: GeminiListRequestContext | null;
    truncated?: boolean;
    requestedAt?: number;
    /** Immutable Provider evidence captured at send time; ISOLATED resolves the Registry UUID. */
    requestAccountObservation: AccountObservation | null;
    text: string;
    slot: string;
    url: string;
}

export interface GeminiStreamStartPayload {
    id: string | null;
    slot: string;
}

export interface GeminiStreamCompletePayload {
    id: string | null;
    slot: string;
    url?: string;
}

export interface GeminiLiveSaveTriggerPayload {
    cid: string;
    reason?: string;
    mockMode?: boolean;
}

