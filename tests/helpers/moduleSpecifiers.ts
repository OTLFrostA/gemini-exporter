/** Ignore comments, strings and regex bodies while retaining literal module specifiers. */
interface Token { value: string; literal?: boolean }
export function tokens(source: string): Token[] {
    const result: Token[] = [];
    let index = 0;
    while (index < source.length) {
        const rest = source.slice(index);
        if (/^\s/.test(rest)) { index++; continue; }
        if (rest.startsWith('//')) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue; }
        if (rest.startsWith('/*')) { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue; }
        const quote = source[index];
        if (quote === "'" || quote === '"' || quote === '`') {
            let value = '', escaped = false;
            index++;
            while (index < source.length) {
                const char = source[index++];
                if (escaped) { value += char; escaped = false; }
                else if (char === '\\') escaped = true;
                else if (char === quote) break;
                else value += char;
            }
            result.push({ value, literal: quote !== '`' || !value.includes('${') });
            continue;
        }
        const previous = result.at(-1)?.value;
        if (quote === '/' && (!previous || /^(?:[=(,:!?;{\[]|return|case|=>)$/.test(previous))) {
            index++;
            let bracket = false;
            while (index < source.length) {
                const char = source[index++];
                if (char === '\\') index++;
                else if (char === '[') bracket = true;
                else if (char === ']') bracket = false;
                else if (char === '/' && !bracket) break;
            }
            while (/[a-z]/i.test(source[index] ?? '') && index < source.length) index++;
            result.push({ value: '<regex>' });
            continue;
        }
        const word = /^[$\w]+/.exec(rest);
        const value = word?.[0] ?? quote;
        result.push({ value }); index += value.length;
    }
    return result;
}
export function specifiers(source: string): string[] {
    const stream = tokens(source), result: string[] = [];
    stream.forEach((token, index) => {
        if (token.literal) return;
        const next = stream[index + 1], arg = stream[index + 2];
        if ((token.value === 'from' || token.value === 'import') && next?.literal) result.push(next.value);
        else if ((token.value === 'import' || token.value === 'require') && next?.value === '(' && arg?.literal) result.push(arg.value);
    });
    return result;
}
