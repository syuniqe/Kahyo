// Reason · rules
// What ThoughtSense's signals mean in a study: five phases left to right, each with a
// main Footstep on the line and its work beneath; every point measured against its
// phase, the spine against itself, and the Conclusion against the question.
// Server only. See README.md.

import { clamp, median, round2, cleanVector, decodeVector, num, list } from '../../thoughtsense/vectors.js';
import { contentWords } from '../../thoughtsense/words.js';
import { magnitude, intensity, repeatOf } from '../../thoughtsense/signals.js';
import { localThread, band } from '../../thoughtsense/local.js';

const PHASES = ['Introduction', 'Literature', 'Methodology', 'Results & Inference', 'Conclusion'];
const WEIGHT = { Introduction: 1.0, Literature: 1.2, Methodology: 0.8, 'Results & Inference': 0.8, Conclusion: 0.4 };
const DEFAULT_TF = 0.35;
const SPLIT_AT = 30;

function phaseName(p) {
  const t = String(p || '').toLowerCase();
  if (/intro|question|background/.test(t)) return 'Introduction';
  if (/lit|review|prior|known/.test(t)) return 'Literature';
  if (/method|design|data|sample/.test(t)) return 'Methodology';
  if (/result|finding|inference|analysis/.test(t)) return 'Results & Inference';
  if (/conclu|answer|discussion/.test(t)) return 'Conclusion';
  return null;
}

function limitFor(tf, phase) {
  return clamp(tf * 180 * (WEIGHT[phaseName(phase) || 'Introduction'] || 1), 10, 180);
}

const deg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(0)}°`;

// footsteps (writing order): [{ id, thread: main|branch|archived, phase, role: main|work, source, event, … }]
// edges: [{ from, to, type }] — a link into a result from a method Footstep supports it.
function scoreJourney(input = {}) {
  const tf = input.tf === null || input.tf === undefined ? DEFAULT_TF : clamp(num(input.tf, DEFAULT_TF), 0.1, 1);
  const live = (input.footsteps || []).filter((f) => f && f.thread !== 'archived');
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const byId = Object.fromEntries(live.map((f) => [f.id, f]));
  const paper = localThread();
  const spine = localThread();
  const intro = localThread();
  const phases = Object.fromEntries(PHASES.map((p) => [p, localThread()]));
  const sizes = [];
  const seen = [];
  const metrics = {};
  const notes = [];
  const count = Object.fromEntries(PHASES.map((p) => [p, 0]));
  const mains = {};
  let question = null;

  live.forEach((raw) => {
    const f = { ...raw, subjects: list(raw.subjects), promises: list(raw.promises), environment: list(raw.environment), event: String(raw.event || '') };
    const e = cleanVector(decodeVector(raw));
    const phase = phaseName(f.phase) || 'Introduction';
    const side = f.thread === 'branch';
    const isMain = !side && f.role === 'main' && !mains[phase];
    const limit = limitFor(tf, phase);
    const m = magnitude(f);
    const usual = median(sizes);
    // A phase with fewer than three points is judged against the whole paper.
    const own = phases[phase];
    const dev = isMain ? spine.judge(e) : own.size >= 3 ? own.judge(e) : paper.judge(e);
    const iv = { direction: round2(dev.degrees / limit), magnitude: round2(usual > 0 && m > 0 ? clamp(Math.log2(m / usual), -1, 1) : 0) };
    iv.length = round2(Math.sqrt(iv.direction ** 2 + (0.5 * iv.magnitude) ** 2));
    const words = new Set(contentWords(f.event));
    const out = {
      magnitude: m,
      usual,
      intensity: intensity(f),
      direction: dev.degrees,
      limit,
      judged: dev.judged,
      dirStatus: band(dev.degrees, limit, dev.judged),
      iv,
      branchHint: !side && !isMain && dev.judged && iv.length >= 1,
      phase,
      role: isMain ? 'main' : 'work',
      repeat: repeatOf({ event: f.event, words, embedding: e }, seen),
    };
    if (isMain) mains[phase] = f.id;
    if (!question && !side && (phase === 'Introduction' || !live.some((x) => phaseName(x.phase) === 'Introduction'))) question = f.id;
    // Does the Conclusion answer the question? Measured against the Introduction only.
    if (phase === 'Conclusion' && isMain) {
      const q = intro.judge(e);
      out.answer = q.judged ? q.degrees : null;
      if (q.judged && Math.abs(q.degrees) > limit)
        notes.push({ kind: 'answer', fsId: f.id, text: `The Conclusion (${f.id}) drifts from the question (${deg(q.degrees)}, limit ${limit.toFixed(0)}°). Does it answer ${question || 'the question'}?`, maths: `against the Introduction ${deg(q.degrees)}` });
    }
    metrics[f.id] = out;
    if (!side) {
      count[phase]++;
      paper.add(e);
      own.add(e);
      if (isMain) spine.add(e);
      if (phase === 'Introduction') intro.add(e);
      sizes.push(m);
    }
    seen.push({ id: f.id, event: f.event, words, embedding: e });

    if (out.branchHint)
      notes.push({ kind: 'unplanned', fsId: f.id, text: `${f.id} sits outside the plan for ${phase} (${deg(dev.degrees)}, limit ${limit.toFixed(0)}°). Keep it as a side path, or fold it into ${phase}?`, maths: `intent ${iv.length.toFixed(2)}` });
    else if (!side && out.dirStatus === 'off')
      notes.push({ kind: 'off-topic', fsId: f.id, text: `${f.id} goes off topic for ${phase} (${deg(dev.degrees)}, limit ${limit.toFixed(0)}°).`, maths: `direction ${deg(dev.degrees)}` });
    if (out.repeat) notes.push({ kind: 'repeat', fsId: f.id, text: `${f.id} makes the same point as ${out.repeat.id}. Delete it, or keep both?`, maths: `${Math.round(out.repeat.similarity * 100)}% alike` });
    if (m > SPLIT_AT || (usual > 0 && m > 2.5 * usual)) notes.push({ kind: 'split', fsId: f.id, text: `${f.id} may hold two points. Split it in two?`, maths: `magnitude ${m}` });
    // Structure: findings need a method, literature needs a source.
    if (!side && phase === 'Results & Inference' && !isMain) {
      const backed = edges.some((x) => x.to === f.id && phaseName(byId[x.from]?.phase) === 'Methodology');
      out.supported = backed;
      if (!backed && count.Methodology) notes.push({ kind: 'unsupported', fsId: f.id, text: `${f.id} is a finding with no link to a Methodology Footstep. Link the method it comes from.`, maths: '' });
    }
    if (!side && !isMain && phase === 'Literature' && !String(f.source || '').trim() && !/\(\s*[A-Z][^)]*\d{4}\s*\)|et al|\[\d+\]/.test(f.event))
      notes.push({ kind: 'source', fsId: f.id, text: `${f.id} reports what is known but names no source. Add one?`, maths: '' });
  });

  // Missing steps: an empty phase before one that has work.
  const lastFilled = PHASES.reduce((k, p, i) => (count[p] ? i : k), -1);
  const empty = PHASES.filter((p, i) => i < lastFilled && !count[p]);
  empty.forEach((p) => notes.push({ kind: 'empty', fsId: `phase:${p}`, phase: p, text: `${p} is empty, but later phases have work. Add what belongs in ${p}?`, maths: '' }));
  if (lastFilled === 3 && PHASES.slice(0, 4).every((p) => count[p]) && question)
    notes.push({ kind: 'empty', fsId: 'phase:Conclusion', phase: 'Conclusion', text: `Every other phase has Footsteps. The Conclusion should answer the question in ${question}.`, maths: '' });

  const judged = live.filter((f) => f.thread !== 'branch' && metrics[f.id].judged);
  const offs = judged.slice(-6).filter((f) => ['off', 'drifting'].includes(metrics[f.id].dirStatus)).length;
  return {
    metrics,
    notes,
    info: {
      tf,
      autoTf: DEFAULT_TF,
      phases: PHASES.map((p) => ({ name: p, count: count[p], main: mains[p] || null, limit: round2(limitFor(tf, p)) })),
      question,
      sidePaths: live.filter((f) => f.thread === 'branch').length,
      health: judged.length < 3 ? 'quiet' : offs >= 3 ? 'drift' : offs ? 'wander' : 'ok',
    },
  };
}

function stagesFor() {
  return { after: Infinity, labels: [] };
}

// Offline phase guess from the words used.
const CUES = [
  ['Literature', /\b(studies|literature|prior|previous|known|research shows|according to|et al|review|authors?)\b|\([A-Z][^)]*\d{4}\)/i],
  ['Methodology', /\b(method|sample|survey|interview|dataset|data from|we (?:collect|measur|use)|regression|model|design|variable|records|questionnaire|schools? from)\w*/i],
  ['Results & Inference', /\b(result|found|find|show|shows|showed|increase|decrease|drop|rise|significant|correlat|explain|suggest|%)\w*/i],
  ['Conclusion', /\b(conclu|therefore|in sum|overall|we recommend|answer|policy)\w*/i],
  ['Introduction', /\b(question|why|aim|purpose|this (?:study|paper)|matters|we ask|motivat)\w*/i],
];
function placeFor(input = {}) {
  const t = String(input.text || '');
  const said = /^\s*(intro(?:duction)?|literature|method(?:ology)?|results?(?: (?:&|and) inference)?|conclusion)\s*[:\-–]/i.exec(t);
  if (said) return { phase: phaseName(said[1]), text: t.slice(said[0].length).trim() };
  const hit = CUES.find(([, re]) => re.test(t));
  return { phase: hit ? hit[0] : null, text: t };
}

export { PHASES, WEIGHT, phaseName, limitFor, scoreJourney, stagesFor, placeFor };
