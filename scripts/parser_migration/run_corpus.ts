/**
 * scripts/parser_migration/run_corpus.ts
 *
 * Real Gemini Corpus Runner (Section 6 & 23)
 *
 * Evaluates real Gemini raw inputs against the pipeline and generates
 * the standard machine-readable corpus report:
 * {
 *   "markdown": { "documents": N, "parseFailures": 0, "fallbacks": 0 },
 *   "math": { "expressions": N, "converted": N, "conversionFailures": 0, "compileFailures": 0 }
 * }
 */

import * as fs from 'fs';
import * as path from 'path';
import { normalizeGeminiConversation } from '../../src/core/export/canonical/normalizeGemini.js';
import { convertMathWithDiagnostic } from '../../src/core/export/typst/math/convertMath.js';

interface CorpusReport {
    timestamp: string;
    markdown: {
        documents: number;
        parseFailures: number;
        fallbacks: number;
        blockDistribution: Record<string, number>;
        totalDurationMs: number;
        avgDurationMs: number;
    };
    math: {
        expressions: number;
        converted: number;
        conversionFailures: number;
        compileFailures: number;
        totalDurationMs: number;
        avgDurationMs: number;
    };
    diagnostics: Array<{ domain: string; id: string; code?: string; message: string }>;
    fallbackExamples: Array<{ id: string; preview: string; reason: string }>;
}

export async function runCorpus(corpusPath?: string, outputPath?: string): Promise<CorpusReport> {
    const defaultCorpusPath = path.join(__dirname, '../../tests/fixtures/real_gemini_corpus.json');
    const finalCorpusPath = corpusPath || defaultCorpusPath;
    const defaultOutputPath = path.join(__dirname, '../../tests/output/corpus_report.json');
    const finalOutputPath = outputPath || defaultOutputPath;

    if (!fs.existsSync(finalCorpusPath)) {
        throw new Error(`Corpus file not found at: ${finalCorpusPath}. Run extract_corpus.py first.`);
    }

    const corpusData = JSON.parse(fs.readFileSync(finalCorpusPath, 'utf-8'));
    const documents: any[] = corpusData.documents || [];
    const mathExpressions: any[] = corpusData.mathExpressions || [];

    const report: CorpusReport = {
        timestamp: new Date().toISOString(),
        markdown: {
            documents: documents.length,
            parseFailures: 0,
            fallbacks: 0,
            blockDistribution: {},
            totalDurationMs: 0,
            avgDurationMs: 0,
        },
        math: {
            expressions: mathExpressions.length,
            converted: 0,
            conversionFailures: 0,
            compileFailures: 0,
            totalDurationMs: 0,
            avgDurationMs: 0,
        },
        diagnostics: [],
        fallbackExamples: [],
    };

    // 1. Process Markdown documents
    const mdStart = Date.now();
    for (const doc of documents) {
        try {
            const rawConv = {
                id: doc.id,
                messages: [{ id: 'm1', role: 'user', content: doc.text }],
            };
            const { bundle, diagnostics } = await normalizeGeminiConversation(rawConv);

            for (const d of diagnostics) {
                report.diagnostics.push({
                    domain: 'markdown',
                    id: doc.id,
                    code: d.code,
                    message: d.message,
                });
            }

            const msg = bundle.conversation.messages[0];
            for (const block of msg?.blocks || []) {
                report.markdown.blockDistribution[block.type] =
                    (report.markdown.blockDistribution[block.type] || 0) + 1;
                if (block.type === 'unknown') {
                    report.markdown.fallbacks += 1;
                    if (report.fallbackExamples.length < 10) {
                        report.fallbackExamples.push({
                            id: doc.id,
                            preview: doc.text.slice(0, 100),
                            reason: 'Encountered unknown canonical block fallback',
                        });
                    }
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
    for (const expr of mathExpressions) {
        try {
            const res = convertMathWithDiagnostic(expr.latex, 'latex', !!expr.display);
            if (res.typst) {
                report.math.converted += 1;
            } else {
                report.math.conversionFailures += 1;
                if (res.diagnostic) {
                    report.diagnostics.push({
                        domain: 'math',
                        id: expr.id,
                        code: res.diagnostic.code,
                        message: res.diagnostic.message,
                    });
                }
            }
        } catch (err: any) {
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
    report.math.avgDurationMs =
        mathExpressions.length > 0 ? (mathEnd - mathStart) / mathExpressions.length : 0;

    // Save JSON report
    fs.mkdirSync(path.dirname(finalOutputPath), { recursive: true });
    fs.writeFileSync(finalOutputPath, JSON.stringify(report, null, 2), 'utf-8');

    return report;
}

// CLI execution
if (require.main === module) {
    (async () => {
        try {
            console.log('=' .repeat(65));
            console.log('🚀 Running Real Gemini Corpus Evaluation...');
            console.log('=' .repeat(65));
            const report = await runCorpus();
            console.log(`\n📄 Markdown Results:`);
            console.log(`  • Documents Evaluated: ${report.markdown.documents}`);
            console.log(`  • Parse Failures:      ${report.markdown.parseFailures} (Must be 0)`);
            console.log(`  • Fallbacks:           ${report.markdown.fallbacks}`);
            console.log(`  • Total Duration:      ${report.markdown.totalDurationMs} ms (avg ${report.markdown.avgDurationMs.toFixed(2)} ms/doc)`);
            console.log(`  • Block Distribution:`);
            for (const [k, v] of Object.entries(report.markdown.blockDistribution)) {
                console.log(`      - ${k}: ${v}`);
            }

            console.log(`\n📐 Math Results:`);
            console.log(`  • Expressions Tested:  ${report.math.expressions}`);
            console.log(`  • Successfully Converted: ${report.math.converted}`);
            console.log(`  • Conversion Fallbacks:   ${report.math.conversionFailures}`);
            console.log(`  • Total Duration:      ${report.math.totalDurationMs} ms (avg ${report.math.avgDurationMs.toFixed(2)} ms/expr)`);

            console.log(`\n📋 Diagnostics Recorded: ${report.diagnostics.length}`);
            console.log(`💾 Machine-readable report saved to: tests/output/corpus_report.json`);
            console.log('=' .repeat(65));
        } catch (e) {
            console.error('Failed to run corpus:', e);
            process.exit(1);
        }
    })();
}
