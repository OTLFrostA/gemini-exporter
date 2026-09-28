/**
 * scripts/parser_migration/run_corpus.ts
 *
 * Real Gemini Corpus Runner (Section 6, 23 & Remediation Plan 1.1)
 *
 * Capabilities:
 * 1. Injectable Architecture:
 *    Accepts baseline vs candidate parser (for PR 2 Markdown) and converter (for PR 4 MiTeX).
 * 2. Segmented Evaluation:
 *    Can target specific corpus sets ('real_gemini_output', 'scenario_inputs', 'synthetic_fixtures', or 'all').
 * 3. Real Typst WASM Compilation Gate:
 *    Actually compiles converted Typst expressions via TypstSandboxCompiler to compute genuine compileFailures.
 * 4. Machine-Readable Report Output conforming to Section 23.
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeGeminiConversation } from '../../src/core/export/canonical/normalizeGemini.js';
import { convertMathWithDiagnostic } from '../../src/core/export/typst/math/convertMath.js';
import { compareMarkdownAst, compareMathConversion, type DiffCategory } from './diff_runner.js';
import { TypstSandboxCompiler } from '../../src/core/export/typst/typstSandboxCompiler.js';
import { toTypstPayload } from '../../src/core/export/typst/payload.js';
import { RealWasmSandboxHost, repoRoot } from '../../tests/helpers/realWasmSandbox.js';

export type MarkdownParserFn = (content: string, id: string) => Promise<{ bundle: any; diagnostics: any[] }>;
export type MathConverterFn = (latex: string, display: boolean) => { typst?: string; diagnostic?: any };

export interface CorpusRunnerOptions {
    corpusPath?: string;
    outputPath?: string;
    corpusCategory?: 'all' | 'real_gemini_output' | 'scenario_inputs' | 'synthetic_fixtures';
    baselineParser?: MarkdownParserFn;
    candidateParser?: MarkdownParserFn;
    baselineConverter?: MathConverterFn;
    candidateConverter?: MathConverterFn;
    compileTypst?: boolean;
}

export interface CorpusReport {
    timestamp: string;
    corpusSet: string;
    markdown: {
        documents: number;
        parseFailures: number;
        fallbacks: number;
        blockDistribution: Record<string, number>;
        diffCount: number;
        diffsByCategory: Record<DiffCategory, number>;
        totalDurationMs: number;
        avgDurationMs: number;
    };
    math: {
        expressions: number;
        baseline: {
            converted: number;
            conversionFailures: number;
            compileFailures: number;
        };
        candidate?: {
            converted: number;
            conversionFailures: number;
            compileFailures: number;
        };
        converted: number;
        conversionFailures: number;
        compileFailures: number;
        diffCount: number;
        diffsByCategory: Record<DiffCategory, number>;
        totalDurationMs: number;
        avgDurationMs: number;
    };
    diagnostics: Array<{ domain: string; id: string; code?: string; message: string }>;
    diffs: Array<{ id: string; domain: string; category?: string; rationale?: string }>;
}

export async function runCorpus(options: CorpusRunnerOptions = {}): Promise<CorpusReport> {
    const defaultCorpusPath = path.join(__dirname, '../../tests/fixtures/parser_migration_corpus.json');
    const finalCorpusPath = options.corpusPath || defaultCorpusPath;
    const defaultOutputPath = path.join(__dirname, '../../tests/output/corpus_report.json');
    const finalOutputPath = options.outputPath || defaultOutputPath;
    const category = options.corpusCategory || 'all';

    if (!fs.existsSync(finalCorpusPath)) {
        throw new Error(`Corpus file not found at: ${finalCorpusPath}. Run extract_corpus.py first.`);
    }

    const corpusData = JSON.parse(fs.readFileSync(finalCorpusPath, 'utf-8'));
    let documents: any[] = [];
    let mathExpressions: any[] = [];

    if (category === 'all') {
        const sets = corpusData.corpusSets || {};
        for (const setName of Object.keys(sets)) {
            documents.push(...(sets[setName]?.documents || []));
            mathExpressions.push(...(sets[setName]?.mathExpressions || []));
        }
    } else {
        const targetSet = corpusData.corpusSets?.[category];
        if (targetSet) {
            documents = targetSet.documents || [];
            mathExpressions = targetSet.mathExpressions || [];
        }
    }

    // Default baseline parser & converter if not injected
    const defaultMdParser: MarkdownParserFn = async (content, id) => {
        return normalizeGeminiConversation({
            id,
            messages: [{ id: 'm1', role: 'user', content }],
        });
    };
    const activeBaselineParser = options.baselineParser || defaultMdParser;
    const activeBaselineConverter = options.baselineConverter || ((latex, display) => convertMathWithDiagnostic(latex, 'latex', display));

    const report: CorpusReport = {
        timestamp: new Date().toISOString(),
        corpusSet: category,
        markdown: {
            documents: documents.length,
            parseFailures: 0,
            fallbacks: 0,
            blockDistribution: {},
            diffCount: 0,
            diffsByCategory: {
                A_NEW_PARSER_CORRECT: 0,
                B_OLD_PARSER_GEMINI_DIALECT: 0,
                C_BOTH_REASONABLE: 0,
                D_CANNOT_DETERMINE: 0,
            },
            totalDurationMs: 0,
            avgDurationMs: 0,
        },
        math: {
            expressions: mathExpressions.length,
            baseline: {
                converted: 0,
                conversionFailures: 0,
                compileFailures: 0,
            },
            ...(options.candidateConverter
                ? {
                      candidate: {
                          converted: 0,
                          conversionFailures: 0,
                          compileFailures: 0,
                      },
                  }
                : {}),
            converted: 0,
            conversionFailures: 0,
            compileFailures: 0,
            diffCount: 0,
            diffsByCategory: {
                A_NEW_PARSER_CORRECT: 0,
                B_OLD_PARSER_GEMINI_DIALECT: 0,
                C_BOTH_REASONABLE: 0,
                D_CANNOT_DETERMINE: 0,
            },
            totalDurationMs: 0,
            avgDurationMs: 0,
        },
        diagnostics: [],
        diffs: [],
    };

    // 1. Process Markdown documents
    const mdStart = Date.now();
    for (const doc of documents) {
        try {
            const baseRes = await activeBaselineParser(doc.text, doc.id);
            for (const d of baseRes.diagnostics || []) {
                report.diagnostics.push({
                    domain: 'markdown',
                    id: doc.id,
                    code: d.code,
                    message: d.message,
                });
            }

            const msg = baseRes.bundle?.conversation?.messages?.[0];
            for (const block of msg?.blocks || []) {
                report.markdown.blockDistribution[block.type] =
                    (report.markdown.blockDistribution[block.type] || 0) + 1;
                if (block.type === 'unknown') {
                    report.markdown.fallbacks += 1;
                }
            }

            // Differential comparison if candidate parser injected
            if (options.candidateParser) {
                const candRes = await options.candidateParser(doc.text, doc.id);
                const diff = compareMarkdownAst(doc.text, baseRes.bundle, candRes.bundle);
                if (diff.hasDiff) {
                    report.markdown.diffCount += 1;
                    if (diff.category) {
                        report.markdown.diffsByCategory[diff.category] =
                            (report.markdown.diffsByCategory[diff.category] || 0) + 1;
                    }
                    report.diffs.push({
                        id: doc.id,
                        domain: 'markdown',
                        category: diff.category,
                        rationale: diff.rationale,
                    });
                }
            }
        } catch (err: any) {
            report.markdown.parseFailures += 1;
            report.diagnostics.push({
                domain: 'markdown',
                id: doc.id,
                message: `Fatal parse exception: ${err.message || String(err)}`,
            });
        }
    }
    const mdEnd = Date.now();
    report.markdown.totalDurationMs = mdEnd - mdStart;
    report.markdown.avgDurationMs = documents.length > 0 ? (mdEnd - mdStart) / documents.length : 0;

    // 2. Process Math expressions
    const mathStart = Date.now();
    const baselineSuccessful: Array<{ id: string; latex: string; display: boolean }> = [];
    const candidateSuccessful: Array<{ id: string; latex: string; display: boolean }> = [];

    for (const expr of mathExpressions) {
        try {
            const baseRes = activeBaselineConverter(expr.latex, !!expr.display);
            if (baseRes.typst) {
                report.math.baseline.converted += 1;
                report.math.converted += 1;
                baselineSuccessful.push(expr);
            } else {
                report.math.baseline.conversionFailures += 1;
                report.math.conversionFailures += 1;
                if (baseRes.diagnostic) {
                    report.diagnostics.push({
                        domain: 'math_baseline',
                        id: expr.id,
                        code: baseRes.diagnostic.code,
                        message: baseRes.diagnostic.message,
                    });
                }
            }

            // Differential comparison if candidate converter injected
            if (options.candidateConverter) {
                const candRes = options.candidateConverter(expr.latex, !!expr.display);
                if (candRes.typst) {
                    report.math.candidate!.converted += 1;
                    candidateSuccessful.push(expr);
                } else {
                    report.math.candidate!.conversionFailures += 1;
                    if (candRes.diagnostic) {
                        report.diagnostics.push({
                            domain: 'math_candidate',
                            id: expr.id,
                            code: candRes.diagnostic.code,
                            message: candRes.diagnostic.message,
                        });
                    }
                }

                const diff = compareMathConversion(expr.latex, baseRes, candRes);
                if (diff.hasDiff) {
                    report.math.diffCount += 1;
                    if (diff.category) {
                        report.math.diffsByCategory[diff.category] =
                            (report.math.diffsByCategory[diff.category] || 0) + 1;
                    }
                    report.diffs.push({
                        id: expr.id,
                        domain: 'latex',
                        category: diff.category,
                        rationale: diff.rationale,
                    });
                }
            }
        } catch (err: any) {
            report.math.baseline.conversionFailures += 1;
            report.math.conversionFailures += 1;
            report.diagnostics.push({
                domain: 'math',
                id: expr.id,
                message: `Fatal math conversion exception: ${err.message || String(err)}`,
            });
        }
    }
    const mathEnd = Date.now();
    report.math.totalDurationMs = mathEnd - mathStart;
    report.math.avgDurationMs = mathExpressions.length > 0 ? (mathEnd - mathStart) / mathExpressions.length : 0;

    // 3. Genuine Typst WASM compilation gate (100% of expressions evaluated, no truncation)
    if (options.compileTypst) {
        // 3a. Baseline Typst compile gate
        if (baselineSuccessful.length > 0) {
            try {
                const host = new RealWasmSandboxHost(repoRoot());
                const compiler = new TypstSandboxCompiler({ host });
                try {
                    const bundle = {
                        schemaVersion: 1,
                        conversation: {
                            key: { providerId: 'gemini', conversationId: 'corpus-math-baseline-compile-gate' },
                            title: { value: 'Corpus Math Baseline Compile Gate' },
                            createdAt: '2026-09-28T00:00:00Z',
                            messages: [{
                                id: 'm1',
                                role: 'assistant',
                                blocks: baselineSuccessful.map((e, idx) => ({
                                    id: `b${idx + 1}`,
                                    type: 'math',
                                    source: e.latex,
                                    notation: 'latex',
                                })),
                            }],
                        },
                        assets: [],
                        citations: [],
                    };
                    const convertMathFn = (s: string, not: string, disp: boolean) => activeBaselineConverter(s, disp).typst;
                    const { payload: document } = toTypstPayload(bundle, { assetPath: (a: any) => `/assets/${a.id}`, convertMath: convertMathFn });
                    const compileRes = await compiler.compile({
                        rendererSchemaVersion: 1,
                        sourceSchemaVersion: 1,
                        bundle,
                        document,
                        assetPaths: new Map(),
                    }, {
                        bundle: null,
                        assets: { resolve: async () => null },
                        locale: 'zh',
                        signal: new AbortController().signal,
                        reportProgress: () => {},
                    });
                    const errs = (compileRes.diagnostics ?? []).filter((d: any) => d.severity === 'error');
                    report.math.baseline.compileFailures = errs.length;
                    report.math.compileFailures = errs.length;
                } finally {
                    compiler.dispose();
                }
            } catch (compileErr: any) {
                report.math.baseline.compileFailures += 1;
                report.math.compileFailures += 1;
                report.diagnostics.push({
                    domain: 'typst_compile_baseline',
                    id: 'all_converted',
                    message: `Baseline Typst compilation exception: ${compileErr.message || String(compileErr)}`,
                });
            }
        }

        // 3b. Candidate Typst compile gate (compiles candidate's genuine typst output)
        if (options.candidateConverter && candidateSuccessful.length > 0) {
            try {
                const host = new RealWasmSandboxHost(repoRoot());
                const compiler = new TypstSandboxCompiler({ host });
                try {
                    const bundle = {
                        schemaVersion: 1,
                        conversation: {
                            key: { providerId: 'gemini', conversationId: 'corpus-math-candidate-compile-gate' },
                            title: { value: 'Corpus Math Candidate Compile Gate' },
                            createdAt: '2026-09-28T00:00:00Z',
                            messages: [{
                                id: 'm1',
                                role: 'assistant',
                                blocks: candidateSuccessful.map((e, idx) => ({
                                    id: `b${idx + 1}`,
                                    type: 'math',
                                    source: e.latex,
                                    notation: 'latex',
                                })),
                            }],
                        },
                        assets: [],
                        citations: [],
                    };
                    const convertMathFn = (s: string, not: string, disp: boolean) => options.candidateConverter!(s, disp).typst;
                    const { payload: document } = toTypstPayload(bundle, { assetPath: (a: any) => `/assets/${a.id}`, convertMath: convertMathFn });
                    const compileRes = await compiler.compile({
                        rendererSchemaVersion: 1,
                        sourceSchemaVersion: 1,
                        bundle,
                        document,
                        assetPaths: new Map(),
                    }, {
                        bundle: null,
                        assets: { resolve: async () => null },
                        locale: 'zh',
                        signal: new AbortController().signal,
                        reportProgress: () => {},
                    });
                    const errs = (compileRes.diagnostics ?? []).filter((d: any) => d.severity === 'error');
                    report.math.candidate!.compileFailures = errs.length;
                } finally {
                    compiler.dispose();
                }
            } catch (compileErr: any) {
                report.math.candidate!.compileFailures += 1;
                report.diagnostics.push({
                    domain: 'typst_compile_candidate',
                    id: 'all_converted',
                    message: `Candidate Typst compilation exception: ${compileErr.message || String(compileErr)}`,
                });
            }
        }
    }

    // Save JSON report
    fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
    fs.writeFileSync(finalOutputPath, JSON.stringify(report, null, 2), 'utf-8');

    return report;
}

// CLI execution
if (require.main === module) {
    (async () => {
        try {
            console.log('='.repeat(65));
            console.log('🚀 Running Parser Migration Corpus Evaluation (with Typst WASM Gate)...');
            console.log('='.repeat(65));
            const report = await runCorpus({ compileTypst: true });
            console.log(`\n📂 Corpus Set: ${report.corpusSet}`);
            console.log(`\n📄 Markdown Results:`);
            console.log(`  • Documents Evaluated: ${report.markdown.documents}`);
            console.log(`  • Parse Failures:      ${report.markdown.parseFailures} (Must be 0)`);
            console.log(`  • Fallbacks:           ${report.markdown.fallbacks}`);
            console.log(`  • Duration:            ${report.markdown.totalDurationMs} ms (avg ${report.markdown.avgDurationMs.toFixed(2)} ms/doc)`);

            console.log(`\n📐 Math Results (Baseline):`);
            console.log(`  • Expressions Tested:  ${report.math.expressions}`);
            console.log(`  • Converted Typst:     ${report.math.baseline.converted}`);
            console.log(`  • Conversion Fallback: ${report.math.baseline.conversionFailures}`);
            console.log(`  • Typst WASM Failures: ${report.math.baseline.compileFailures} (Genuine WASM compiler check, 100% evaluated)`);
            if (report.math.candidate) {
                console.log(`\n📐 Math Results (Candidate):`);
                console.log(`  • Converted Typst:     ${report.math.candidate.converted}`);
                console.log(`  • Conversion Fallback: ${report.math.candidate.conversionFailures}`);
                console.log(`  • Typst WASM Failures: ${report.math.candidate.compileFailures} (Genuine WASM compiler check, 100% evaluated)`);
            }
            console.log(`  • Duration:            ${report.math.totalDurationMs} ms (avg ${report.math.avgDurationMs.toFixed(2)} ms/expr)`);

            console.log(`\n📋 Diagnostics Recorded: ${report.diagnostics.length}`);
            console.log(`💾 Machine-readable report saved to: tests/output/corpus_report.json`);
            console.log('='.repeat(65));
        } catch (e) {
            console.error('Failed to run corpus:', e);
            process.exit(1);
        }
    })();
}
