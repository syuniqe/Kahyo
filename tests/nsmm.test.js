// ThoughtSense Engine v2 tests: node --test tests/nsmm.test.js
const test = require('node:test');
const assert = require('node:assert');
const N = require('../server/thoughtsense.js');

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

test('a Footstep that says the same again is flagged as a repeat', () => {
  const a = { id: 'FS#001', thread: 'main', event: 'Meera finds the forged ledger under the bed', subjects: [], embedding: N.localEmbedding('Meera finds the forged ledger under the bed') };
  const b = { id: 'FS#002', thread: 'main', event: 'The caravan reaches the river at noon', subjects: [], embedding: N.localEmbedding('The caravan reaches the river at noon') };
  const c = { id: 'FS#003', thread: 'main', event: 'Meera finds the forged ledger under his bed', subjects: [], embedding: N.localEmbedding('Meera finds the forged ledger under his bed') };
  const out = N.scoreJourney({ footsteps: [a, b, c] });
  assert.strictEqual(out.metrics['FS#002'].repeat, null);
  assert.strictEqual(out.metrics['FS#003'].repeat.id, 'FS#001');
  assert.strictEqual(out.info.autoTf, 0.35);
  assert.strictEqual(out.info.stageAfter, 12);
});

test('scoreJourney measures a side path from its first Footstep', () => {
  const main = steady(12).map((f, i) => ({ ...f, id: 'M' + i, thread: 'main', event: 'word' + i + ' story beat number ' + i }));
  const s1 = { ...fs(vec()), id: 'B1', thread: 'branch', pathStart: 'B1', event: 'alpha beta gamma delta' };
  const s2 = { ...fs(vec()), id: 'B2', thread: 'branch', pathStart: 'B1', event: 'epsilon zeta eta theta' };
  const out = N.scoreJourney({ footsteps: [...main, s1, s2] });
  assert.ok(out.metrics.B1.iv.length < 0.1);
  assert.ok(['ok', 'drifting', 'terminate'].includes(out.metrics.B2.branch));
});

test('scoring only the changed tail gives the same results as scoring everything', () => {
  const steps = steady(25).map((f, i) => ({ ...f, id: 'T' + i, thread: 'main', event: 'beat ' + i + ' of the story with salt and road' }));
  steps.push({ ...fs(vec()), id: 'T25', thread: 'main', event: 'a dragon sings on the moon' });
  const all = N.scoreJourney({ footsteps: steps });
  const known = steps.map((f, i) => (i < 20 ? { ...f, known: { direction: all.metrics[f.id].direction, magnitude: all.metrics[f.id].magnitude, judged: all.metrics[f.id].judged } } : f));
  const tail = N.scoreJourney({ footsteps: known, from: 20 });
  assert.strictEqual(tail.metrics.T3.dirStatus, all.metrics.T3.dirStatus);
  for (let i = 20; i < 26; i++) {
    assert.strictEqual(tail.metrics['T' + i].dirStatus, all.metrics['T' + i].dirStatus);
    assert.ok(Math.abs(tail.metrics['T' + i].direction - all.metrics['T' + i].direction) < 1, `T${i}`);
  }
});

test('the fast whole-Journey scorer agrees with the step-by-step reference', () => {
  const steps = steady(30, 1.0).map((f, i) => ({ ...f, id: 'R' + i, thread: 'main', event: 'r' + i + ' beat ' + i }));
  for (let i = 0; i < 4; i++) steps.splice(8 + i * 5, 0, { ...fs(vec()), id: 'X' + i, thread: 'main', event: 'tangent ' + i });
  const fast = N.scoreJourney({ footsteps: steps, tf: 0.35 });
  const prior = [];
  let agree = 0;
  steps.forEach((f) => {
    const ref = N.scoreFootstep(f, prior, { tf: 0.35 });
    const got = fast.metrics[f.id];
    if (ref.dirStatus === got.dirStatus && Math.abs(Math.abs(ref.direction) - Math.abs(got.direction)) < 0.5) agree++;
    prior.push(f);
  });
  assert.ok(agree >= steps.length - 1, `${agree}/${steps.length} agree`);
});
