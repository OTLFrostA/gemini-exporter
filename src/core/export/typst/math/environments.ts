export interface Atom {
    text: string;
    /** True when a script (^/_) may attach directly without parens. */
    atomic: boolean;
}

export interface EnvironmentParserContext {
    readonly input: string;
    pos: number;
    peek(): string;
    skipSpace(): void;
    fail(message: string): never;
    parseAtom(): Atom;
    attachScripts(atom: Atom): Atom;
}

export const SUPPORTED_ENVIRONMENTS = new Set([
    'pmatrix',
    'bmatrix',
    'vmatrix',
    'matrix',
    'cases',
]);

export function isSupportedEnvironment(name: string): boolean {
    return SUPPORTED_ENVIRONMENTS.has(name);
}

export function parseEnvironment(env: string, ctx: EnvironmentParserContext): Atom {
    const rows: string[][] = [[]];
    let currentCellAtoms: Atom[] = [];

    const flushCell = () => {
        const cellText = currentCellAtoms.map(a => a.text).join(' ').trim();
        rows[rows.length - 1]!.push(cellText);
        currentCellAtoms = [];
    };

    for (;;) {
        ctx.skipSpace();
        const c = ctx.peek();
        if (c === '') {
            ctx.fail(`unclosed environment '\\begin{${env}}' at end of input`);
        }
        if (c === '&') {
            ctx.pos += 1;
            flushCell();
            continue;
        }
        if (c === '\\') {
            if (ctx.input[ctx.pos + 1] === '\\') {
                ctx.pos += 2;
                flushCell();
                rows.push([]);
                continue;
            }
            const match = ctx.input.slice(ctx.pos).match(/^\\end\s*\{([^}]+)\}/);
            if (match) {
                const endEnv = match[1]!.trim();
                if (endEnv !== env) {
                    ctx.fail(`mismatched environment: \\begin{${env}} closed by \\end{${endEnv}}`);
                }
                ctx.pos += match[0]!.length;
                flushCell();
                break;
            }
        }
        const atom = ctx.attachScripts(ctx.parseAtom());
        if (atom.text !== '') currentCellAtoms.push(atom);
    }

    while (rows.length > 1 && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === '') {
        rows.pop();
    }

    if (env === 'cases') {
        // One cases() argument per LaTeX row; cells within a row align via &.
        const items = rows.map(r => r.join(' & ')).filter(s => s.length > 0);
        return { text: `cases(${items.join(', ')})`, atomic: true };
    }

    const delimMap: Record<string, string | undefined> = {
        pmatrix: undefined,
        bmatrix: '"["',
        vmatrix: '"|"',
        matrix: 'none',
    };
    const delim = delimMap[env];
    const rowStrings = rows.map(r => r.join(', '));
    const body = rowStrings.join('; ');
    if (delim !== undefined) {
        return { text: `mat(delim: ${delim}, ${body})`, atomic: true };
    }
    return { text: `mat(${body})`, atomic: true };
}
