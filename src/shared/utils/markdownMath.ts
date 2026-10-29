export function inlineMathMarkdown(source: string): string {
    if (!source.includes('$')) return `$${source}$`;
    const length = Math.max(2, ...Array.from(source.matchAll(/\$+/g), match => match[0].length + 1));
    const fence = '$'.repeat(length);
    return `${fence} ${source} ${fence}`;
}
