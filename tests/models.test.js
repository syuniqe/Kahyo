// NSMM registry and Worker routes: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const { MODELS, getModel, publicModels } = require('../server/models/index.js');

test('four models, all live with an engine and prompts', () => {
  assert.deepStrictEqual(MODELS.map((m) => m.id), ['wordwalk', 'rhyme', 'reason', 'juris']);
  for (const m of MODELS) {
    assert.strictEqual(m.status, 'live');
    assert.ok(m.engine && typeof m.engine.score === 'function', m.id);
    assert.ok(m.tasks && typeof m.tasks.extract === 'function' && typeof m.tasks.draft === 'function', m.id);
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
  const rhyme = await (await call({ op: 'score', nsmm: 'rhyme', footsteps: [] })).json();
  assert.ok(rhyme.metrics && Array.isArray(rhyme.notes));
  const placed = await (await call({ op: 'place', nsmm: 'reason', text: 'Method: we surveyed 40 schools' })).json();
  assert.strictEqual(placed.phase, 'Methodology');
});
