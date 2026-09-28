import {
    ACCENTS,
    DELIMITERS,
    EXTENSIBLE_ARROWS,
    FONT_SWITCHES,
    hasKey,
    LITERAL_CHARS,
    SIZING_COMMANDS,
    STYLES,
    SYMBOLS,
} from './mappings.js';
import {
    type Atom,
    type EnvironmentParserContext,
    isSupportedEnvironment,
    parseEnvironment,
} from './environments.js';

export { type Atom } from './environments.js';

export class ConvertError extends Error {}

export function escapeTypstString(raw: string): string {
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

export class Parser implements EnvironmentParserContext {
    pos = 0;

    constructor(
        readonly input: string,
        private readonly display: boolean,
    ) {}

    fail(message: string): never {
        throw new ConvertError(message);
    }

    peek(): string {
        return this.input[this.pos] ?? '';
    }

    skipSpace(): void {
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
                if (atoms.length === 0) {
                    const atom = this.attachScripts({ text: '("")', atomic: true });
                    atoms.push(atom);
                    continue;
                }
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

    attachScripts(atom: Atom): Atom {
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

    private parseOptionalArg(): Atom | undefined {
        this.skipSpace();
        if (this.peek() !== '[') return undefined;
        this.pos += 1;
        const atoms: Atom[] = [];
        for (;;) {
            this.skipSpace();
            const c = this.peek();
            if (c === '') this.fail('unclosed bracket: reached end of input inside [...]');
            if (c === ']') { this.pos += 1; break; }
            if (c === '^' || c === '_') {
                if (atoms.length === 0) {
                    const atom = this.attachScripts({ text: '("")', atomic: true });
                    atoms.push(atom);
                    continue;
                }
                this.fail(`script '${c}' without a base at offset ${this.pos}`);
            }
            if (c === '}' || c === '&') {
                this.fail(`unexpected '${c}' inside [...] at offset ${this.pos}`);
            }
            const atom = this.attachScripts(this.parseAtom());
            if (atom.text !== '') atoms.push(atom);
        }
        if (atoms.length === 1 && atoms[0]!.atomic) return atoms[0]!;
        return { text: atoms.map(a => a.text).join(' '), atomic: false };
    }

    private parseArg(what: string): Atom {
        this.skipSpace();
        if (this.peek() === '{') return this.parseGroup();
        if (this.peek() === '' || this.peek() === '}') {
            this.fail(`missing argument for ${what} at offset ${this.pos}`);
        }
        return this.parseAtom(true);
    }

    parseAtom(singleToken = false): Atom {
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
            if (c === ',' || c === ' ' || c === ';' || c === '!') return { text: '', atomic: true };
            if (c === '%') return { text: '"%"', atomic: true };
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
                : { text: `root(${index.text}, ${body.text})`, atomic: true };
        }
        if (name === 'text') {
            return { text: this.parseTextArg(), atomic: true };
        }
        if (name === 'arg') {
            return { text: 'op("arg", limits: #false)', atomic: true };
        }
        if (name === 'pmod') {
            const modulus = this.parseArg('\\pmod');
            return { text: `quad (op("mod", limits: #false) ${modulus.text})`, atomic: true };
        }
        if (name === 'operatorname') {
            const starred = this.peek() === '*';
            if (starred) this.pos += 1;
            this.skipSpace();
            let op = '';
            if (this.peek() === '{') {
                this.pos += 1;
                while (this.pos < this.input.length && this.peek() !== '}') {
                    op += this.peek();
                    this.pos += 1;
                }
                if (this.peek() !== '}') this.fail('unclosed brace in \\operatorname{...}');
                this.pos += 1;
            } else if (this.peek() === '\\') {
                this.pos += 1;
                while (/[A-Za-z]/.test(this.peek())) {
                    op += this.peek();
                    this.pos += 1;
                }
            } else {
                while (/[A-Za-z]/.test(this.peek())) {
                    op += this.peek();
                    this.pos += 1;
                }
            }
            if (op === '') this.fail('\\operatorname requires a non-empty operator name');
            // Typst op(content, limits: bool) defaults to limits: false.
            // \operatorname* enables display limits (#true), while unstarred explicitly pins limits: #false.
            const limits = starred ? ', limits: #true' : ', limits: #false';
            return { text: `op("${escapeTypstString(op)}"${limits})`, atomic: true };
        }
        if (name === 'left' || name === 'right' || name === 'middle') {
            return { text: this.parseDelimiter(name), atomic: true };
        }
        if (SIZING_COMMANDS.has(name)) {
            return { text: '', atomic: true };
        }
        if (hasKey(EXTENSIBLE_ARROWS, name)) {
            const arrow = EXTENSIBLE_ARROWS[name]!;
            const opt = this.parseOptionalArg();
            const req = this.parseArg(`\\${name}`);
            const sub = opt !== undefined ? (opt.atomic ? `_${opt.text}` : `_(${opt.text})`) : '';
            const sup = req.atomic ? `^${req.text}` : `^(${req.text})`;
            return { text: `scripts(${arrow})${sub}${sup}`, atomic: true };
        }
        if (name === 'begin') {
            const env = this.parseEnvName();
            if (isSupportedEnvironment(env)) {
                return parseEnvironment(env, this);
            }
            this.fail(`unsupported environment '\\begin{${env}}'`);
        }
        if (name === 'end') {
            this.fail(`stray \\end without matching \\begin at offset ${this.pos}`);
        }
        if (hasKey(FONT_SWITCHES, name)) {
            const style = FONT_SWITCHES[name]!;
            this.skipSpace();
            if (this.peek() === '{') {
                const arg = this.parseArg(`\\${name}`);
                return { text: `${style}(${arg.text})`, atomic: true };
            }
            const rest = this.parseSequence();
            return this.formatStyleSequence(style, rest);
        }
        if (hasKey(STYLES, name)) {
            const arg = this.parseArg(`\\${name}`);
            return { text: `${STYLES[name]}(${arg.text})`, atomic: true };
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

    private parseEnvName(): string {
        this.skipSpace();
        if (this.peek() !== '{') {
            this.fail(`\\begin requires an environment name in {...} at offset ${this.pos}`);
        }
        this.pos += 1;
        let env = '';
        while (this.pos < this.input.length && this.peek() !== '}') {
            env += this.peek();
            this.pos += 1;
        }
        if (this.peek() !== '}') {
            this.fail('unclosed brace in \\begin{...}');
        }
        this.pos += 1;
        return env.trim();
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

    private formatStyleSequence(style: string, atoms: Atom[]): Atom {
        if (atoms.length === 0) return { text: '', atomic: true };
        const chunks: string[] = [];
        let current: string[] = [];
        for (const atom of atoms) {
            if (atom.text === ',' || atom.text === ';') {
                if (current.length > 0) {
                    chunks.push(`${style}(${current.join(' ')})`);
                    current = [];
                }
                chunks.push(atom.text);
            } else {
                current.push(atom.text);
            }
        }
        if (current.length > 0) {
            chunks.push(`${style}(${current.join(' ')})`);
        }
        if (chunks.length === 1) {
            return { text: chunks[0]!, atomic: true };
        }
        return { text: chunks.join(' '), atomic: false };
    }
}
