import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inventory } from '../scripts/audit-provider-fixtures.cjs';
import { detailGen, treeGen } from './fixtures/providers/grokDetail.js';
import { listGen } from './fixtures/providers/grokList.js';

test('provider fixture references resolve and generators never execute a production parser', () => {
    assert.deepEqual(inventory().unresolved, []);
    const folder = join(__dirname, 'fixtures/providers');
    for (const name of readdirSync(folder).filter(name => name.endsWith('.ts'))) {
        const source = readFileSync(join(folder, name), 'utf8');
        const runtimeImports = [...source.matchAll(/import\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g)];
        assert.deepEqual(runtimeImports.filter(match => match[1].includes('/src/')).map(match => match[1]), [], name);
        assert.doesNotMatch(source, /(?:require\s*\(|import\s*\()\s*['"][^'"]*\/src\//, name);
    }
});

test('Grok endpoint fixtures isolate provider mutations from subsequent reads', () => {
    const detail = detailGen('GR_DETAIL_TEXT_01');
    const image = detailGen('GR_DETAIL_IMAGE_01');
    detail.bodies.responses.pop();
    detail.metadata.conversation.title = 'changed';
    image.tree.responseNodes.pop();
    const tree = treeGen('GR_TREE_INFLIGHT_01');
    tree.responseNodes.pop();
    const list = listGen('GR_LIST_TERMINAL_01');
    list.conversations[0].title = 'changed';
    assert.equal(detailGen('GR_DETAIL_TEXT_01').bodies.responses.length, 2);
    assert.equal(detailGen('GR_DETAIL_IMAGE_01').tree.responseNodes.length, 6);
    assert.equal(treeGen('GR_TREE_STABLE_01').responseNodes.length, 2);
    assert.deepEqual(treeGen('GR_TREE_STABLE_01').inflightResponses, []);
    assert.equal(listGen('GR_LIST_TERMINAL_01').conversations[0].title, 'Exporter Integration Test Comparison Table');
});
