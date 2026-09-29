/**
 * src/core/export/typst/mitex/index.ts
 *
 * Public surface of the MiTeX LaTeX -> Typst conversion engine.
 */

export {
    initMitexWasm,
    isMitexReady,
    mitexConvertMath,
    mitexConvertText,
    resetMitexForTesting,
} from './mitexLoader.js';

export {
    convertMathWithMitex,
    convertMathMitex,
    type MathConversionResult,
} from './mitexConverter.js';
