import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Rule = { replacement?: string };

function parseJson(text: string, label: string): Json {
    try { return JSON.parse(text); }
    catch { throw new Error(`Invalid ${label} JSON`); }
}

function object(value: Json): value is Record<string, Json> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pointerPart(key: string): string { return key.replaceAll('~', '~0').replaceAll('/', '~1'); }

/** Preserve each Unicode scalar's UTF-8 and UTF-16 widths. Keep common markup punctuation. */
export function maskFixtureText(value: string): string {
    const syntax = /[\t\r\n `*_~$#>+|\[\](){}<\\/.,:;!?=\-]/u;
    return Array.from(value, char => {
        if (syntax.test(char)) return char;
        if (/^[\uD800-\uDFFF]$/u.test(char)) throw new Error('Cannot mask an unpaired surrogate');
        return ['x', 'ø', '文', '😀'][Buffer.byteLength(char) - 1];
    }).join('');
}

function redactor(planText: string) {
    const plan = parseJson(planText, 'redaction plan');
    if (!object(plan) || Object.keys(plan).some(key => key !== 'redact' && key !== 'aliases')
        || !Array.isArray(plan.redact) || (plan.aliases !== undefined && !object(plan.aliases))) {
        throw new Error('Expected a redact array and optional aliases map');
    }
    const rules = new Map<string, Rule>();
    for (const rule of plan.redact) {
        if (!object(rule) || typeof rule.pointer !== 'string'
            || !/^(?:\/(?:[^~]|~[01])*)?$/.test(rule.pointer)
            || Object.keys(rule).some(key => key !== 'pointer' && key !== 'replacement')
            || (rule.replacement !== undefined && typeof rule.replacement !== 'string') || rules.has(rule.pointer)) {
            throw new Error('Invalid or duplicate redaction rule');
        }
        rules.set(rule.pointer, { replacement: rule.replacement });
    }
    const aliases = new Map<string, string>();
    for (const [original, alias] of Object.entries(plan.aliases ?? {})) {
        if (typeof alias !== 'string' || !original || !alias || original === alias) throw new Error('Invalid identity alias');
        aliases.set(original, alias);
    }
    if (!rules.size && !aliases.size) throw new Error('Redaction plan is empty');
    if (new Set(aliases.values()).size !== aliases.size || [...aliases.values()].some(alias => aliases.has(alias))) {
        throw new Error('Aliases must be distinct and cannot chain');
    }
    const visited = new Set<string>();
    const usedAliases = new Set<string>();
    function rename(input: string): string {
        const alias = aliases.get(input);
        if (alias === undefined) return input;
        usedAliases.add(input);
        return alias;
    }
    function visit(value: Json, pointer: string): Json {
        const rule = rules.get(pointer);
        if (rule) {
            if (typeof value !== 'string') throw new Error('Redaction rule must select a string');
            visited.add(pointer);
            const replacement = rule.replacement ?? maskFixtureText(value);
            if (replacement === value && value) throw new Error('Redaction leaves a selected value unchanged');
            return replacement;
        }
        if (typeof value === 'string') return rename(value);
        if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
            throw new Error('Capture contains a number that cannot be replayed safely as JavaScript JSON');
        }
        if (Array.isArray(value)) return value.map((item, index) => visit(item, `${pointer}/${index}`));
        if (!object(value)) return value;
        const entries: [string, Json][] = [];
        const names = new Set<string>();
        for (const [key, item] of Object.entries(value)) {
            const renamed = rename(key);
            if (names.has(renamed)) throw new Error('Alias collides with an existing object key');
            names.add(renamed);
            entries.push([renamed, visit(item, `${pointer}/${pointerPart(key)}`)]);
        }
        return Object.fromEntries(entries);
    }
    return { visit, finish() {
        if (visited.size !== rules.size || usedAliases.size !== aliases.size) throw new Error('Redaction plan contains an unmatched rule or alias');
    } };
}

/** For SSE, JSON pointers are relative to an array of JSON data events. Heartbeats
 * and the literal [DONE] marker do not consume an index. Serialization normalizes LF. */
export function sanitizeProviderWire(input: string, plan: string, format: 'json' | 'sse'): string {
    const { visit, finish } = redactor(plan);
    if (format === 'json') {
        const json = parseJson(input, 'capture');
        if (!object(json) && !Array.isArray(json)) throw new Error('Expected an object or array capture');
        const result = visit(json, '');
        finish();
        return JSON.stringify(result, null, 2) + '\n';
    }
    const stream = input.replace(/\r\n?/g, '\n');
    if (!stream.endsWith('\n\n')) throw new Error('SSE capture ends in an incomplete event');
    const result: string[] = [];
    let index = 0;
    for (const frame of stream.split('\n\n')) {
        if (!frame.trim()) continue;
        const metadata: string[] = [];
        const data: string[] = [];
        for (const line of frame.split('\n')) {
            if (!line || line.startsWith(':')) continue; // comments can contain transport metadata
            const colon = line.indexOf(':');
            const name = colon < 0 ? line : line.slice(0, colon);
            const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
            if (name === 'data') data.push(value);
            else if (name === 'event' && /^[a-zA-Z0-9_.-]+$/.test(value)) metadata.push(`event: ${value}`);
            else if (name === 'retry' && /^\d+$/.test(value)) metadata.push(`retry: ${value}`);
            else throw new Error('Unsupported SSE field');
        }
        if (data.length) {
            const body = data.join('\n');
            if (body === '[DONE]') metadata.push('data: [DONE]');
            else {
                const json = parseJson(body, 'SSE event');
                if (!object(json) && !Array.isArray(json)) throw new Error('Expected a JSON object or array in SSE event');
                metadata.push(`data: ${JSON.stringify(visit(json, `/${index++}`))}`);
            }
        }
        if (metadata.length) result.push(metadata.join('\n'));
    }
    finish();
    return result.join('\n\n') + '\n\n';
}

if (require.main === module) {
    try {
        const { values, positionals } = parseArgs({ allowPositionals: true, options: {
            format: { type: 'string', default: 'json' },
            plan: { type: 'string' },
        } });
        if (positionals.length !== 2 || !values.plan || (values.format !== 'json' && values.format !== 'sse')) {
            throw new Error('Usage: sanitize_provider_wire.ts --format json|sse --plan PLAN INPUT OUTPUT');
        }
        const result = sanitizeProviderWire(readFileSync(positionals[0], 'utf8'), readFileSync(values.plan, 'utf8'), values.format);
        writeFileSync(positionals[1], result, { mode: 0o600, flag: 'wx' });
    } catch (error) {
        console.error(error instanceof Error ? error.message : 'Fixture preparation failed');
        process.exitCode = 1;
    }
}
