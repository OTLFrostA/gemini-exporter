import { GeminiProtocol } from '../../../protocol/gemini/protocol.js';
import { robustFirstPayload } from './extractors.js';
import { extractInnerPayload, type InnerPayloadDiscoveryResult } from './payload.js';

/** One transport decode per acquisition. Raw wire values stay inside L1. */
export class GeminiResponseEnvelope {
    readonly top: unknown[] | null;
    private readonly byRpc = new Map<string, unknown[][]>();
    private readonly payloads = new Map<string, InnerPayloadDiscoveryResult>();

    constructor(readonly text: string) {
        this.top = robustFirstPayload(text);
        for (const raw of this.top ?? []) {
            if (!Array.isArray(raw)) continue;
            const row: unknown[] = raw;
            if (row[0] !== GeminiProtocol.WRB || typeof row[1] !== 'string') continue;
            const rows = this.byRpc.get(row[1]) ?? [];
            rows.push(row);
            this.byRpc.set(row[1], rows);
        }
    }

    rows(rpcId: string): unknown[][] {
        return this.byRpc.get(rpcId) ?? [];
    }

    private rpcIds(): string[] {
        return [...this.byRpc.keys()];
    }

    /**
     * Produce a concise, structured diagnostic summary of a failed Detail batchexecute response:
     * lists all observed RPC IDs, inspects `hNvQHb` payload/error slots (including BardErrorInfo codes),
     * and notes any `MaZiqc` error slot instead of blindly slicing the leading `MaZiqc` bytes.
     */
    summarizeDetailFailure(
        errMsg: string,
        meta: { httpStatus?: number; detailOnly?: boolean; paged?: boolean },
    ): string {
        const parts: string[] = [];
        if (meta.httpStatus !== undefined) parts.push(`http=${meta.httpStatus}`);
        if (meta.detailOnly !== undefined) parts.push(`detailOnly=${meta.detailOnly}`);
        if (meta.paged !== undefined) parts.push(`paged=${meta.paged}`);

        const rpcs = this.rpcIds();
        parts.push(`rpcs=[${rpcs.join(',')}]`);

        const formatErrorSlot = (slot: unknown, maxLen: number): string | null => {
            if (slot == null) return null;
            try {
                const raw = JSON.stringify(slot);
                return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
            } catch {
                return String(slot).slice(0, maxLen);
            }
        };

        const detailRpc = GeminiProtocol.RPCS.DETAIL;
        const detailRows = this.rows(detailRpc);
        if (detailRows.length === 0) {
            parts.push(`${detailRpc}=missing`);
        } else {
            const rowSummaries = detailRows.slice(0, 3).map((row) => {
                const payload = row[2];
                const payloadDesc = payload == null
                    ? 'null'
                    : typeof payload === 'string'
                        ? `str(${payload.length})`
                        : typeof payload;
                const errSlot = formatErrorSlot(row[5], 220);
                const tokens = [`payload=${payloadDesc}`];
                if (errSlot) tokens.push(`err=${errSlot}`);
                else if (typeof payload === 'string' && payload.length > 0) {
                    const preview = payload.replace(/\s+/g, ' ').slice(0, 120);
                    tokens.push(`preview=${preview}`);
                }
                return tokens.join(' ');
            });
            parts.push(`${detailRpc}(rows=${detailRows.length} ${rowSummaries.join('; ')})`);
        }

        const listRpc = GeminiProtocol.RPCS.LIST;
        const listErrors = this.rows(listRpc)
            .map(row => formatErrorSlot(row[5], 160))
            .filter((entry): entry is string => entry !== null);
        if (listErrors.length > 0) {
            parts.push(`${listRpc}.err=${listErrors[0]}`);
        }

        if (rpcs.length === 0 && this.text.length > 0) {
            parts.push(`raw=${this.text.replace(/\s+/g, ' ').slice(0, 140)}`);
        }

        if (errMsg) parts.push(`parse=${errMsg}`);
        return parts.join(' | ');
    }

    /** A known WRB envelope may never fall back to another RPC's payload.
     * Headerless historical captures retain the existing drift recovery. */
    scope(rpcId: string): unknown[] | null {
        return this.byRpc.size ? this.rows(rpcId) : this.top;
    }

    payload(rpcId: string): InnerPayloadDiscoveryResult {
        let payload = this.payloads.get(rpcId);
        if (!payload) {
            payload = extractInnerPayload(this.scope(rpcId), {
                wrb: GeminiProtocol.WRB, rpcId,
                ...(rpcId === GeminiProtocol.RPCS.DETAIL ? {
                    heuristicFilter: (s: string) => /c_[a-zA-Z0-9_-]{8,64}/.test(s) || s.includes('rc_') || s.startsWith('[['),
                } : {}),
            });
            this.payloads.set(rpcId, payload);
        }
        return payload;
    }
}

export function geminiResponse(input: string | GeminiResponseEnvelope): GeminiResponseEnvelope {
    return typeof input === 'string' ? new GeminiResponseEnvelope(input) : input;
}
