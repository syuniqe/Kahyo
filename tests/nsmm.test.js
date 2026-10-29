// ThoughtSense Engine v2 tests: node --test tests/nsmm.test.js
const test = require('node:test');
const assert = require('node:assert');
const N = require('../js/nsmm.js');

// Seeded random vectors so every run is the same.
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const D = 128;
const unit = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};
const vec = () => unit(Array.from({ length: D }, gauss));
const mix = (a, b, w) => unit(a.map((x, i) => x + w * b[i]));
const base = vec();
const fs = (e, words = 12) => ({ event: Array.from({ length: words }, (_, i) => 'word' + i).join(' '), embedding: e, subjects: [], promises: [], environment: [] });
const steady = (n, noise = 0.8) => Array.from({ length: n }, () => fs(mix(base, vec(), noise)));

test('direction limit X = TF·180·(1.2 − 0.2y), between 10° and 180°', () => {
  assert.strictEqual(Math.round(N.directionLimit(0.35, 'Origin')), 63);
  assert.strictEqual(Math.round(N.directionLimit(0.35, 'Conclusion')), 13);
  assert.strictEqual(N.directionLimit(0.35, 'Climax'), N.directionLimit(0.35, 'Conclusion'));
  assert.strictEqual(Math.round(N.directionLimit(1, 'Origin')), 180);
  assert.strictEqual(N.directionLimit(0.1, 'Conclusion'), 10);
  assert.strictEqual(N.directionLimit(0.35, null), N.directionLimit(0.35, 'Origin'));
});

test('terminancy factor grows with the planned length', () => {
  assert.strictEqual(N.autoTerminancy(60), 0.35);
  assert.strictEqual(N.autoTerminancy(30), 0.3);
  assert.ok(N.autoTerminancy(300) > N.autoTerminancy(60));
  assert.ok(N.autoTerminancy(1) >= 0.1);
});

test('stage labels appear at 20% of the plan, between 3 and 20', () => {
  assert.strictEqual(N.stageLabelAfter(60), 12);
  assert.strictEqual(N.stageLabelAfter(10), 3);
  assert.strictEqual(N.stageLabelAfter(300), 20);
});

test('magnitude ignores filler and repeats', () => {
  const filler = N.magnitude({ event: 'So um basically he like walks to the door and so yeah he walks to the door', subjects: ['he'] });
  const dense = N.magnitude({ event: "Krishna reveals he is Arjun's father; the war begins", subjects: ['Krishna', 'Arjun'] });
  assert.ok(dense > filler);
});

test('a steady story stays on course with no sign bias', () => {
  const main = [];
  let pos = 0;
  let neg = 0;
  steady(40).forEach((f, i) => {
    const m = N.scoreFootstep(f, main, { tf: 0.35 });
    if (i >= 3) {
      assert.strictEqual(m.dirStatus, 'on');
      if (m.direction > 0) pos++;
      if (m.direction < 0) neg++;
    }
    main.push(f);
  });
  assert.ok(Math.abs(pos - neg) <= 8, `sign split ${pos}/${neg}`);
});

test('a far tangent is off course', () => {
  const main = steady(15);
  const m = N.scoreFootstep(fs(vec()), main, { tf: 0.35 });
  assert.strictEqual(m.dirStatus, 'off');
});

test('nothing is judged before 3 Footsteps', () => {
  const m = N.scoreFootstep(fs(vec()), steady(2), { tf: 0.35 });
  assert.strictEqual(m.dirStatus, 'on');
  assert.strictEqual(m.sizeFlag, null);
});

test('Jump at double the median size, Crawl at half', () => {
  const main = steady(6).map((f) => ({ ...f, event: f.event }));
  main.push(fs(mix(base, vec(), 0.8), 200)); // one outlier must not move the median
  assert.strictEqual(N.scoreFootstep(fs(mix(base, vec(), 0.8), 12), main, { tf: 0.35 }).sizeFlag, null);
  assert.strictEqual(N.scoreFootstep(fs(mix(base, vec(), 0.8), 30), main, { tf: 0.35 }).sizeFlag, 'jump');
  assert.strictEqual(N.scoreFootstep(fs(mix(base, vec(), 0.8), 4), main, { tf: 0.35 }).sizeFlag, 'crawl');
});

test('near-copies do not make a normal Footstep look off course', () => {
  const e = vec();
  const main = [fs(e), fs(e), fs(mix(e, vec(), 0.02))];
  const m = N.scoreFootstep(fs(mix(base, vec(), 0.8)), main, { tf: 0.35 });
  assert.strictEqual(m.dirStatus, 'on');
});

test('mixed embedding sizes never give NaN', () => {
  const main = [...steady(4), fs(N.localEmbedding('the king rides north'))];
  const m = N.scoreFootstep(fs(mix(base, vec(), 0.8)), main, { tf: 0.35 });
  assert.ok(Number.isFinite(m.direction));
});

test('a side path starts at branching factor near 0 and terminates as it drifts', () => {
  const main = steady(15);
  const start = N.scoreFootstep(fs(vec()), main, { tf: 0.35 });
  assert.ok(start.iv.length < 0.1);
  const later = N.scoreFootstep(fs(vec()), main, { tf: 0.35, rootDirection: start.direction - 120, rootMagnitude: start.magnitude });
  assert.ok(later.iv.length >= 0.35);
  assert.strictEqual(N.branchState(later.iv.length, 0.35), 'terminate');
  assert.strictEqual(N.branchState(0.2, 0.35, 0.45), 'drifting');
  assert.strictEqual(N.branchState(0.1, 0.35, 0.45), 'ok');
});

test('stages only move forward', () => {
  assert.deepStrictEqual(N.monotonicStages(['Origin', 'Maxspan', 'Origin', 'Climax']), ['Origin', 'Maxspan', 'Maxspan', 'Conclusion']);
});
