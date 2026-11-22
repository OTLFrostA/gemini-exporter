import type { Account } from '../../../../l2/accountRegistry.js';

/** Captured once at send time, before the page can switch accounts or routes. */
export interface GeminiCaptureContext {
    url: string;
    slot: string;
    pagePath: string;
    requestedAt: number;
    requestAccountObservation: Omit<Account, 'id'> | null;
}

export interface GeminiResponseHandler {
    captureLimit: number;
    start(body: string): void;
    progress?(chunk: string): void;
    complete(body: string, text: string, truncated: boolean, successful: boolean): void;
    end(): void;
}
