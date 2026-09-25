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

export interface GeminiLiveSaveTriggerPayload {
    cid: string;
    reason?: string;
    /** Forwarded verbatim to LiveSaveCoordinator.executeLiveSave as its options bag. */
    mockMode?: boolean;
}

