// ThoughtSense core · the thread
// Where a line of thought is heading, and how far a new Footstep turns from it:
// the heading, the typical spread, the main side-to-side axis and the signed
// direction in degrees. Two forms give the same answers: thread()/deviation()
// for one Footstep at a time, and threadState()/addToThread()/deviationFrom()
// for scoring a whole Journey fast. Server only.

import { dot, norm, cosine, clamp, unit, median, dotF } from './vectors.js';
import { magnitude } from './signals.js';

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

export { RECENCY, RECENT_SHARE, BASELINE_WINDOW, MIN_TO_JUDGE, DUPLICATE, NOISE, thread, storyAxis, deviation, threadState, addToThread, deviationFrom, sideOf };
