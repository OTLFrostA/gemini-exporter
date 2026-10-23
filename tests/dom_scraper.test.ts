import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeminiDomList } from '../src/l1/parsers/gemini/dom/parseIndex.js';
import { isReservedRoute } from '../src/shared/utils/pathUtils.js';

const link = (href: string, textContent: string): HTMLAnchorElement => ({
    href,
    textContent,
    querySelector: () => null,
    getAttribute: (key: string) => key === 'href' ? href : null,
}) as unknown as HTMLAnchorElement;

test('DOM list parser observes history without scrolling or expanding it', () => {
    let mutations = 0;
    const doc = {
        querySelectorAll: () => [],
        querySelector: () => { throw new Error('Must not locate interactive controls'); },
        scroll: () => { mutations++; },
    } as unknown as Document;
    assert.deepEqual(parseGeminiDomList(doc), []);
    assert.equal(mutations, 0);
});

test('DOM index discovery skips reserved conversation routes', () => {
    for (const id of ['download', 'c_settings', 'trash', 'explore']) assert.equal(isReservedRoute(id), true);
    for (const id of ['c_1bd028d5c5b0c0e2', 'normal_chat_id', '', null]) assert.equal(isReservedRoute(id), false);
    const links = [
        link('https://gemini.google.com/app/1bd028d5c5b0c0e2', '火星猫咪'),
        link('https://gemini.google.com/app/trash', '垃圾桶'),
        link('https://gemini.google.com/app/c_7b29852ecae8344a', '贝尔不等式推导'),
    ];
    const doc = { querySelectorAll: () => links } as unknown as Document;
    const observed = parseGeminiDomList(doc);
    assert.deepEqual(observed.map(item => [item.id, item.title, item.titleSource]), [
        ['1bd028d5c5b0c0e2', '火星猫咪', 'dom'],
        ['7b29852ecae8344a', '贝尔不等式推导', 'dom'],
    ]);
});

test('DOM index discovery does not expand collapsed recent controls', () => {
    let clicked = false;
    const doc = {
        querySelector: () => ({ click: () => { clicked = true; } }),
        querySelectorAll: () => [],
    } as unknown as Document;
    assert.deepEqual(parseGeminiDomList(doc), []);
    assert.equal(clicked, false);
});
