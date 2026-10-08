import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { transformSync } from 'esbuild';

const root = resolve(__dirname, '../..');
const core = resolve(root, 'src/core');
interface Edge { target: string; runtime: boolean }
function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(dir, entry.name);
        return entry.isDirectory() ? files(path) : /\.[cm]?[jt]s$/.test(entry.name) ? [path] : [];
    });
}
const sources = new Map(files(core).map(file => [relative(core, file).replace(/\\/g, '/'), file]));

/** Ignore comments, strings and regex bodies while retaining literal module specifiers. */
interface Token { value: string; literal?: boolean }
function tokens(source: string): Token[] {
    const result: Token[] = [];
    let index = 0;
    while (index < source.length) {
        const rest = source.slice(index);
        if (/^\s/.test(rest)) { index++; continue; }
        if (rest.startsWith('//')) { const end = source.indexOf('\n', index); index = end < 0 ? source.length : end; continue; }
        if (rest.startsWith('/*')) { const end = source.indexOf('*/', index + 2); index = end < 0 ? source.length : end + 2; continue; }
        const quote = source[index];
        if (quote === "'" || quote === '"' || quote === '`') {
            let value = '', escaped = false;
            index++;
            while (index < source.length) {
                const char = source[index++];
                if (escaped) { value += char; escaped = false; }
                else if (char === '\\') escaped = true;
                else if (char === quote) break;
                else value += char;
            }
            result.push({ value, literal: quote !== '`' || !value.includes('${') });
            continue;
        }
        const previous = result.at(-1)?.value;
        if (quote === '/' && (!previous || /^(?:[=(,:!?;{\[]|return|case|=>)$/.test(previous))) {
            index++;
            let bracket = false;
            while (index < source.length) {
                const char = source[index++];
                if (char === '\\') index++;
                else if (char === '[') bracket = true;
                else if (char === ']') bracket = false;
                else if (char === '/' && !bracket) break;
            }
            while (/[a-z]/i.test(source[index] ?? '') && index < source.length) index++;
            result.push({ value: '<regex>' });
            continue;
        }
        const word = /^[$\w]+/.exec(rest);
        const value = word?.[0] ?? quote;
        result.push({ value }); index += value.length;
    }
    return result;
}
function specifiers(source: string): string[] {
    const stream = tokens(source), result: string[] = [];
    stream.forEach((token, index) => {
        if (token.literal) return;
        const next = stream[index + 1], arg = stream[index + 2];
        if ((token.value === 'from' || token.value === 'import') && next?.literal) result.push(next.value);
        else if ((token.value === 'import' || token.value === 'require') && next?.value === '(' && arg?.literal) result.push(arg.value);
    });
    return result;
}
/** esbuild determines runtime edges; source tokens retain erased type-only dependencies. */
function dependencies(file: string, text = readFileSync(file, 'utf8')): Edge[] {
    const output = transformSync(text, { loader: file.endsWith('.ts') ? 'ts' : 'js', format: 'esm', legalComments: 'none' }).code;
    const runtime = new Set(specifiers(output));
    return specifiers(text).filter(specifier => specifier.startsWith('.')).map(specifier => {
        let target = resolve(dirname(file), specifier).replace(/\.js$/, '.ts');
        if (!/\.[cm]?[jt]s$/.test(target)) target += '.ts';
        return { target: relative(core, target).replace(/\\/g, '/'), runtime: runtime.has(specifier) };
    });
}
const graph = new Map([...sources].map(([name, file]) => [name, dependencies(file)]));
function forbidden(owner: string, target: string): boolean {
    if (owner.startsWith('domain/')) return !target.startsWith('domain/') && target !== 'utils/jsonTypes.ts';
    if (owner.startsWith('document/ast/')) return !target.startsWith('document/ast/');
    if (owner.startsWith('document/compose/')) return !/^(domain\/|document\/|diagnostics\/|utils\/)/.test(target);
    if (owner.startsWith('renderers/')) return /^(parsers\/|compatibility\/|domain\/|provider\/|api\/|engine\/|export\/|storage\/)/.test(target);
    if (owner.startsWith('parsers/')) {
        // The dispatcher and legacy-storage source decoder may explicitly reuse the historical record grammar.
        // Native RPC/Takeout/DOM parsers cannot reach this bridge.
        if ((owner === 'parsers/parseConversation.ts' || owner === 'parsers/legacyStorage/parseConversation.ts') && /^compatibility\/record\/(?:conversationRecord|parseConversationRecord)\.ts$/.test(target)) return false;
        return /^(compatibility\/|document\/|renderers\/|provider\/|api\/|engine\/|export\/|storage\/)/.test(target);
    }
    return false;
}

test('semantic layers own their files and obey dependency direction, including type-only references', () => {
    for (const [owner, edges] of graph) for (const edge of edges) {
        assert.ok(!forbidden(owner, edge.target), `${owner} must not depend on ${edge.target}`);
    }
    for (const old of ['api/parser/', 'content/', 'export/document/', 'engine/takeout/', 'engine/template/', 'provider/record/']) {
        assert.ok(![...sources.keys()].some(name => name.startsWith(old)), `obsolete directory still owns code: ${old}`);
    }
});

test('native parsers and renderers cannot acquire forbidden dependencies through a shared runtime helper', () => {
    for (const owner of graph.keys()) {
        if (!owner.startsWith('renderers/') && !/^parsers\/(gemini|shared)\//.test(owner)) continue;
        function walk(current: string, chain: string[], seen: Set<string>): void {
            if (seen.has(current)) return;
            seen.add(current);
            for (const edge of graph.get(current) ?? []) {
                if (!edge.runtime) continue;
                assert.ok(!forbidden(owner, edge.target), [...chain, edge.target].join(' → '));
                walk(edge.target, [...chain, edge.target], seen);
            }
        }
        walk(owner, [owner], new Set());
    }
});

test('boundary reader detects re-export, type-only, dynamic import and require escape routes', () => {
    const owner = resolve(core, 'renderers/html/probe.ts');
    const edges = dependencies(owner, `
        import type { DomainMessage } from '../../domain/conversationDetail.js';
        export { parseConversation } from '../../parsers/parseConversation.js';
        const decoder = import('../../parsers/gemini/rpc/detailDecoder.js');
        const storage = require('../../storage/storageService.js');
        type Record = import('../../compatibility/record/conversationRecord.js').ConversationRecordInput;
    `);
    assert.equal(edges.length, 5);
    assert.deepEqual(edges.map(edge => edge.runtime), [false, true, true, true, false]);
    assert.ok(edges.every(edge => forbidden('renderers/html/probe.ts', edge.target)));
});

test('native parsing does not allocate export paths or sanitized filenames', () => {
    const naming = new Set(['sanitizeFileName', 'sanitizeFileNameLegacy', 'sanitizeRelativePath',
        'getUniqueLocalName', 'buildExportFileName', 'buildExportFileNameLegacy', 'resolveExportFileName']);
    for (const [name, file] of sources) {
        if (!name.startsWith('parsers/')) continue;
        for (const token of tokens(readFileSync(file, 'utf8'))) {
            assert.ok(token.literal || !naming.has(token.value), `${name} uses export naming: ${token.value}`);
        }
    }
});
