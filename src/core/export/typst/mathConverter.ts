// Output is built strictly from a whitelist of mapped tokens and escaped string literals so
// untrusted LaTeX is never spliced into Typst `eval(mode: "math")`; any unsupported token fails the whole conversion.

import type { MathNotation } from '../canonical/inline.js';
import type { RenderDiagnostic } from '../canonical/rendering.js';

export interface MathConversionResult {
    typst?: string;
    diagnostic?: RenderDiagnostic;
}

const SYMBOLS: Record<string, string> = {
    sum: 'sum', int: 'int', prod: 'prod',
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon',
    zeta: 'zeta', eta: 'eta', theta: 'theta', iota: 'iota', kappa: 'kappa',
    lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'xi', pi: 'pi', rho: 'rho',
    sigma: 'sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi', chi: 'chi',
    psi: 'psi', omega: 'omega',
    Gamma: 'Gamma', Delta: 'Delta', Theta: 'Theta', Lambda: 'Lambda',
    Xi: 'Xi', Pi: 'Pi', Sigma: 'Sigma', Phi: 'Phi', Psi: 'Psi', Omega: 'Omega',
    times: 'times', div: 'div', pm: 'plus.minus', cdot: 'dot',
    leq: '<=', geq: '>=', neq: '!=', approx: 'approx',
    to: '->', rightarrow: '->', leftarrow: '<-', Rightarrow: '=>',
    Leftarrow: '<=', leftrightarrow: '<->', mapsto: '|->',
    infty: 'oo', partial: 'diff', nabla: 'nabla',
    in: 'in', notin: 'in.not', forall: 'forall', exists: 'exists',
    cup: 'union', cap: 'inter',
    subset: 'subset', subseteq: 'subset.eq', supset: 'supset', supseteq: 'supset.eq',
    sin: 'sin', cos: 'cos', tan: 'tan',
    ldots: 'dots', cdots: 'dots.c',
};

const ACCENTS: Record<string, string> = {
    hat: 'hat', bar: 'bar', tilde: 'tilde', dot: 'dot', ddot: 'dot.double',
};

const DELIMITERS: Record<string, string> = {
    '(': '(', ')': ')', '[': '[', ']': ']',
    '{': 'brace.l', '}': 'brace.r',
    '|': '|', '||': 'parallel', '.': '',
    'langle': 'angle.l', 'rangle': 'angle.r',
    'lvert': '|', 'rvert': '|', 'lVert': 'parallel', 'rVert': 'parallel',
    'lbrace': 'brace.l', 'rbrace': 'brace.r',
};

const LITERAL_CHARS = new Set('+-=<>!,;:.\'?*/()[]|'.split(''));

// Avoid prototype-chain hits like `\toString`.
function hasKey(map: Record<string, string>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(map, key);
}

class ConvertError extends Error {}

interface Atom {
    text: string;
    /** True when a script (^/_) may attach directly without parens. */
    atomic: boolean;
}

class Parser {
    private pos = 0;

    constructor(
        private readonly input: string,
        private readonly display: boolean,
    ) {}

    fail(message: string): never {
        throw new ConvertError(message);
    }

    private peek(): string {
        return this.input[this.pos] ?? '';
    }

    private skipSpace(): void {
        while (this.pos < this.input.length && /\s/.test(this.input[this.pos]!)) {
            this.pos += 1;
        }
    }

    parse(): string {
        const atoms = this.parseSequence();
        this.skipSpace();
        if (this.pos !== this.input.length) {
            this.fail(`unexpected '${this.peek()}' at offset ${this.pos}`);
        }
        return atoms.map(a => a.text).join(' ');
    }

    private parseSequence(): Atom[] {
        const atoms: Atom[] = [];
        for (;;) {
            this.skipSpace();
            const c = this.peek();
            if (c === '' || c === '}') break;
            if (c === '^' || c === '_') {
                this.fail(`script '${c}' without a base at offset ${this.pos}`);
            }
            if (c === '&') {
                this.fail(`alignment '&' is not supported at offset ${this.pos}`);
            }
            const atom = this.attachScripts(this.parseAtom());
            // \left. / \right. produce empty atoms; drop them so joins stay clean.
            if (atom.text !== '') atoms.push(atom);
        }
        return atoms;
    }

    private attachScripts(atom: Atom): Atom {
        for (;;) {
            this.skipSpace();
            const s = this.peek();
            if (s !== '^' && s !== '_') return atom;
            this.pos += 1;
            const script = this.parseScriptUnit();
            const base = atom.atomic ? atom.text : `(${atom.text})`;
            const arg = script.atomic ? script.text : `(${script.text})`;
            atom = { text: `${base}${s}${arg}`, atomic: true };
        }
    }

    private parseScriptUnit(): Atom {
        this.skipSpace();
        if (this.peek() === '{') return this.parseGroup();
        return this.parseAtom();
    }

    private parseGroup(): Atom {
        this.pos += 1;
        const atoms = this.parseSequence();
        this.skipSpace();
        if (this.peek() !== '}') {
            this.fail('unclosed brace: reached end of input inside {...}');
        }
        this.pos += 1;
        if (atoms.length === 1 && atoms[0]!.atomic) return atoms[0]!;
        return { text: atoms.map(a => a.text).join(' '), atomic: false };
    }

    private parseOptionalArg(): string | undefined {
        this.skipSpace();
        if (this.peek() !== '[') return undefined;
        this.pos += 1;
        const atoms: Atom[] = [];
        for (;;) {
            this.skipSpace();
            const c = this.peek();
            if (c === '') this.fail('unclosed bracket: reached end of input inside [...]');
            if (c === ']') { this.pos += 1; break; }
            if (c === '^' || c === '_' || c === '}' || c === '&') {
                this.fail(`unexpected '${c}' inside [...] at offset ${this.pos}`);
            }
            const atom = this.parseAtom();
            if (atom.text !== '') atoms.push(atom);
        }
        return atoms.map(a => a.text).join(' ');
    }

    private parseArg(what: string): Atom {
        this.skipSpace();
        if (this.peek() === '{') return this.parseGroup();
        if (this.peek() === '' || this.peek() === '}') {
            this.fail(`missing argument for ${what} at offset ${this.pos}`);
        }
        return this.parseAtom(true);
    }

    private parseAtom(singleToken = false): Atom {
        const c = this.peek();
        if (c === '\\') return this.parseCommand();
        if (c === '{') return this.parseGroup();
        if (c === '') this.fail('unexpected end of input');
        // Merge digit runs into one atom so "10" doesn't render as "1 0", except bare
        // \frac/\sqrt arguments which take a single TeX token (\frac12 -> frac(1, 2)).
        if (/[0-9]/.test(c)) {
            let num = '';
            const take = singleToken ? 1 : Infinity;
            let n = 0;
            while (n < take && /[0-9]/.test(this.peek())) { num += this.peek(); this.pos += 1; n += 1; }
            if (!singleToken && this.peek() === '.' && /[0-9]/.test(this.input[this.pos + 1] ?? '')) {
                num += '.';
                this.pos += 1;
                while (/[0-9]/.test(this.peek())) { num += this.peek(); this.pos += 1; }
            }
            return { text: num, atomic: true };
        }
        if (/[A-Za-z]/.test(c)) {
            this.pos += 1;
            return { text: c, atomic: true };
        }
        if (LITERAL_CHARS.has(c)) {
            this.pos += 1;
            return { text: c, atomic: true };
        }
        this.fail(`unsupported character '${c}' at offset ${this.pos}`);
    }

    private parseCommand(): Atom {
        this.pos += 1;
        const c = this.peek();
        if (c !== '' && !/[A-Za-z]/.test(c)) {
            this.pos += 1;
            if (c === '{') return { text: 'brace.l', atomic: true };
            if (c === '}') return { text: 'brace.r', atomic: true };
            if (c === '|') return { text: 'parallel', atomic: true };
            if (c === '\\') return this.parseNewline();
            this.fail(`unsupported escaped character '\\${c}' at offset ${this.pos - 1}`);
        }
        let name = '';
        while (/[A-Za-z]/.test(this.peek())) {
            name += this.peek();
            this.pos += 1;
        }
        if (name === '') this.fail(`stray backslash at offset ${this.pos - 1}`);

        if (name === 'frac') {
            const num = this.parseArg('\\frac numerator');
            const den = this.parseArg('\\frac denominator');
            return { text: `frac(${num.text}, ${den.text})`, atomic: true };
        }
        if (name === 'sqrt') {
            const index = this.parseOptionalArg();
            const body = this.parseArg('\\sqrt');
            return index === undefined
                ? { text: `sqrt(${body.text})`, atomic: true }
                : { text: `root(${index}, ${body.text})`, atomic: true };
        }
        if (name === 'text') {
            return { text: this.parseTextArg(), atomic: true };
        }
        if (name === 'left' || name === 'right') {
            return { text: this.parseDelimiter(name), atomic: true };
        }
        if (hasKey(ACCENTS, name)) {
            const arg = this.parseArg(`\\${name}`);
            return { text: `${ACCENTS[name]}(${arg.text})`, atomic: true };
        }
        if (hasKey(SYMBOLS, name)) {
            return { text: SYMBOLS[name]!, atomic: true };
        }
        this.fail(`unsupported command '\\${name}'`);
    }

    private parseTextArg(): string {
        this.skipSpace();
        if (this.peek() !== '{') {
            this.fail(`\\text requires a brace group at offset ${this.pos}`);
        }
        this.pos += 1;
        let raw = '';
        let depth = 1;
        while (this.pos < this.input.length && depth > 0) {
            const c = this.input[this.pos]!;
            if (c === '\\' && this.input[this.pos + 1] === '{') { raw += '{'; this.pos += 2; continue; }
            if (c === '\\' && this.input[this.pos + 1] === '}') { raw += '}'; this.pos += 2; continue; }
            if (c === '{') depth += 1;
            if (c === '}') { depth -= 1; if (depth === 0) { this.pos += 1; break; } }
            if (depth > 0) raw += c;
            this.pos += 1;
        }
        if (depth !== 0) this.fail('unclosed brace in \\text{...}');
        return `"${escapeTypstString(raw)}"`;
    }

    private parseDelimiter(which: string): string {
        this.skipSpace();
        let key: string;
        const c = this.peek();
        if (c === '\\') {
            this.pos += 1;
            const d = this.peek();
            if (d === '|') { this.pos += 1; key = '||'; }
            else if (d === '') this.fail(`missing delimiter after \\${which} at end of input`);
            else if (/[A-Za-z]/.test(d)) {
                let name = '';
                while (/[A-Za-z]/.test(this.peek())) { name += this.peek(); this.pos += 1; }
                key = name;
            }
            else { this.pos += 1; key = d; }
        }
        else if (c === '') {
            this.fail(`missing delimiter after \\${which} at end of input`);
        }
        else {
            this.pos += 1;
            key = c;
        }
        if (!hasKey(DELIMITERS, key)) {
            this.fail(`unsupported delimiter '${key}' after \\${which}`);
        }
        return DELIMITERS[key]!;
    }

    private parseNewline(): Atom {
        if (!this.display) {
            this.fail("'\\\\' line break is not supported in inline math");
        }
        return { text: '\\\n', atomic: true };
    }
}

function escapeTypstString(raw: string): string {
    let out = '';
    for (const ch of raw) {
        const cp = ch.codePointAt(0)!;
        if (ch === '"') out += '\\"';
        else if (ch === '\\') out += '\\\\';
        else if (ch === '\n') out += '\\n';
        else if (ch === '\t') out += '\\t';
        else if (ch === '\r') out += '\\r';
        else if (cp < 0x20 || cp === 0x7f) out += `\\u{${cp.toString(16)}}`;
        else out += ch;
    }
    return out;
}

function preview(source: string, max = 80): string {
    const flat = source.replace(/\s+/g, ' ');
    return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function warn(code: string, message: string): RenderDiagnostic {
    return { severity: 'warning', code, message };
}

export function convertMathWithDiagnostic(
    source: string,
    notation: MathNotation | string,
    display: boolean,
): MathConversionResult {
    if (notation !== 'latex') {
        return {
            diagnostic: warn(
                'TYPST_MATH_UNSUPPORTED_NOTATION',
                `Math notation '${notation}' is not supported by the controlled converter (only 'latex'); raw source preserved.`,
            ),
        };
    }
    if (source.trim() === '') {
        return {
            diagnostic: warn(
                'TYPST_MATH_EMPTY',
                'Empty math source cannot be converted; raw source preserved.',
            ),
        };
    }
    try {
        const typst = new Parser(source, display).parse();
        if (typst.trim() === '') {
            return {
                diagnostic: warn(
                    'TYPST_MATH_EMPTY',
                    'Math source produced no convertible content; raw source preserved.',
                ),
            };
        }
        return { typst };
    }
    catch (error) {
        const reason = error instanceof ConvertError ? error.message : String(error);
        return {
            diagnostic: warn(
                'TYPST_MATH_CONVERT_FAILED',
                `LaTeX math could not be converted to Typst (${reason}); raw source preserved: ${preview(source)}`,
            ),
        };
    }
}

export function convertMath(
    source: string,
    notation: string,
    display: boolean,
): string | undefined {
    return convertMathWithDiagnostic(source, notation, display).typst;
}
