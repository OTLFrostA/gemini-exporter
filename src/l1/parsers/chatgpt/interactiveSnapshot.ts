/** Read a bounded JSON-like literal subset; never evaluate provider JavaScript. */
type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };
function literalAt(source: string, start: number): Literal | undefined {
    let at = start, budget = 5000;
    const space = () => { while (/\s/.test(source[at] ?? '') && at < source.length) at++; };
    const read = (depth: number): Literal => {
        if (depth > 24 || --budget < 0) throw new Error('Literal limit');
        space();
        if (source[at] === '"') {
            const begin = at++;
            while (at < source.length) {
                if (source[at] === '\\') { at += 2; continue; }
                if (source[at++] === '"') return JSON.parse(source.slice(begin, at)) as string;
            }
            throw new Error('Unterminated string');
        }
        if (source[at] === '[') {
            at++; const items: Literal[] = []; space();
            while (source[at] !== ']') {
                items.push(read(depth + 1)); space();
                if (source[at] !== ',') break;
                at++; space();
            }
            if (source[at++] !== ']') throw new Error('Invalid array');
            return items;
        }
        if (source[at] === '{') {
            at++; const record: Record<string, Literal> = Object.create(null) as Record<string, Literal>; space();
            while (source[at] !== '}') {
                const quoted = source[at] === '"';
                const key = quoted ? read(depth + 1) : /^[A-Za-z_$][\w$]*/.exec(source.slice(at))?.[0];
                if (typeof key !== 'string') throw new Error('Invalid key');
                if (!quoted) at += key.length;
                space(); if (source[at++] !== ':') throw new Error('Invalid object');
                record[key] = read(depth + 1); space();
                if (source[at] !== ',') break;
                at++; space();
            }
            if (source[at++] !== '}') throw new Error('Invalid object');
            return record;
        }
        const token = /^(?:true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(at))?.[0];
        if (!token) throw new Error('Nonliteral expression');
        at += token.length;
        return JSON.parse(token) as number | boolean | null;
    };
    try {
        const result = read(0); space();
        // A literal followed by a call/member/operator is not a static binding.
        return /^[;}]/.test(source.slice(at)) ? result : undefined;
    } catch { return undefined; }
}

function stringsOf(value: Literal): string[] {
    if (typeof value === 'string') return [value];
    if (!value || typeof value !== 'object') return [];
    return Object.values(value).flatMap(item => stringsOf(item));
}
function escapeText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/[\[\]`*_<>]/g, '\\$&').replace(/\r?\n/g, ' ');
}

export interface ChatGPTInteractiveSnapshot {
    text: string;
    /** Missing a usable textual source, not missing an executable UI. */
    incomplete: boolean;
    representation: 'provider-fallback' | 'source-text' | 'literal-recovery' | 'unavailable';
    interactive: boolean;
    recoveredStrings: number;
}

/** Preserve the official textual representation independently of UI execution.
 * Some fallbacks omit loop-generated labels; bounded literal recovery supplements
 * them, but does not claim to reproduce handlers, selections or conditional state. */
export function chatGPTInteractiveSnapshot(raw: string, fallback?: string): ChatGPTInteractiveSnapshot {
    if (!raw.trim() && !fallback?.trim()) return {
        text: '> Interactive content unavailable: no static source or Markdown fallback was provided.', incomplete: true,
        representation: 'unavailable', interactive: true, recoveredStrings: 0,
    };
    const hasFallback = !!fallback?.trim();
    const interactive = /\{@body|\{#(?:each|if)\b|<(?:radio(?:-group)?|checkbox(?:-group)?|button|select|input)\b/.test(raw);
    if (!interactive) return { text: hasFallback ? (fallback ?? '') : raw, incomplete: false,
        representation: hasFallback ? 'provider-fallback' : 'source-text', interactive: false, recoveredStrings: 0 };
    const text = fallback?.trim() ? fallback : '';
    const recovered: string[] = [];
    let recoveredStrings = 0;
    if (raw.length <= 1_000_000) {
        for (const declaration of raw.matchAll(/\{@body\s+(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*/g)) {
            // Do not turn unrelated configuration arrays into visible content.
            const binding = declaration[1].replace(/[$]/g, '\\$&');
            if (!new RegExp('\\{#each\\s+' + binding + '\\s+as\\b').test(raw)) continue;
            const value = literalAt(raw, declaration.index + declaration[0].length);
            if (!Array.isArray(value)) continue;
            for (const item of value) {
                const labels = stringsOf(item).filter(label => label.trim() && !text.includes(label));
                recoveredStrings += labels.length;
                if (labels.length) recovered.push(labels.map((label, i) => `${i ? '  ' : ''}- ${escapeText(label)}`).join('\n'));
            }
        }
    }
    // The complete provider fallback is a valid source representation. Dynamic
    // syntax alone is not evidence of lost text. Without it, literal recovery
    // cannot establish that the entire component has been represented.
    const incomplete = !hasFallback;
    const note = incomplete ? '> Interactive content is incomplete: no usable Markdown fallback was provided; only recoverable static text is included.' : '';
    return { text: [text, ...recovered, note].filter(Boolean).join('\n\n'), incomplete,
        representation: hasFallback ? 'provider-fallback' : recovered.length ? 'literal-recovery' : 'unavailable',
        interactive: true, recoveredStrings };
}
