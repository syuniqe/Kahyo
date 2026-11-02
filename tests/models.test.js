// NSMM registry and Worker routes: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { MODELS, getModel, publicModels } = require('../server/models/index.js');

test('four models, Wordwalk live and the rest coming soon', () => {
  assert.deepStrictEqual(MODELS.map((m) => m.id), ['wordwalk', 'rhyme', 'reason', 'juris']);
  assert.strictEqual(getModel('wordwalk').status, 'live');
  for (const id of ['rhyme', 'reason', 'juris']) {
    assert.strictEqual(getModel(id).status, 'coming-soon');
    assert.strictEqual(getModel(id).engine, null);
  }
});

test('a Journey with no model is a Wordwalk Journey', () => {
  assert.strictEqual(getModel(undefined).id, 'wordwalk');
  assert.strictEqual(getModel('nope'), null);
});

test('every model is defined in plain words', () => {
  for (const m of MODELS) {
    for (const k of ['id', 'name', 'status', 'for', 'flow']) assert.ok(typeof m[k] === 'string' && m[k], `${m.id}.${k}`);
    assert.ok(m.map && m.map.layout && m.map.reads, `${m.id}.map`);
    assert.ok(Array.isArray(m.phases) && m.phases.length, `${m.id}.phases`);
  }
});

test('the browser only learns the picker words and status', () => {
  for (const m of publicModels()) assert.deepStrictEqual(Object.keys(m).sort(), ['flow', 'for', 'id', 'name', 'status']);
});

test('the Worker routes by model', async () => {
  let worker;
  try {
    worker = (await import('../server/worker.js')).default;
  } catch {
    return; // the Anthropic SDK is not installed here (npm install)
  }
  const call = (body) => worker.fetch(new Request('https://x/api/engine', { method: 'POST', body: JSON.stringify(body) }), {});
  const list = await (await call({ op: 'models' })).json();
  assert.strictEqual(list.models.length, 4);
  const scored = await (await call({ op: 'score', footsteps: [] })).json();
  assert.ok(scored.metrics && scored.info);
  const soon = await call({ op: 'score', nsmm: 'rhyme', footsteps: [] });
  assert.strictEqual(soon.status, 409);
});
