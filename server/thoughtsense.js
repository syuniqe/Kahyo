// ThoughtSense Engine: the maths layer of the Wordwalk Model (a Narrative Storyline Mapping Model).
// It turns thoughts and words into vectors and logical operations on them (v2).
// Magnitude, signed direction, the intent vector of side paths and terminancy.
// Server only: runs inside the Cloudflare Worker (and Node for tests), never in the browser.
const STAGES = ['Origin', 'Pandiculation', 'Maxspan', 'Convergence', 'Conclusion'];
// Older Journeys and models may still say Climax.
const STAGE_ALIASES = { Climax: 'Conclusion' };
const stageName = (s) => STAGE_ALIASES[s] || s;

const DEFAULT_PLANNED_LENGTH = 60;

// A Footstep carrying more than this much is probably two Footsteps.
const SPLIT_AT = 30;

// Jump / Crawl: magnitude double or half the main thread's typical (median) size,
// so both sit at ±1 on the intent vector's magnitude axis.
const JUMP = 2;
const CRAWL = 0.5;

// Branching kicks in at this share of the terminancy factor (writer can change it).
const DEFAULT_BRANCH_SHARE = 0.45;

// The thread heading blends the whole story with its recent Footsteps, so the story
// may evolve without every new chapter looking off course.
const RECENCY = 0.8;
const RECENT_SHARE = 0.5;
const BASELINE_WINDOW = 12;
const MIN_TO_JUDGE = 3;
// Footsteps this alike count as one when judging the thread's spread.
const DUPLICATE = 0.97;
// Spread up to this many times the typical one is normal variation (0°).
const NOISE = 1.2;

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosine(a, b) {
  const n = norm(a) * norm(b);
  return n === 0 ? 0 : dot(a, b) / n;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function unit(v) {
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round2 = (x) => Math.round(x * 100) / 100;

// ---------- stages and factors ----------

// Stage labels appear once 20% of the planned Footsteps exist (at least 3, at most 20).
function stageLabelAfter(plannedLength = DEFAULT_PLANNED_LENGTH) {
  return clamp(Math.ceil(0.2 * plannedLength), 3, 20);
}

// y in the direction limit: 1 for Origin … 5 for Conclusion (1 before stages exist).
function stageNumber(stage) {
  const i = STAGES.indexOf(stageName(stage));
  return i === -1 ? 1 : i + 1;
}

// Terminancy factor from the planned length: longer stories are more lenient.
// TF = 0.30 + 0.05·log2(L / 30), two decimals, between 0.10 and 1.00 (60 Footsteps → 0.35).
function autoTerminancy(plannedLength = DEFAULT_PLANNED_LENGTH) {
  return round2(clamp(0.3 + 0.05 * Math.log2(Math.max(1, plannedLength) / 30), 0.1, 1));
}

// X = TF · 180° · (1.2 − 0.2·y), at least 10°. Each later stage tightens the limit,
// so the story is held to a conclusive ending (TF 0.35: 63° at Origin → 13° at Conclusion).
function directionLimit(tf, stage) {
  return clamp(tf * 180 * (1.2 - 0.2 * stageNumber(stage)), 10, 180);
}

// ---------- one Footstep ----------

// How much happens: distinct content words (filler and repeats don't count)
// plus each character, setup and environment named.
function dataAmount(fs) {
  const words = new Set(contentWords([fs.event, fs.context].filter(Boolean).join(' '))).size;
  const env = fs.environment ?? fs.world_rules;
  const items = (fs.subjects?.length ?? 0) + (fs.promises?.length ?? 0) + (env?.length ?? 0);
  return words + 3 * items;
}

// Magnitude is the amount of things happening in the Footstep.
function magnitude(fs) {
  return dataAmount(fs);
}

// Intensity (0–1) is the impact of what happens; it sets the circle size.
// The AI judges it; offline it follows how much the Footstep holds.
function intensity(fs) {
  if (Number.isFinite(fs.intensity)) return clamp(fs.intensity, 0, 1);
  return clamp(dataAmount(fs) / SPLIT_AT, 0, 1);
}

// ---------- the thread ----------

// G = centroid of the thread's meanings, R = recency-weighted centroid,
// H = unit(½·G + ½·R) the heading, u = the way the story is moving (R − G),
// baseline = how far a typical Footstep sits from the others (leave-one-out).
// Only vectors of one size are compared (`dim`): a Journey mixing offline and
// Gemini embeddings must be re-embedded, and the odd ones are skipped meanwhile.
function thread(footsteps, wantDim) {
  let embs = footsteps.filter((f) => f.embedding).map((f) => unit(f.embedding));
  const sizeOf = wantDim || embs[embs.length - 1]?.length;
  embs = embs.filter((e) => e.length === sizeOf);
  // The typical magnitude is the median, so one huge Footstep can't make the rest look small.
  const avgMagnitude = median(footsteps.map(magnitude));
  if (!embs.length) return { count: 0, distinct: 0, avgMagnitude, size: footsteps.length };
  const dim = embs[0].length;
  const g = new Array(dim).fill(0);
  const r = new Array(dim).fill(0);
  embs.forEach((e, i) => {
    const w = Math.pow(RECENCY, embs.length - 1 - i);
    for (let k = 0; k < dim; k++) {
      g[k] += e[k];
      r[k] += w * e[k];
    }
  });
  const G = unit(g);
  const R = unit(r);
  const H = unit(G.map((x, k) => (1 - RECENT_SHARE) * x + RECENT_SHARE * R[k]));
  // Near-copies say nothing about how spread out the story is.
  const kept = [];
  embs.forEach((e) => {
    if (!kept.some((k) => cosine(k, e) > DUPLICATE)) kept.push(e);
  });
  const from = Math.max(0, kept.length - BASELINE_WINDOW);
  const baseline = median(kept.slice(from).map((e) => 1 - cosine(e, g.map((x, k) => x - e[k]))));
  return {
    G,
    H,
    u: storyAxis(embs),
    mean: g.map((x) => x / embs.length),
    baseline: Math.max(baseline, 0.02),
    count: embs.length,
    distinct: kept.length,
    dim: sizeOf,
    avgMagnitude,
    size: footsteps.length,
  };
}

// The story's main side-to-side axis: the first principal component of the past
// Footsteps around their plain average. Built only from the past, so a new
// Footstep is equally likely to land on either side. Oriented so the opening
// Footstep sits on the − side: + means toward where the story has been going.
function storyAxis(embs) {
  const dim = embs[0].length;
  const mean = new Array(dim).fill(0);
  embs.forEach((e) => e.forEach((x, k) => (mean[k] += x / embs.length)));
  const res = embs.map((e) => e.map((x, k) => x - mean[k]));
  let v = res.reduce((a, r) => a.map((x, k) => x + r[k] * (k % 2 ? 1 : -1)), new Array(dim).fill(0));
  if (norm(v) < 1e-9) v = res[res.length - 1].slice();
  for (let it = 0; it < 40; it++) {
    const next = new Array(dim).fill(0);
    res.forEach((r) => {
      const p = dot(r, v);
      for (let k = 0; k < next.length; k++) next[k] += p * r[k];
    });
    if (norm(next) < 1e-12) break;
    v = unit(next);
  }
  if (dot(res[0], v) > 0) v = v.map((x) => -x);
  return v;
}

// Signed direction in degrees against the thread heading.
// z = stray / typical stray. Up to 1.2 × typical is the story's normal variation and
// reads 0°, so tight late-stage limits flag real turns, not noise. Beyond it,
// |θ| = clamp((z − 1.2) / 0.8 · 90°, 0, 180°): twice as far as typical is 90°, three times 180°. The sign says which side:
// + (anticlockwise) leans the way the story has been moving, − (clockwise) back
// toward where it started, measured on the story's main axis (storyAxis).
function deviation(embedding, t) {
  if (!embedding || !t || t.distinct < MIN_TO_JUDGE || embedding.length !== t.dim) return { degrees: 0, stray: 0, z: 0 };
  const e = unit(embedding);
  const c = cosine(e, t.H);
  const stray = 1 - c;
  const z = stray / t.baseline;
  const side = dot(
    e.map((x, k) => x - t.mean[k]),
    t.u
  );
  const size = clamp(((z - NOISE) / (2 - NOISE)) * 90, 0, 180);
  return { degrees: side < 0 ? -size : size, stray, z };
}

// Intent vector of a side-path Footstep: aî + bĵ, a = magnitude gap, b = direction gap,
// both against the side path's first Footstep (m₀, θ₀).
//   a = clamp(log2(m / m₀), −1, 1)   (double or half = ±1)
//   b = (θ − θ₀) / 180°
//   branching factor = √(a² + b²) / √2   (0 = like the main thread, 1 = as far as it gets)
function intentVector(m, degrees, ref) {
  const a = ref > 0 && m > 0 ? clamp(Math.log2(m / ref), -1, 1) : 0;
  const b = clamp(degrees / 180, -1, 1);
  return { magnitude: a, direction: b, length: Math.sqrt(a * a + b * b) / Math.SQRT2 };
}

// Scores a Footstep against the main thread as it stood before it arrived.
// opts: { tf, stage, rootDirection, rootMagnitude }: the direction and magnitude of
// the side path's first Footstep, so a side path's intent vector measures how far it
// has moved since it branched, not the distance that made it a branch.
function scoreFootstep(fs, mainBefore, opts = {}) {
  const tf = opts.tf ?? autoTerminancy();
  const t = thread(mainBefore, fs.embedding?.length);
  const m = magnitude(fs);
  const judged = t.size >= MIN_TO_JUDGE && t.distinct >= MIN_TO_JUDGE;
  const dev = judged ? deviation(fs.embedding, t) : { degrees: 0, stray: 0, z: 0 };
  const limit = directionLimit(tf, opts.stage);
  const abs = Math.abs(dev.degrees);
  let sizeFlag = null;
  if (judged && t.avgMagnitude > 0) {
    if (m > JUMP * t.avgMagnitude) sizeFlag = 'jump';
    else if (m < CRAWL * t.avgMagnitude) sizeFlag = 'crawl';
  }
  return {
    magnitude: m,
    intensity: intensity(fs),
    direction: dev.degrees,
    angle: (dev.degrees + 360) % 360,
    stray: dev.stray,
    spread: dev.z,
    avgMagnitude: t.avgMagnitude,
    limit,
    dirStatus: !judged ? 'on' : abs > limit ? 'off' : abs > limit / 2 ? 'wander' : 'on',
    sizeFlag,
    // From the side path's first Footstep: its own vector is 0, later ones measure the change since.
    iv: intentVector(m, dev.degrees - (opts.rootDirection ?? dev.degrees), opts.rootMagnitude ?? m),
  };
}

// A side path's state from its branching factor (the latest Footstep's intent vector length).
function branchState(factor, tf, share = DEFAULT_BRANCH_SHARE) {
  if (factor >= tf) return 'terminate';
  if (factor >= share * tf) return 'drifting';
  return 'ok';
}

// Averages for the Storyline stats.
function threadStats(footsteps) {
  const scored = footsteps.filter((f) => f.metrics);
  if (!scored.length) return null;
  const mean = (k) => scored.reduce((a, f) => a + (f.metrics[k] ?? 0), 0) / scored.length;
  return { magnitude: mean('magnitude'), direction: mean('direction'), intensity: mean('intensity'), count: scored.length };
}

// ---------- offline helpers ----------

// Offline embedding for when no embedding key is set: hashed bag of word stems.
const STOP = new Set(
  'a an the and or but of to in on at for with from by as is was were be been are it its this that these those he she they them his her their i we you our your then than so into over under out up down not no yes just very can will would could should has have had do does did who whom what when where why how there here all any some'.split(
    ' '
  )
);

const FILLER = new Set('um uh umm hmm like basically yeah okay ok actually really literally kind sort know mean well right also again'.split(' '));

function contentWords(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !FILLER.has(w))
    .map((w) => w.replace(/(ing|ed|es|s)$/, ''));
}

function localEmbedding(text, dim = 256) {
  const v = new Array(dim).fill(0);
  contentWords(text).forEach((w) => {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dim;
    v[idx] += h & 1 ? 1 : -1;
  });
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}

// Heuristic stage labels by position in the planned Journey, used offline
// and between AI relabels. Fractions of the planned length:
// Origin < 12%, Pandiculation < 40%, Maxspan < 70%, Convergence < 90%, Conclusion.
const STAGE_BOUNDS = [0.12, 0.4, 0.7, 0.9];
function heuristicStages(count, plannedLength = DEFAULT_PLANNED_LENGTH) {
  if (count < stageLabelAfter(plannedLength)) return new Array(count).fill(null);
  const span = Math.max(count, plannedLength);
  return Array.from({ length: count }, (_, i) => {
    const f = (i + 0.5) / span;
    const idx = STAGE_BOUNDS.findIndex((b) => f < b);
    return STAGES[idx === -1 ? STAGES.length - 1 : idx];
  });
}

// Keeps stage labels in story order: a stage never goes back to an earlier one.
function monotonicStages(labels) {
  let best = 0;
  return labels.map((s) => {
    const i = STAGES.indexOf(stageName(s));
    if (i > best) best = i;
    return STAGES[best];
  });
}

// ---------- repetition ----------

// A Footstep that says again what an earlier one said: the same meaning
// (embeddings this alike) or most of the same content words.
const REPEAT_MEANING = 0.93;
const REPEAT_WORDS = 0.7;
function repeatOf(fs, earlier) {
  const mine = new Set(contentWords(fs.event));
  let best = null;
  earlier.forEach((o) => {
    const theirs = new Set(contentWords(o.event));
    const shared = [...mine].filter((w) => theirs.has(w)).length;
    const words = Math.min(mine.size, theirs.size) >= 3 ? shared / Math.min(mine.size, theirs.size) : 0;
    const meaning = fs.embedding && o.embedding && fs.embedding.length === o.embedding.length ? cosine(fs.embedding, o.embedding) : 0;
    const score = Math.max(words >= REPEAT_WORDS ? words : 0, meaning >= REPEAT_MEANING ? meaning : 0);
    if (score && (!best || score > best.similarity)) best = { id: o.id, similarity: round2(score) };
  });
  return best;
}

// ---------- the whole Journey ----------

// Scores every Footstep in writing order, each against the main thread as it
// stood before it. A side-path Footstep's intent vector is measured from the
// direction its path started at (pathStart: the id of its path's first Footstep).
// footsteps: [{ id, thread, stage, pathStart, event, context, subjects, promises, environment, intensity, embedding }]
function scoreJourney({ footsteps = [], tf = null, plannedLength = DEFAULT_PLANNED_LENGTH, branchShare = DEFAULT_BRANCH_SHARE, stage = null }) {
  const autoTf = autoTerminancy(plannedLength);
  const t = Number.isFinite(tf) ? clamp(tf, 0.1, 1) : autoTf;
  const prior = [];
  const seen = [];
  const metrics = {};
  footsteps.forEach((f) => {
    const from = f.thread === 'branch' && f.pathStart && f.pathStart !== f.id ? metrics[f.pathStart] : null;
    const m = scoreFootstep(f, prior, { tf: t, stage: f.stage, rootDirection: from?.direction, rootMagnitude: from?.magnitude });
    if (f.thread === 'branch') m.branch = branchState(m.iv.length, t, branchShare);
    m.repeat = f.thread === 'archived' ? null : repeatOf(f, seen);
    metrics[f.id] = m;
    if (f.thread === 'main') prior.push(f);
    if (f.thread !== 'archived') seen.push(f);
  });
  const main = footsteps.filter((f) => f.thread === 'main').map((f) => ({ metrics: metrics[f.id] }));
  return {
    metrics,
    info: { tf: t, autoTf, limit: directionLimit(t, stage), stageAfter: stageLabelAfter(plannedLength), stats: threadStats(main) },
  };
}

// Where stage labels stand for a main thread of `count` Footsteps.
function stagesFor({ count = 0, plannedLength = DEFAULT_PLANNED_LENGTH }) {
  return { after: stageLabelAfter(plannedLength), labels: heuristicStages(count, plannedLength) };
}

export {
  STAGES,
  stageName,
  DEFAULT_PLANNED_LENGTH,
  SPLIT_AT,
  JUMP,
  CRAWL,
  DEFAULT_BRANCH_SHARE,
  stageLabelAfter,
  stageNumber,
  autoTerminancy,
  directionLimit,
  dataAmount,
  magnitude,
  intensity,
  thread,
  deviation,
  intentVector,
  scoreFootstep,
  branchState,
  threadStats,
  heuristicStages,
  monotonicStages,
  cosine,
  localEmbedding,
  repeatOf,
  scoreJourney,
  stagesFor,
};
