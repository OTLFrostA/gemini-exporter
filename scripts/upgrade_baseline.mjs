import assert from 'node:assert/strict';
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
    return slot && Array.isArray(rows) ? rows.map(row => ({ slot, row })) : [];
  });
  const details = state.databases?.gemini_exporter_details_idb?.stores?.conversation_details || [];
  return lists.flatMap(({ slot, row }) => {
    const candidates = [row, ...details.filter(detail => String(detail.id).replace(/^c_/, '') === row.id)];
    const size = value => Math.max(value.messages?.length || 0, value.turns?.length || 0);
    const source = candidates.reduce((best, value) => size(value) > size(best) ? value : best, row);
    if (!size(source)) return [];
    assert.equal(new Set(lists.filter(entry => entry.row.id === row.id).map(entry => entry.slot)).size, 1, 'Persisted body has ambiguous account ownership');
    const body = Object.fromEntries(['messages', 'turns'].filter(key => source[key]?.length).map(key => [key, source[key]]));
    const texts = [];
    const collect = (value, key) => {
      if (typeof value === 'string' && ['content', 'text', 'userContent', 'modelContent', 'thoughts', 'thinking'].includes(key) && value.trim()) texts.push(value);
      else if (object(value)) for (const [name, child] of Object.entries(value)) collect(child, Array.isArray(value) ? key : name);
    };
    collect(body, 'body');
    return [{ slot, id: row.id, body, texts }];
  });
}
export function assertPersistedBaseline(before, after) {
  const saved = new Set(); walk(after, value => { if (object(value)) saved.add(canonical(value)); });
  for (const fact of bodyFacts(before)) for (const value of Object.values(fact.body)) {
    assert.ok(saved.has(canonical(value)), `Persisted original body lost: ${fact.slot}/${fact.id}`);
  }
  const bytes = byteFacts(after).map(canonical);
  for (const fact of byteFacts(before)) assert.ok(bytes.includes(canonical(fact)), 'Persisted resource bytes lost or changed');
}
export function upgradeOutcome(stages) {
  if (stages.some(stage => !['passed', 'not_applicable'].includes(stage.status))) return 'failed';
  return stages.some(stage => stage.status === 'not_applicable') ? 'passed_with_na' : 'passed';
}
