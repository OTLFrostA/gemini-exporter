export interface MathCorpusItem {
    name: string;
    category: string;
    latex: string;
    display: boolean;
    expectedTypst?: string;
    shouldFallback?: boolean;
    wasmSmoke?: boolean;
}

export const TYPST_MATH_CORPUS: readonly MathCorpusItem[] = [
    // 1. Basic arithmetic
    {
        name: 'basic arithmetic operators',
        category: 'basic arithmetic',
        latex: 'a + b - c \\times d / e',
        display: false,
        expectedTypst: 'a + b - c times d / e',
        wasmSmoke: true,
    },
    // 2. Fractions
    {
        name: 'standard braced fraction',
        category: 'fractions',
        latex: '\\frac{a + 1}{b - 1}',
        display: false,
        expectedTypst: 'frac(a + 1, b - 1)',
        wasmSmoke: true,
    },
    {
        name: 'single-token digit fraction',
        category: 'fractions',
        latex: '\\frac12',
        display: false,
        expectedTypst: 'frac(1, 2)',
    },
    // 3. Roots
    {
        name: 'square root',
        category: 'roots',
        latex: '\\sqrt{x + y}',
        display: false,
        expectedTypst: 'sqrt(x + y)',
    },
    {
        name: 'nth root with optional argument',
        category: 'roots',
        latex: '\\sqrt[3]{x}',
        display: false,
        expectedTypst: 'root(3, x)',
    },
    // 4. Scripts
    {
        name: 'atomic subscript and superscript',
        category: 'scripts',
        latex: 'x_i^2',
        display: false,
        expectedTypst: 'x_i^2',
    },
    {
        name: 'compound braced scripts',
        category: 'scripts',
        latex: 'x_{i+1}^{2n}',
        display: false,
        expectedTypst: 'x_(i + 1)^(2 n)',
    },
    // 5. Large operators
    {
        name: 'summation with bounds',
        category: 'large operators',
        latex: '\\sum_{i=1}^n i',
        display: true,
        expectedTypst: 'sum_(i = 1)^n i',
    },
    // 6. Integrals
    {
        name: 'definite integral to infinity',
        category: 'integrals',
        latex: '\\int_0^\\infty e^{-x} dx',
        display: true,
        expectedTypst: 'integral_0^oo e^(- x) d x',
        wasmSmoke: true,
    },
    {
        name: 'double integral with domain subscript',
        category: 'integrals',
        latex: '\\iint_D dx dy',
        display: true,
        expectedTypst: 'integral.double_D d x d y',
    },
    // 7. Greek letters
    {
        name: 'lowercase greek equality',
        category: 'greek',
        latex: '\\alpha + \\beta = \\gamma',
        display: false,
        expectedTypst: 'alpha + beta = gamma',
    },
    {
        name: 'uppercase greek product',
        category: 'greek',
        latex: '\\Delta x \\cdot \\Omega',
        display: false,
        expectedTypst: 'Delta x dot Omega',
    },
    // 8. Relations
    {
        name: 'chained inequalities and approximations',
        category: 'relations',
        latex: 'a \\le b \\approx c \\neq d',
        display: false,
        expectedTypst: 'a <= b approx c != d',
    },
    {
        name: 'implication and mapping arrows',
        category: 'relations',
        latex: 'f: X \\to Y \\implies x \\mapsto y',
        display: false,
        expectedTypst: 'f : X -> Y ==> x |-> y',
    },
    // 9. Delimiters
    {
        name: 'left-right parens around fraction',
        category: 'delimiters',
        latex: '\\left( \\frac{a}{b} \\right)',
        display: false,
        expectedTypst: '( frac(a, b) )',
    },
    {
        name: 'brackets and absolute value norm',
        category: 'delimiters',
        latex: '\\left[ x \\right] + \\left| y \\right|',
        display: false,
        expectedTypst: '[ x ] + | y |',
    },
    // 10. Accents
    {
        name: 'hat, vector, and dot accents',
        category: 'accents',
        latex: '\\hat{x} + \\vec{v} + \\dot{y}',
        display: false,
        expectedTypst: 'hat(x) + arrow(v) + dot(y)',
    },
    // 11. Styles
    {
        name: 'bold, blackboard, and cal font styles',
        category: 'styles',
        latex: '\\mathbf{v} + \\mathbb{R} + \\mathcal{F}',
        display: false,
        expectedTypst: 'bold(v) + bb(R) + cal(F)',
    },
    // 12. Operatorname (unstarred)
    {
        name: 'unstarred operatorname with side limits',
        category: 'operatorname',
        latex: '\\operatorname{Tr}(A)',
        display: true,
        expectedTypst: 'op("Tr", limits: #false) ( A )',
        wasmSmoke: true,
    },
    // 13. Operatorname* (starred)
    {
        name: 'starred operatorname with display limits',
        category: 'operatorname*',
        latex: '\\operatorname*{argmax}_{x} f(x)',
        display: true,
        expectedTypst: 'op("argmax", limits: #true)_x f ( x )',
        wasmSmoke: true,
    },
    // 14. Matrices
    {
        name: 'pmatrix 2x2',
        category: 'matrices',
        latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
        display: true,
        expectedTypst: 'mat(a, b; c, d)',
    },
    {
        name: 'bmatrix 2x2 identity',
        category: 'matrices',
        latex: '\\begin{bmatrix} 1 & 0 \\\\ 0 & 1 \\end{bmatrix}',
        display: true,
        expectedTypst: 'mat(delim: "[", 1, 0; 0, 1)',
        wasmSmoke: true,
    },
    // 15. Cases
    {
        name: 'two-branch cases with condition alignment',
        category: 'cases',
        latex: '\\begin{cases} 1 & x > 0 \\\\ 0 & x \\le 0 \\end{cases}',
        display: true,
        expectedTypst: 'cases(1 & x > 0, 0 & x <= 0)',
        wasmSmoke: true,
    },
    {
        name: 'single-column cases definition',
        category: 'cases',
        latex: '\\begin{cases} a \\\\ b \\end{cases}',
        display: true,
        expectedTypst: 'cases(a, b)',
    },
    // 16. Composition
    {
        name: 'function composition operator',
        category: 'composition',
        latex: 'f \\circ g',
        display: false,
        expectedTypst: 'f compose g',
        wasmSmoke: true,
    },
    // 17. Text
    {
        name: 'text block inside math',
        category: 'text',
        latex: 'x > 0 \\text{ for all } y',
        display: false,
        expectedTypst: 'x > 0 " for all " y',
    },
    // 18. Malformed input (fail closed)
    {
        name: 'unclosed brace in fraction',
        category: 'malformed input',
        latex: '\\frac{1}{2',
        display: false,
        shouldFallback: true,
    },
    {
        name: 'unclosed brace in operatorname',
        category: 'malformed input',
        latex: '\\operatorname{Tr',
        display: false,
        shouldFallback: true,
    },
    {
        name: 'empty operatorname',
        category: 'malformed input',
        latex: '\\operatorname{}',
        display: false,
        shouldFallback: true,
    },
    // 19. Unsupported input (fallback with diagnostic)
    {
        name: 'unsupported LaTeX command',
        category: 'unsupported input',
        latex: '\\unknowncommand{x}',
        display: false,
        shouldFallback: true,
    },
    {
        name: 'unsupported environment',
        category: 'unsupported input',
        latex: '\\begin{align} x \\end{align}',
        display: true,
        shouldFallback: true,
    },
];
