// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const N = require('../js/nsmm.js');

test('slot intensity uses the documented weights', () => {
  // Worked example from the NSMM math doc: 0.35·0.9 + 0.25·2 + 0.25·2 + 0.15·0 = 1.315
  const fs = { plot_intensity: 0.9, subjects: ['hero', 'villain'], promises: ['a', 'b'], world_rules: [] };
  assert.ok(Math.abs(N.slotIntensitySum(fs) - 1.315) < 1e-9);
});

test('stage multiplier scales magnitude', () => {
  const fs = { event: 'The hero discovers the lair', plot_intensity: 1, subjects: ['hero'] };
  const origin = N.magnitude(fs, 'Origin');
  const climax = N.magnitude(fs, 'Climax');
  assert.ok(Math.abs(climax / origin - 2.0 / 0.6) < 1e-9);
});

test('first footstep is aligned by definition', () => {
  const m = N.scoreFootstep({ event: 'Opening', embedding: [1, 0] }, [], 'Origin');
  assert.strictEqual(m.angle, 0);
  assert.strictEqual(m.terminancy, 0);
  assert.strictEqual(m.is_branch_candidate, false);
});

test('an opposite, diverging footstep crosses the terminancy threshold', () => {
  const base = { event: 'The heist team plans the robbery', subjects: ['A'], plot_intensity: 0.6, intent_signal: 0.5 };
  const prior = [];
  for (let i = 0; i < 3; i++) {
    const f = { ...base, embedding: [1, 0.1 * i] };
    f.metrics = N.scoreFootstep(f, prior, 'Pandiculation');
    prior.push(f);
  }
  const tangent = { ...base, intent_signal: -1, embedding: [-1, 0] };
  const m = N.scoreFootstep(tangent, prior, 'Pandiculation');
  assert.ok(m.angle > 170, 'angle near 180°');
  assert.ok(m.contradiction_review);
  assert.ok(m.is_branch_candidate);
});

test('local embeddings are unit length and similar for similar text', () => {
  const a = N.localEmbedding('Meera leads the village onto the salt pans');
  const b = N.localEmbedding('The village follows Meera to the salt pans');
  const c = N.localEmbedding('A dhow sails through storms to Zanzibar');
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
  assert.ok(N.cosine(a, b) > N.cosine(a, c));
});
