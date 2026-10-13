import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const object = value => value && typeof value === 'object';
const canonical = value => JSON.stringify(value, (_, entry) => object(entry) && !Array.isArray(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
function walk(value, visit) {
  visit(value);
  if (object(value)) for (const child of Object.values(value)) walk(child, visit);
}
export function byteFacts(state) {
  const facts = [];
  walk(state, value => {
    if (object(value) && value.binarySnapshot === true && Number.isInteger(value.byteLength) && value.byteLength > 0 && /^[a-f0-9]{64}$/.test(value.sha256 || '')) {
      facts.push({ byteLength: value.byteLength, sha256: value.sha256 });
    }
  });
  return facts;
}
// Evidence comes only from the old runtime's disk snapshot, never its downloaded ZIP.
export function bodyFacts(state) {
  const lists = Object.entries(state.local).flatMap(([key, rows]) => {
    const slot = key === 'gemini_conversations' ? 'u0' : key.match(/^gemini_conversations_(u\d+)$/)?.[1];
    return slot && Array.isArray(rows) ? rows.filter(row => object(row)
      && ['string', 'number'].includes(typeof row.id)).map(row => ({ slot, row })) : [];
  });
  const details = state.databases?.gemini_exporter_details_idb?.stores?.conversation_details || [];
  return lists.flatMap(({ slot, row }) => {
    const id = String(row.id).replace(/^c_/, '').trim();
    const candidates = [row, ...details.filter(detail => object(detail) && String(detail.id).replace(/^c_/, '').trim() === id)];
    const size = value => Math.max(Array.isArray(value.messages) ? value.messages.length : 0, Array.isArray(value.turns) ? value.turns.length : 0);
    const source = candidates.reduce((best, value) => size(value) > size(best) ? value : best, row);
    if (!size(source)) return [];
    if (source !== row) assert.equal(new Set(lists.filter(entry => String(entry.row.id).replace(/^c_/, '').trim() === id).map(entry => entry.slot)).size, 1, 'Persisted body has ambiguous account ownership');
    const body = Object.fromEntries(['messages', 'turns'].filter(key => Array.isArray(source[key]) && source[key].length).map(key => [key, source[key]]));
    const texts = [];
    const collect = (value, key) => {
      if (typeof value === 'string' && ['content', 'text', 'userContent', 'modelContent', 'thoughts', 'thinking'].includes(key) && value.trim()) texts.push(value);
      else if (object(value)) for (const [name, child] of Object.entries(value)) collect(child, Array.isArray(value) ? key : name);
    };
    collect(body, 'body');
    return [{ slot, id, body, texts, raw: { metadata: row, ...(source !== row ? { detail: source } : {}) } }];
  });
}
let domainContracts;
async function loadDomainContracts() {
  // Reuse production migration and disk recovery contracts, without copying
  // their schemas into the harness or modifying the old profile.
  domainContracts ??= (async () => {
    const { build } = await import('esbuild');
    const result = await build({ stdin: { contents: `
      export { parseLegacyStorageConversation } from './src/core/parsers/legacyStorage/parseConversation.ts';
      export { readStorageDomain } from './src/core/storage/domain/validate.ts';`,
      resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts' },
      bundle: true, write: false, format: 'esm', platform: 'node' });
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  })();
  return domainContracts;
}

export async function assertPersistedBaseline(before, after) {
  const domainDB = after.databases?.gemini_exporter_domain;
  const domainStore = domainDB?.stores?.conversations;
  const legacy = domainDB === undefined ? bodyFacts(after) : [];
  for (const fact of bodyFacts(before)) {
    const message = `Persisted original body lost: ${fact.slot}/${fact.id}`;
    if (domainDB === undefined) {
      const saved = legacy.find(value => value.slot === fact.slot && value.id === fact.id);
      assert.ok(saved && Object.entries(fact.body).every(([key, value]) => canonical(saved.body[key]) === canonical(value)), message);
      continue;
    }
    assert.ok(Array.isArray(domainStore), message);
    const key = JSON.stringify(['gemini', fact.slot, fact.id]);
    const records = domainStore.filter(record => record?.key === key);
    assert.equal(records.length, 1, message);
    const record = records[0];
    assert.deepEqual(record.identity, { providerId: 'gemini', accountSlot: fact.slot, conversationId: fact.id }, message);
    assert.equal(record.storageVersion, 2, message);
    assert.equal(record.domainVersion, 1, message);
    const { parseLegacyStorageConversation, readStorageDomain } = await loadDomainContracts();
    const saved = readStorageDomain(record.conversation);
    assert.equal(saved.providerId, 'gemini', message);
    assert.equal(String(saved.id).replace(/^c_/, '').trim(), fact.id, message);
    const expected = parseLegacyStorageConversation(fact.raw, { providerId: 'gemini' }).conversation;
    assert.equal(canonical(saved.messages), canonical(expected.messages), message);
    assert.equal(canonical(saved.assets), canonical(expected.assets), message);
  }
  const bytes = byteFacts(after).map(canonical);
  for (const fact of byteFacts(before)) assert.ok(bytes.includes(canonical(fact)), 'Persisted resource bytes lost or changed');
}
export function upgradeOutcome(stages) {
  if (stages.some(stage => !['passed', 'not_applicable'].includes(stage.status))) return 'failed';
  return stages.some(stage => stage.status === 'not_applicable') ? 'passed_with_na' : 'passed';
}
