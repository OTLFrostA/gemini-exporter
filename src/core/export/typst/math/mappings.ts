export const SYMBOLS: Record<string, string> = {
    sum: 'sum', int: 'integral', prod: 'prod',
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon',
    zeta: 'zeta', eta: 'eta', theta: 'theta', iota: 'iota', kappa: 'kappa',
    lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'xi', pi: 'pi', rho: 'rho',
    sigma: 'sigma', tau: 'tau', upsilon: 'upsilon', phi: 'phi', chi: 'chi',
    psi: 'psi', omega: 'omega',
    Gamma: 'Gamma', Delta: 'Delta', Theta: 'Theta', Lambda: 'Lambda',
    Xi: 'Xi', Pi: 'Pi', Sigma: 'Sigma', Phi: 'Phi', Psi: 'Psi', Omega: 'Omega',
    times: 'times', div: 'div', pm: 'plus.minus', mp: 'minus.plus', cdot: 'dot',
    leq: '<=', geq: '>=', le: '<=', ge: '>=', neq: '!=', ne: '!=', approx: 'approx', sim: 'tilde.op',
    equiv: 'equiv', otimes: 'times.o',
    oplus: 'plus.o', bigoplus: 'plus.o',
    implies: '==>', impliedby: '<==',
    iff: '<==>',
    to: '->', rightarrow: '->', leftarrow: '<-',
    longrightarrow: '-->', longleftarrow: '<--',
    Rightarrow: '=>', Leftarrow: '<=',
    Longrightarrow: '==>', Longleftarrow: '<==',
    Leftrightarrow: '<=>', Longleftrightarrow: '<==>',
    leftrightarrow: '<->', longleftrightarrow: '<-->',
    mapsto: '|->', longmapsto: '|-->',
    rightleftharpoons: 'harpoons.rtlb',
    uparrow: 'arrow.t', downarrow: 'arrow.b',
    // \circ is U+2218 (function composition); the 120^\circ degree idiom would
    // need context-sensitive handling and is intentionally not special-cased.
    circ: 'compose', triangle: 'triangle',
    quad: 'quad', qquad: 'wide', prime: 'prime',
    langle: 'angle.l', rangle: 'angle.r', mid: 'bar.v',
    infty: 'oo', partial: 'diff', nabla: 'nabla',
    in: 'in', notin: 'in.not', forall: 'forall', exists: 'exists',
    cup: 'union', cap: 'inter', setminus: 'without',
    subset: 'subset', subseteq: 'subset.eq', supset: 'supset', supseteq: 'supset.eq',
    sin: 'sin', cos: 'cos', tan: 'tan',
    sinh: 'sinh', cosh: 'cosh', tanh: 'tanh',
    ln: 'ln', log: 'log', exp: 'exp', det: 'det', dim: 'dim', deg: 'deg',
    min: 'min', max: 'max', sup: 'sup', inf: 'inf', lim: 'lim',
    Tr: 'op("Tr")', Re: 'Re', Im: 'Im',
    varphi: 'phi.alt', varepsilon: 'epsilon.alt', vartheta: 'theta.alt', varrho: 'rho.alt', varpi: 'pi.alt',
    ell: 'ell', odot: 'dot.circle', ast: 'ast', dots: 'dots', simeq: 'tilde.eq', cong: 'tilde.equiv',
    lesssim: '<~', gtrsim: '>~', preceq: 'prec.eq', succeq: 'succ.eq',
    iint: 'integral.double', iiint: 'integral.triple', oint: 'integral.cont',
    dagger: 'dagger', ddagger: 'dagger.double', hbar: 'planck.reduce',
    bot: 'bot', top: 'top',
    ll: '<<', gg: '>>', perp: 'perp', parallel: 'parallel', propto: 'prop',
    ldots: 'dots', cdots: 'dots.c',
};

export const STYLES: Record<string, string> = {
    mathbf: 'bold',
    boldsymbol: 'bold',
    bm: 'bold',
    mathcal: 'cal',
    mathbb: 'bb',
    mathit: 'italic',
    mathrm: 'upright',
    mathsf: 'sans',
    mathtt: 'mono',
};

export const FONT_SWITCHES: Record<string, string> = {
    rm: 'upright',
    bf: 'bold',
    it: 'italic',
    sf: 'sans',
    tt: 'mono',
    cal: 'cal',
};

export const ACCENTS: Record<string, string> = {
    hat: 'hat', bar: 'bar', tilde: 'tilde', dot: 'dot', ddot: 'dot.double', dddot: 'dot.triple', vec: 'arrow',
    overline: 'overline', underline: 'underline',
    overbrace: 'overbrace', underbrace: 'underbrace',
};

export const DELIMITERS: Record<string, string> = {
    '(': '(', ')': ')', '[': '[', ']': ']',
    '{': 'brace.l', '}': 'brace.r',
    '|': '|', '||': 'parallel', '.': '',
    'langle': 'angle.l', 'rangle': 'angle.r',
    'lvert': '|', 'rvert': '|', 'lVert': 'parallel', 'rVert': 'parallel',
    'lbrace': 'brace.l', 'rbrace': 'brace.r',
    'vert': '|', 'Vert': 'parallel',
};

export const LITERAL_CHARS = new Set('+-=<>!,;:.\'?*/()[]|'.split(''));

export const SIZING_COMMANDS = new Set([
    'big', 'Big', 'bigg', 'Bigg',
    'bigl', 'bigr', 'bigm',
    'Bigl', 'Bigr', 'Bigm',
    'biggl', 'biggr', 'biggm',
    'Biggl', 'Biggr', 'Biggm',
]);

// Avoid prototype-chain hits like `\toString`.
export function hasKey(map: Record<string, string>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(map, key);
}
