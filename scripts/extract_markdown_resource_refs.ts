/** Syntax only: archive URL/path semantics remain in the Python resolver. */
import { readFileSync } from 'node:fs';
import type { Root, RootContent } from 'mdast';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { math } from 'micromark-extension-math';
import { mathFromMarkdown } from 'mdast-util-math';
import { preprocessGeminiMarkdown } from '../src/core/export/canonical/compat/rules.js';
import { collectDefinitions } from '../src/core/export/canonical/markdown/mdastToCanonical.js';

export interface MarkdownResourceReference {
    kind: 'image' | 'link';
    reference: string;
}

/** Identical production stack/options; no oracle-specific syntax policy. */
export function parseExportedMarkdown(markdown: string): Root {
    return fromMarkdown(preprocessGeminiMarkdown(markdown), {
        extensions: [gfm(), math()],
        mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
    });
}

export function extractMarkdownResourceReferences(markdown: string): MarkdownResourceReference[] {
    const tree = parseExportedMarkdown(markdown);
    const definitions = new Map<string, { url: string; title?: string }>();
    collectDefinitions(tree, definitions);
    const references: MarkdownResourceReference[] = [];
    const visit = (node: Root | RootContent): void => {
        if (node.type === 'link' || node.type === 'image') {
            references.push({ kind: node.type, reference: node.url });
        } else if (node.type === 'linkReference' || node.type === 'imageReference') {
            const definition = definitions.get(node.identifier.trim().toLowerCase());
            if (definition) references.push({
                kind: node.type === 'imageReference' ? 'image' : 'link', reference: definition.url,
            });
        }
        if ('children' in node) for (const child of node.children) visit(child);
    };
    visit(tree);
    return references;
}

if (require.main === module) {
    try {
        process.stdout.write(JSON.stringify(extractMarkdownResourceReferences(readFileSync(0, 'utf8'))));
    } catch (error) {
        process.stderr.write(`Markdown resource extraction failed: ${String(error)}\n`);
        process.exitCode = 1;
    }
}
