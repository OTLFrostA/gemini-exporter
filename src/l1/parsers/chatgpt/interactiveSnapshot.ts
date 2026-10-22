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

/** Official fallback can omit loop-generated questions entirely. Recover literal
 * data as static text and flag dynamic content whose full rendering is unknown. */
export function chatGPTInteractiveSnapshot(raw: string, fallback?: string): { text: string; incomplete: boolean } {
    if (!raw.trim() && !fallback?.trim()) return {
        text: '> Interactive content unavailable: no static source or Markdown fallback was provided.', incomplete: true,
    };
    const interactive = /\{@body|\{#(?:each|if)\b/.test(raw);
    if (!interactive) return { text: fallback?.trim() ? fallback : raw, incomplete: false };
    const text = fallback?.trim() ? fallback : '';
    const recovered: string[] = [];
    if (raw.length <= 1_000_000) {
        for (const declaration of raw.matchAll(/\{@body\s+(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*/g)) {
            const value = literalAt(raw, declaration.index + declaration[0].length);
            if (!Array.isArray(value)) continue;
            for (const item of value) {
                const labels = stringsOf(item).filter(label => label.trim() && !text.includes(label));
                if (labels.length) recovered.push(labels.map((label, i) => `${i ? '  ' : ''}- ${escapeText(label)}`).join('\n'));
            }
        }
    }
    // A dynamic loop/conditional cannot be certified complete by its fallback.
    const incomplete = !text || /\{#(?:each|if)\b/.test(raw);
    const note = incomplete ? '> Interactive content is a static snapshot; some dynamic content or selections may be unavailable.' : '';
    return { text: [text, ...recovered, note].filter(Boolean).join('\n\n'), incomplete };
}
