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
// Intensity (0–1) is how big the event is, not how much happens (that is magnitude).
// The AI or the writer judges it; offline it is read from the weight of the words.
const HEAVY_WORDS = new Set(
  'die dies died dead death kill kills killed murder war battle betray betrays betrayed reveal reveals revealed secret confess confesses arrest arrested escape escapes fire burn burns flood floods storm attack attacks crown crowned marry married love loves lost lose loses fall falls fell born birth exile exiled refuse refuses defy defies rebel rebellion strike collapse destroy destroyed save saves rescue rescued free freed'.split(' ')
);
function intensity(fs) {
  if (Number.isFinite(fs.intensity)) return clamp(fs.intensity, 0, 1);
  const words = String(fs.event || '').toLowerCase().match(/[a-z]+/g) || [];
  const heavy = new Set(words.filter((w) => HEAVY_WORDS.has(w))).size;
  return round2(clamp(0.3 + 0.15 * heavy, 0.1, 0.9));
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

// ---------- direction statuses, intent vector, terminancy (v3) ----------

// Direction alone gives the status, against the stage limit X:
// on course up to X/3, wandering up to 2X/3, drifting up to X, off course past X.
function directionStatus(degrees, limit, judged) {
  if (!judged) return 'on';
  const r = Math.abs(degrees) / limit;
  return r > 1 ? 'off' : r > 2 / 3 ? 'drifting' : r > 1 / 3 ? 'wander' : 'on';
}

// Intent vector of any Footstep, against its own thread: direction and magnitude together.
//   b = θ / X               (1 = at the stage limit, so later stages are stricter)
//   a = clamp(log2(m / usual), −1, 1)   (+1 = a Jump, double the usual; −1 = a Crawl)
//   length = √(b² + (a/2)²)   (magnitude weighs half as much as direction)
// A lot in the same direction is a Jump (length ≤ ½); a lot in a strange direction is
// a branch: Kahyo suggests one when the length reaches 1.
const MAGNITUDE_WEIGHT = 0.5;
function intentOf(degrees, limit, m, usual) {
  const b = degrees / limit;
  const a = usual > 0 && m > 0 ? clamp(Math.log2(m / usual), -1, 1) : 0;
  return { direction: round2(b), magnitude: round2(a), length: round2(Math.sqrt(b * b + (MAGNITUDE_WEIGHT * a) ** 2)) };
}

// Terminancy of a side path: the sector it opens against the main story.
//   L = how far the path has travelled, in usual steps (its magnitudes / the usual magnitude)
//   Δθ = the angle between the path's latest heading and the main story's, in radians
//   area = ½ · L² · Δθ     limit = ½ · 3² · (TF · π)  (three usual steps opened at TF × 180°)
// Turning back toward the story shrinks Δθ and the area. A long path is fine if it stays close.
const TERMINANCY_STEPS = 3;
function sectorOf(steps, degrees, tf) {
  const area = 0.5 * steps * steps * (Math.abs(degrees) * Math.PI) / 180;
  const limit = 0.5 * TERMINANCY_STEPS * TERMINANCY_STEPS * tf * Math.PI;
  return { steps: round2(steps), area: round2(area), limit: round2(limit), ratio: round2(area / limit) };
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

// A Footstep that says again what an earlier one said. Shared words alone are not
// enough ("Arjun sells the salt" vs "Arjun buys the salt" is a new event), so it takes
// nearly the same words both ways (overlap over union), a near-identical meaning, or
// a very close meaning with most words shared.
const REPEAT_WORDS = 0.8;
const REPEAT_MEANING = 0.97;
const REPEAT_CLOSE = 0.93;
const REPEAT_CLOSE_WORDS = 0.5;
function repeatOf(fs, earlier) {
  const mine = fs.words || new Set(contentWords(fs.event));
  const e = fs.embedding;
  let best = null;
  earlier.forEach((o) => {
    const theirs = o.words || new Set(contentWords(o.event));
    let shared = 0;
    mine.forEach((w) => theirs.has(w) && shared++);
    const union = mine.size + theirs.size - shared;
    const words = union && Math.min(mine.size, theirs.size) >= 2 ? shared / union : 0;
    // Offline vectors (256 numbers) are only hashed words, so meaning is judged on real embeddings only.
    const meaning = e && o.embedding && e.length === o.embedding.length && e.length >= 512 ? cosine(e, o.embedding) : 0;
    const alike = words >= REPEAT_WORDS || meaning >= REPEAT_MEANING || (meaning >= REPEAT_CLOSE && words >= REPEAT_CLOSE_WORDS);
    const score = Math.max(words, meaning);
    if (alike && (!best || score > best.similarity)) best = { id: o.id, similarity: round2(score) };
  });
  return best;
}

// ---------- the whole Journey ----------

// The browser sends vectors as base64 float32 (`e64`): about a third of the JSON size.
function decodeVector(raw) {
  if (typeof raw.e64 === 'string' && raw.e64) {
    try {
      const bin = atob(raw.e64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Array.from(new Float32Array(bytes.buffer, 0, bytes.length >> 2));
    } catch {
      return null;
    }
  }
  return raw.embedding;
}

// Clean inputs: a vector with a bad number, or no length, counts as no vector.
function cleanVector(e) {
  if (!Array.isArray(e) || !e.length) return null;
  let n = 0;
  for (let k = 0; k < e.length; k++) {
    const x = e[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    n += x * x;
  }
  if (n < 1e-18) return null;
  n = Math.sqrt(n);
  const u = new Float64Array(e.length);
  for (let k = 0; k < e.length; k++) u[k] = e[k] / n;
  return u;
}

function dotF(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

const num = (x, fallback) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? fallback : Number(x));

// The main thread as it grows, one per vector size, kept as dot products so each
// new Footstep costs one pass over the earlier ones. Gives the same G, R, H,
// baseline, mean and principal axis as thread() and storyAxis() above.
function threadState() {
  return { X: [], K: [], rowSum: [], total: 0, kept: [], g: null, r: null, a: null };
}

function addToThread(st, e, dots) {
  const n = st.X.length;
  st.X.push(e);
  for (let i = 0; i < n; i++) {
    st.K[i].push(dots[i]);
    st.rowSum[i] += dots[i];
  }
  const row = dots.slice(0, n);
  row.push(1);
  st.K.push(row);
  st.rowSum.push(row.reduce((a, x) => a + x, 0));
  st.total = st.rowSum.reduce((a, x) => a + x, 0);
  if (!st.g) {
    st.g = new Float64Array(e.length);
    st.r = new Float64Array(e.length);
  }
  for (let k = 0; k < e.length; k++) {
    st.g[k] += e[k];
    st.r[k] = RECENCY * st.r[k] + e[k];
  }
  if (!st.kept.some((i) => st.K[i][n] > DUPLICATE)) st.kept.push(n);
  st.a = null;
}

// Signed direction of `e` (unit) against the thread, from its dot products with the thread.
function deviationFrom(st, e, dots) {
  const n = st.X.length;
  if (st.kept.length < MIN_TO_JUDGE) return { degrees: 0, stray: 0, z: 0 };
  // Heading H = unit(½·unit(g) + ½·unit(r)).
  const gg = st.total;
  const gn = Math.sqrt(gg);
  const rn = Math.sqrt(dotF(st.r, st.r));
  const gr = dotF(st.g, st.r);
  let eg = 0;
  let er = 0;
  for (let i = 0; i < n; i++) {
    eg += dots[i];
    er += Math.pow(RECENCY, n - 1 - i) * dots[i];
  }
  const hx = (1 - RECENT_SHARE) * (eg / gn) + RECENT_SHARE * (er / rn);
  const hn = Math.sqrt((1 - RECENT_SHARE) ** 2 + RECENT_SHARE ** 2 + 2 * (1 - RECENT_SHARE) * RECENT_SHARE * (gr / (gn * rn)));
  const stray = 1 - hx / hn;
  // Baseline: median leave-one-out distance of the last kept Footsteps.
  const from = Math.max(0, st.kept.length - BASELINE_WINDOW);
  const dist = st.kept.slice(from).map((i) => {
    const eDotRest = st.rowSum[i] - 1;
    const restNorm = Math.sqrt(Math.max(0, gg - 2 * st.rowSum[i] + 1));
    return 1 - (restNorm === 0 ? 0 : eDotRest / restNorm);
  });
  const baseline = Math.max(median(dist), 0.02);
  const z = stray / baseline;
  const side = sideOf(st, dots);
  const size = clamp(((z - NOISE) / (2 - NOISE)) * 90, 0, 180);
  return { degrees: side < 0 ? -size : size, stray, z };
}

// Which side of the story's principal axis: the same power iteration as storyAxis(),
// run on the centred dot-product matrix (n × n) instead of the vectors (n × dim).
function sideOf(st, dots) {
  const n = st.X.length;
  const rm = st.rowSum.map((x) => x / n);
  const tm = st.total / (n * n);
  if (!st.a) {
    const C = new Float64Array(n * n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) C[i * n + j] = st.K[i][j] - rm[i] - rm[j] + tm;
    // Coefficients of the axis on the centred Footsteps; their scale does not change the axis.
    // Start from the last Footstep, or from the axis found one Footstep ago, which is
    // nearly the answer already, so a growing story needs only a few rounds.
    let a = new Float64Array(n);
    const warm = st.prevA && st.prevA.length === n - 1;
    if (warm) a.set(st.prevA);
    else a[n - 1] = 1;
    for (let it = 0; it < (warm ? 10 : 40); it++) {
      const next = new Float64Array(n);
      let len = 0;
      for (let i = 0; i < n; i++) {
        let s = 0;
        const row = i * n;
        for (let j = 0; j < n; j++) s += C[row + j] * a[j];
        next[i] = s;
        len += s * s;
      }
      len = Math.sqrt(len);
      if (len < 1e-12) break;
      let change = 0;
      for (let i = 0; i < n; i++) {
        next[i] /= len;
        change = Math.max(change, Math.abs(next[i] - a[i]));
      }
      a = next;
      if (change < 1e-6) break;
    }
    // Oriented so the opening Footstep sits on the − side.
    let first = 0;
    for (let j = 0; j < n; j++) first += C[j] * a[j];
    if (first > 0) a = a.map((x) => -x);
    st.a = a;
    st.prevA = a;
  }
  let eMean = 0;
  for (let i = 0; i < n; i++) eMean += dots[i];
  eMean /= n;
  let side = 0;
  for (let i = 0; i < n; i++) side += st.a[i] * (dots[i] - eMean - (rm[i] - tm));
  return side;
}

// Scores every Footstep in writing order, each against the main thread as it
// stood before it, and side-path Footsteps also against their own path.
// pathStart: the id of the first Footstep of the Footstep's side path (or sub-path).
// footsteps: [{ id, thread, stage, pathStart, event, context, subjects, promises, environment, intensity, embedding | e64 }]
function scoreJourney(input = {}) {
  const footsteps = Array.isArray(input.footsteps) ? input.footsteps : [];
  const plannedLength = clamp(Math.round(num(input.plannedLength, DEFAULT_PLANNED_LENGTH)), 1, 1000);
  const autoTf = autoTerminancy(plannedLength);
  const tf = input.tf === null || input.tf === undefined ? autoTf : clamp(num(input.tf, autoTf), 0.1, 1);
  const states = {};
  const paths = {};
  const mainSizes = [];
  const seen = [];
  const metrics = {};
  let lastDim = null;
  // Footsteps before `from` were scored before and have not changed: they rebuild the
  // threads, and their earlier results (`known`) stand; only what the factors decide is redone.
  const startAt = clamp(Math.round(num(input.from, 0)), 0, footsteps.length);

  const grow = (store, key, e, dots) => {
    if (!store[key]) store[key] = threadState();
    const st = store[key];
    addToThread(st, e, dots || st.X.map((x) => dotF(x, e)));
    return st;
  };
  const against = (st, e, judgedSize) => {
    const n = st ? st.X.length : 0;
    const dots = e && n ? st.X.map((x) => dotF(x, e)) : [];
    const judged = judgedSize >= MIN_TO_JUDGE && (st ? st.kept.length : 0) >= MIN_TO_JUDGE && Boolean(e) && n > 0;
    return { dots, judged, dev: judged ? deviationFrom(st, e, dots) : { degrees: 0, stray: 0, z: 0 } };
  };

  footsteps.forEach((raw, index) => {
    const f = { ...raw, subjects: list(raw.subjects), promises: list(raw.promises), environment: list(raw.environment), event: String(raw.event || '') };
    const e = cleanVector(decodeVector(raw));
    const skipped = index < startAt;
    const k = raw.known || {};
    const limit = directionLimit(tf, f.stage);
    const m = skipped ? num(k.magnitude, magnitude(f)) : magnitude(f);
    const usual = skipped ? num(k.usual, median(mainSizes)) : median(mainSizes);
    const side = f.thread === 'branch';
    const pathKey = side ? f.pathStart || f.id : null;
    const path = side ? (paths[pathKey] = paths[pathKey] || { steps: 0, own: {}, size: 0 }) : null;

    // Against the main story.
    const dim = e ? e.length : lastDim;
    const main = dim && states[dim];
    let direction;
    let judged;
    let dev = { degrees: 0, stray: 0, z: 0 };
    let dots = [];
    if (skipped) {
      direction = num(k.direction, 0);
      judged = Boolean(k.judged);
    } else {
      const r = against(main, e, mainSizes.length);
      ({ dots, judged, dev } = r);
      direction = dev.degrees;
    }

    // A side-path Footstep is also judged against its own path, for sub-paths.
    let own = null;
    if (side) {
      if (skipped) own = Number.isFinite(k.pathDirection) ? { degrees: k.pathDirection, judged: true } : null;
      else if (e && path.own[e.length]) {
        const r = against(path.own[e.length], e, path.size);
        if (r.judged) own = { degrees: r.dev.degrees, judged: true };
      }
    }

    const sizeFlag = judged && usual > 0 ? (m > JUMP * usual ? 'jump' : m < CRAWL * usual ? 'crawl' : null) : null;
    const iv = intentOf(own ? own.degrees : direction, limit, m, usual);
    const out = {
      magnitude: m,
      usual,
      intensity: intensity(f),
      direction,
      angle: (direction + 360) % 360,
      limit,
      judged,
      dirStatus: directionStatus(direction, limit, judged),
      sizeFlag,
      iv,
      // Branch it: a lot in a strange direction, on the main story or on a side path.
      branchHint: (side ? Boolean(own) : judged) && iv.length >= 1,
    };
    if (!skipped) {
      out.stray = dev.stray;
      out.spread = dev.z;
      out.avgMagnitude = usual;
    }
    if (own) out.pathDirection = own.degrees;
    if (side) {
      path.steps += usual > 0 ? m / usual : 1;
      out.terminancy = sectorOf(path.steps, direction, tf);
      out.branch = out.terminancy.ratio >= 1 ? 'terminate' : out.terminancy.ratio >= 0.5 ? 'drifting' : 'ok';
      path.size++;
      if (e) grow(path.own, e.length, e);
    }
    const words = new Set(contentWords(f.event));
    if (!skipped) out.repeat = f.thread === 'archived' ? null : repeatOf({ event: f.event, words, embedding: e }, seen);
    metrics[f.id] = out;
    if (f.thread === 'main') {
      mainSizes.push(m);
      if (e) {
        const st = grow(states, e.length, e, main && main.X.length && main === states[e.length] && dots.length === main.X.length ? dots : null);
        if (skipped) st.prevA = null;
        lastDim = e.length;
      }
    }
    if (f.thread !== 'archived') seen.push({ id: f.id, event: f.event, words, embedding: e });
  });
  return {
    metrics,
    info: {
      tf,
      autoTf,
      limit: directionLimit(tf, input.stage),
      stageAfter: stageLabelAfter(plannedLength),
      sideLimit: { steps: TERMINANCY_STEPS, degrees: round2(tf * 180) },
    },
  };
}

const list = (xs) => (Array.isArray(xs) ? xs.filter((x) => x !== null && x !== undefined).map(String) : typeof xs === 'string' && xs ? [xs] : []);

// Where stage labels stand for a main thread of `count` Footsteps.
function stagesFor(input = {}) {
  const plannedLength = clamp(Math.round(num(input.plannedLength, DEFAULT_PLANNED_LENGTH)), 1, 1000);
  const count = clamp(Math.round(num(input.count, 0)), 0, 5000);
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
  directionStatus,
  intentOf,
  sectorOf,
  scoreJourney,
  stagesFor,
};
