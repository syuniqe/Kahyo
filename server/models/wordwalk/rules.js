// Wordwalk · rules
// What ThoughtSense's signals mean for a story: five stages, a direction limit that
// tightens toward the Conclusion, on course / wandering / drifting / off course,
// Jump and Crawl, branching into side paths, and terminancy on side paths.
// Server only. See README.md in this folder.

import { clamp, median, round2, cleanVector, decodeVector, dotF, num, list } from '../../thoughtsense/vectors.js';
import { contentWords } from '../../thoughtsense/words.js';
import { magnitude, intensity, repeatOf } from '../../thoughtsense/signals.js';
import { MIN_TO_JUDGE, thread, deviation, threadState, addToThread, deviationFrom } from '../../thoughtsense/thread.js';

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
  intentVector,
  scoreFootstep,
  branchState,
  directionStatus,
  intentOf,
  sectorOf,
  threadStats,
  heuristicStages,
  monotonicStages,
  scoreJourney,
  stagesFor,
};
