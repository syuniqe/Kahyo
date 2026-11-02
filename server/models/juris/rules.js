// Juris · rules
// What ThoughtSense's signals mean for a case: every point must lead back to the
// case, stay relevant to it, keep its dates in order and agree with the other
// points about the same thing. No stages, no side paths. Server only. See README.md.

import { clamp, round2, cleanVector, decodeVector, num, list, cosine } from '../../thoughtsense/vectors.js';
import { contentWords } from '../../thoughtsense/words.js';
import { magnitude, intensity, repeatOf } from '../../thoughtsense/signals.js';
import { localThread, band } from '../../thoughtsense/local.js';
import { factsOf, factsDiffer, firstDate } from '../../thoughtsense/facts.js';
import { depthToRoot, descendants } from '../../thoughtsense/links.js';

const CASE = 'CASE';
const KINDS = ['filing', 'hearing', 'order', 'evidence', 'outcome'];
const DEFAULT_TF = 0.35;
const SAME_WORDS = 0.5;
const SAME_MEANING = 0.85;

function kindOf(k) {
  const t = String(k || '').toLowerCase();
  return KINDS.find((x) => t.startsWith(x.slice(0, 4))) || (/(petition|suit|complaint|reply|application)/.test(t) ? 'filing' : /(exhibit|letter|document|statement|witness|report)/.test(t) ? 'evidence' : /(judgment|decree|ruling|direction)/.test(t) ? 'order' : 'outcome');
}

const deg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(0)}°`;

// footsteps: [{ id, thread, kind, date, parent (CASE or an id), event, subjects, … }]
// edges: [{ from, to, type: 'relates' }] tie a point to evidence.
function scoreJourney(input = {}) {
  const tf = input.tf === null || input.tf === undefined ? DEFAULT_TF : clamp(num(input.tf, DEFAULT_TF), 0.1, 1);
  const live = (input.footsteps || []).filter((f) => f && f.thread !== 'archived');
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const ids = new Set(live.map((f) => f.id));
  const parentOf = {};
  live.forEach((f) => (parentOf[f.id] = f.parent === CASE || ids.has(f.parent) ? f.parent : null));
  const depth = depthToRoot([...ids], parentOf, CASE);
  const caseThread = localThread();
  const limit = clamp(tf * 180, 10, 180);
  const metrics = {};
  const notes = [];
  const seen = [];
  const facts = {};
  const vecs = {};

  live.forEach((raw) => {
    const f = { ...raw, subjects: list(raw.subjects), promises: list(raw.promises), environment: list(raw.environment), event: String(raw.event || '') };
    const e = cleanVector(decodeVector(raw));
    vecs[f.id] = e;
    const linked = Number.isFinite(depth[f.id]);
    const dev = caseThread.judge(e);
    const words = new Set(contentWords(f.event));
    facts[f.id] = { ...factsOf([f.event, f.context].filter(Boolean).join(' ')), words, subjects: f.subjects.map((s) => s.toLowerCase()) };
    const date = firstDate(f);
    const out = {
      magnitude: magnitude(f),
      intensity: intensity(f),
      direction: dev.degrees,
      limit,
      judged: dev.judged,
      dirStatus: band(dev.degrees, limit, dev.judged),
      kind: kindOf(f.kind),
      level: linked ? depth[f.id] : null,
      linked,
      date,
      repeat: repeatOf({ event: f.event, words, embedding: e }, seen),
    };
    metrics[f.id] = out;
    if (linked) caseThread.add(e);
    seen.push({ id: f.id, event: f.event, words, embedding: e });

    if (!linked) notes.push({ kind: 'unlinked', fsId: f.id, text: `${f.id} does not lead back to the case. Attach it to a hearing or filing, mark it as evidence, or remove it.`, maths: '' });
    else if (out.dirStatus === 'off') notes.push({ kind: 'far', fsId: f.id, text: `${f.id} reads far from the rest of the case (${deg(dev.degrees)}, limit ${limit.toFixed(0)}°). Is it part of this case?`, maths: `direction ${deg(dev.degrees)}` });
    if (out.repeat) notes.push({ kind: 'repeat', fsId: f.id, text: `${f.id} records the same thing as ${out.repeat.id}. Delete it, or keep both?`, maths: `${Math.round(out.repeat.similarity * 100)}% alike` });
  });

  // Weight: intensity, plus a little for everything that grew from it.
  live.forEach((f) => {
    const n = descendants(f.id, parentOf).size;
    metrics[f.id].children = n;
    metrics[f.id].weight = round2(Math.min(1, metrics[f.id].intensity * (1 + 0.1 * n)));
  });

  // Dates in order: an outcome can't come before what it came from.
  live.forEach((f) => {
    const p = parentOf[f.id];
    const a = metrics[f.id].date;
    const b = p && p !== CASE ? metrics[p]?.date : null;
    if (a && b && a < b && !b.startsWith(a)) notes.push({ kind: 'dates', fsId: f.id, text: `${f.id} is dated ${a}, before ${p} (${b}) that it comes from. Check the dates.`, maths: `${a} < ${b}` });
  });

  // Facts disagree: two points about the same thing with different dates or numbers.
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) {
      const A = live[i].id;
      const B = live[j].id;
      const fa = facts[A];
      const fb = facts[B];
      const sharedWho = fa.subjects.some((s) => fb.subjects.includes(s));
      let shared = 0;
      fa.words.forEach((w) => fb.words.has(w) && shared++);
      const overlap = shared / Math.max(1, Math.min(fa.words.size, fb.words.size));
      const ea = vecs[A];
      const eb = vecs[B];
      const meaning = ea && eb && ea.length === eb.length && ea.length >= 512 ? cosine(ea, eb) : 0;
      if (!(overlap >= SAME_WORDS || meaning >= SAME_MEANING) || !(sharedWho || overlap >= SAME_WORDS)) continue;
      const diff = factsDiffer(fa, fb);
      if (diff) notes.push({ kind: 'facts', fsId: B, other: A, text: `${B} and ${A} seem to be about the same thing but give different ${diff.kind === 'date' ? 'dates' : 'figures'} (${diff.b} and ${diff.a}).`, maths: `${Math.round(Math.max(overlap, meaning) * 100)}% alike` });
    }

  // Evidence nothing relies on yet.
  live.forEach((f) => {
    if (metrics[f.id].kind !== 'evidence') return;
    const used = edges.some((x) => (x.to === f.id || x.from === f.id) && x.type === 'relates') || metrics[f.id].children > 0;
    if (!used && metrics[f.id].linked) notes.push({ kind: 'evidence', fsId: f.id, text: `Evidence ${f.id} is not related to any hearing or outcome yet.`, maths: '' });
  });

  const counts = Object.fromEntries(KINDS.map((k) => [k, live.filter((f) => metrics[f.id].kind === k).length]));
  return {
    metrics,
    notes,
    info: { tf, autoTf: DEFAULT_TF, limit, counts, loose: live.filter((f) => !metrics[f.id].linked).length },
  };
}

function stagesFor() {
  return { after: Infinity, labels: [] };
}

// Offline: what kind of point it is, from its words.
function placeFor(input = {}) {
  const t = String(input.text || '');
  const k = /\b(was asked|were asked|asked to|adjourned|granted|dismissed|allowed|led to|resulted)\b/i.test(t)
    ? 'outcome'
    : /\b(hearing|heard)/i.test(t)
    ? 'hearing'
    : /\b(filed|filing|petition|suit|complaint|reply|application|written statement)\b/i.test(t)
      ? 'filing'
      : /\b(order(?:ed)?|judgment|decree|ruled|directed|stay)\b/i.test(t)
        ? 'order'
        : /\b(letter|exhibit|document|receipt|statement of|witness|report|photo|email|agreement|deed)\b/i.test(t)
          ? 'evidence'
          : 'outcome';
  const { dates } = factsOf(t);
  return { kind: k, date: dates.length ? [...dates].sort()[0] : null, text: t };
}

export { CASE, KINDS, kindOf, scoreJourney, stagesFor, placeFor };
