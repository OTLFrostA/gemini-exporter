// src/core/diagnostics/flightRecorder.ts - Cross-process in-memory flight recorder & event timeline
export interface FlightEvent {
    id: number;
    ts: number;
    isoTime: string;
    subsystem: 'content' | 'background' | 'workbench' | 'storage' | 'export';
    action: string;
    details?: Record<string, any>;
}

function sanitizeValue(val: any, depth = 0): any {
    if (depth > 3) return '[nested]';
    if (val === null || val === undefined) return val;
    if (typeof val === 'string') {
        if (val.length > 200) {
            return val.slice(0, 50) + `... [len:${val.length}]`;
        }
        return val;
    }
    if (typeof val === 'number' || typeof val === 'boolean') {
        return val;
    }
    if (Array.isArray(val)) {
        if (val.length > 10) {
            return [...val.slice(0, 5).map(v => sanitizeValue(v, depth + 1)), `... (${val.length - 5} more)`];
        }
        return val.map(v => sanitizeValue(v, depth + 1));
    }
    if (typeof val === 'object') {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(val)) {
            const lk = k.toLowerCase();
            if (lk.includes('token') || lk.includes('cred') || lk.includes('cookie') || lk.includes('secret') || lk.includes('snlm0e')) {
                out[k] = '[REDACTED]';
            } else {
                out[k] = sanitizeValue(v, depth + 1);
            }
        }
        return out;
    }
    return String(val);
}

class FlightRecorderImpl {
    private _events: FlightEvent[] = [];
    private _nextId = 1;
    private readonly MAX_ENTRIES = 300;

    public record(
        subsystem: 'content' | 'background' | 'workbench' | 'storage' | 'export',
        action: string,
        details?: Record<string, any>
    ): void {
        const now = Date.now();
        const entry: FlightEvent = {
            id: this._nextId++,
            ts: now,
            isoTime: new Date(now).toISOString(),
            subsystem,
            action,
            details: details ? sanitizeValue(details) : undefined
        };
        this._events.push(entry);
        if (this._events.length > this.MAX_ENTRIES) {
            this._events.shift();
        }
    }

    public getEntries(): FlightEvent[] {
        return this._events.slice();
    }

    public clear(): void {
        this._events = [];
    }
}

export const FlightRecorder = new FlightRecorderImpl();
export default FlightRecorder;
