import type { MathNotation } from '../../canonical/inline.js';
import type { RenderDiagnostic } from '../../canonical/rendering.js';
import { ConvertError, Parser } from './parser.js';

export interface MathConversionResult {
    typst?: string;
    diagnostic?: RenderDiagnostic;
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
    } catch (error) {
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
