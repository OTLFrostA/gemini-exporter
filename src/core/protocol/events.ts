// src/core/protocol/events.ts - Cross-World and Inter-process event constants and payload contracts
import { CrossWorldEvents, type CrossWorldEventType } from './protocol.js';

export { CrossWorldEvents, type CrossWorldEventType };

export interface GeminiCredentialsPayload {
    at: string;
    sid: string;
    bl: string;
    accountSlot: string;
    lastUsed: number;
    url: string;
}

export interface GeminiConversationDeletedPayload {
    id: string;
    slot: string;
}

export interface GeminiNetworkBatchexecutePayload {
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

// P1-084: explicit contract instead of `[key: string]: any`. The handler
// (messageBridge) destructures { cid, reason, ...options } and forwards the
// rest verbatim to LiveSaveCoordinator.executeLiveSave(cid, reason, options),
// whose options bag is { mockMode?: boolean } — those are the only real
// fields on this cross-world channel. Unknown extra fields are now a
// compile-time error at the sender instead of silently-typed `any`.
export interface GeminiLiveSaveTriggerPayload {
    cid: string;
    reason?: string;
    /** Forwarded verbatim to LiveSaveCoordinator.executeLiveSave as its options bag. */
    mockMode?: boolean;
}

export interface CrossWorldEventMap {
    [CrossWorldEvents.CREDENTIALS]: GeminiCredentialsPayload;
    [CrossWorldEvents.CONVERSATION_DELETED]: GeminiConversationDeletedPayload;
    [CrossWorldEvents.NETWORK_BATCHEXECUTE]: GeminiNetworkBatchexecutePayload;
    [CrossWorldEvents.STREAM_START]: GeminiStreamStartPayload;
    [CrossWorldEvents.STREAM_COMPLETE]: GeminiStreamCompletePayload;
    [CrossWorldEvents.LIVE_SAVE_TRIGGER]: GeminiLiveSaveTriggerPayload;
}
