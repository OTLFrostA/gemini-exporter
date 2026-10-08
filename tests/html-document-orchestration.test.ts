import { historicalFixture } from './helpers/nativeFixture.js';
/** Public HTML orchestration and the pure Document AST backend. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatExportInput } from '../src/core/engine/chatFormatter.js';
import { formatHtmlDocument } from '../src/core/engine/chatFormatter.js';
import { parseFixture } from './helpers/documentFixture.js';
import { renderDocumentHtml } from '../src/core/renderers/html/renderHtml.js';
import { collectDocumentResources } from '../src/core/document/ast/resourceReferences.js';
test('HTML export returns the delivery contract and uses prepared offline destinations', async () => {
    const raw = { id: 'html', title: 'HTML export', messages: [{ role: 'user', content: 'look at this', attachments: [{ type: 'image', localName: 'assets/x.png', name: 'x.png' }] }] };
    const result = await formatHtmlDocument(historicalFixture(raw));
    assert.equal(result.mime, 'text/html');
    assert.equal(result.ext, 'html');
    assert.ok(result.content.startsWith('<!DOCTYPE html>'));
    assert.ok(result.content.includes('assets/x.png'));
    const { domain, document, resources } = await parseFixture(raw);
    assert.deepEqual([...collectDocumentResources(document).referencedIds], [domain.assets[0].id]);
    assert.equal(resources[domain.assets[0].id], 'assets/x.png');
    assert.ok(!JSON.stringify(domain).includes('assets/x.png'));
});
test('unprepared resources remain visible and carry an explicit backend diagnostic', async () => {
    const { document } = await parseFixture({ id: 'missing', messages: [{ role: 'model', content: 'file below', attachments: [{ type: 'file', name: 'y.pdf' }] }] });
    const result = renderDocumentHtml(document, {});
    assert.ok(result.html.includes('gem-missing-asset'));
    assert.ok(result.html.includes('y.pdf'));
    assert.equal(result.diagnostics.filter(d => d.code === 'HTML_ASSET_UNRESOLVED').length, 1);
});
