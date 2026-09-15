/**
 * src/types/errors.ts
 * Structured error class hierarchy for Gemini Exporter runtime and pipelines.
 */

import { isRateLimited } from '../core/engine/export/rateLimiter.js';

export class GeminiError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GeminiError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class GeminiRpcError extends GeminiError {
    statusCode?: number;
    rpcName?: string;
    isRateLimit?: boolean;

    constructor(message: string, statusCode?: number, rpcName?: string) {
        super(message);
        this.name = 'GeminiRpcError';
        this.statusCode = statusCode;
        this.rpcName = rpcName;
        // Converged on the canonical rate-limit predicate so its semantics
        // cannot drift from the export pipeline's (see rateLimiter.ts).
        this.isRateLimit = isRateLimited({ success: false, status: statusCode, error: message });
    }
}

export class ExportPipelineError extends GeminiError {
    chatId?: string;
    step?: 'init' | 'fetch' | 'format' | 'write' | 'asset' | 'package';
    isPermissionRevoked?: boolean;

    constructor(message: string, chatId?: string, step?: 'init' | 'fetch' | 'format' | 'write' | 'asset' | 'package', isPermissionRevoked: boolean = false) {
        super(message);
        this.name = 'ExportPipelineError';
        this.chatId = chatId;
        this.step = step;
        this.isPermissionRevoked = isPermissionRevoked;
    }
}

export class TakeoutParseError extends GeminiError {
    formatDrift?: boolean;
    entryName?: string;

    constructor(message: string, formatDrift: boolean = false, entryName?: string) {
        super(message);
        this.name = 'TakeoutParseError';
        this.formatDrift = formatDrift;
        this.entryName = entryName;
    }
}

export class StorageError extends GeminiError {
    operation?: string;
    key?: string;

    constructor(message: string, operation?: string, key?: string) {
        super(message);
        this.name = 'StorageError';
        this.operation = operation;
        this.key = key;
    }
}
