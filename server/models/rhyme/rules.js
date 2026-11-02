// Rhyme · rules
// What ThoughtSense's signals mean in a song or poem: lines against the piece's theme,
// with a limit per section (tight in the chorus, wide in the bridge), choruses that
// return, a bridge that should turn, meter and rhyme. Server only. See README.md.

import { clamp, median, round2, cleanVector, decodeVector, num, list } from '../../thoughtsense/vectors.js';
import { contentWords } from '../../thoughtsense/words.js';
import { magnitude, intensity, repeatOf } from '../../thoughtsense/signals.js';
import { localThread, band } from '../../thoughtsense/local.js';
import { syllables, endSound, rhymes } from '../../thoughtsense/sounds.js';

const SECTIONS = ['Verse', 'Chorus', 'Bridge', 'Outro'];
// Limit weight per section: X = TF · 180° · w.
const WEIGHT = { Verse: 1.0, Chorus: 0.5, Bridge: 1.5, Outro: 0.5 };
const DEFAULT_TF = 0.35;
const SPLIT_AT = 14;
const METER_GAP = 0.4;
const RHYME_BACK = 2;

// "Verse 2", "chorus", "Pre-chorus" → the kind of section it is.
function sectionKind(s) {
  const t = String(s || '').toLowerCase();
  if (/bridge|middle/.test(t)) return 'Bridge';
  if (/pre/.test(t)) return 'Verse';
  if (/chorus|refrain|hook/.test(t)) return 'Chorus';
  if (/outro|coda|end/.test(t)) return 'Outro';
  return 'Verse';
}

function limitFor(tf, section) {
  return clamp(tf * 180 * WEIGHT[sectionKind(section)], 10, 180);
}

// Footsteps arrive in reading order. Lines set aside (thread 'branch') still get a reading.
// footsteps: [{ id, thread, section, event, … embedding | e64 }]
function scoreJourney(input = {}) {
  const tf = input.tf === null || input.tf === undefined ? DEFAULT_TF : clamp(num(input.tf, DEFAULT_TF), 0.1, 1);
  const theme = localThread();
  const bridgeTheme = localThread(); // the theme without the bridge, for the bridge turn
  const sizes = [];
  const seen = [];
  const metrics = {};
  const notes = [];
  const chorusLines = []; // { id, words, embedding, event, section }
  const sections = []; // { name, kind, ids: [] }
  const live = (input.footsteps || []).filter((f) => f && f.thread !== 'archived');

  let lastName = null;
  let secNo = -1;
  live.forEach((raw) => {
    const f = { ...raw, subjects: list(raw.subjects), promises: list(raw.promises), environment: list(raw.environment), event: String(raw.event || '') };
    const e = cleanVector(decodeVector(raw));
    const aside = f.thread === 'branch';
    const name = String(f.section || 'Verse 1');
    const kind = sectionKind(name);
    // A section is a run of lines with one name: a chorus that comes back is a new section.
    if (!aside && name !== lastName) {
      secNo++;
      lastName = name;
    }
    const here = aside ? -1 : secNo;
    const limit = limitFor(tf, name);
    const m = magnitude(f);
    const usual = median(sizes);
    const words = new Set(contentWords(f.event));

    // A chorus line that matches one from an earlier chorus is a return, not a repeat.
    let returnOf = null;
    if (kind === 'Chorus') {
      const prior = chorusLines.filter((c) => c.sec !== here);
      const hit = repeatOf({ event: f.event, words, embedding: e }, prior);
      if (hit) returnOf = hit.id;
    }
    const dev = theme.judge(e);
    const sb = kind === 'Bridge' ? bridgeTheme.judge(e) : null;
    const iv = {
      direction: round2(dev.degrees / limit),
      magnitude: round2(usual > 0 && m > 0 ? clamp(Math.log2(m / usual), -1, 1) : 0),
    };
    iv.length = round2(Math.sqrt(iv.direction ** 2 + (0.5 * iv.magnitude) ** 2));
    const out = {
      magnitude: m,
      usual,
      intensity: intensity(f),
      direction: dev.degrees,
      limit,
      judged: dev.judged,
      dirStatus: band(dev.degrees, limit, dev.judged),
      iv,
      branchHint: !aside && dev.judged && iv.length >= 1,
      section: name,
      sectionKind: kind,
      syllables: syllables(f.event),
      end: endSound(f.event),
      bridgeTurn: sb && sb.judged ? sb.degrees : null,
    };
    if (returnOf) out.returnOf = returnOf;
    else {
      const rep = repeatOf({ event: f.event, words, embedding: e }, seen);
      if (rep) out.repeat = rep;
    }
    metrics[f.id] = out;

    if (!aside) {
      let sec = sections[sections.length - 1];
      if (!sec || sec.no !== here) sections.push((sec = { no: here, name, kind, ids: [] }));
      sec.ids.push(f.id);
      if (!returnOf) {
        theme.add(e);
        if (kind !== 'Bridge') bridgeTheme.add(e);
        sizes.push(m);
      }
      if (kind === 'Chorus') chorusLines.push({ id: f.id, words, embedding: e, event: f.event, sec: here });
    }
    seen.push({ id: f.id, event: f.event, words, embedding: e });

    // Line notes.
    if (out.branchHint)
      notes.push({ kind: 'aside', fsId: f.id, text: `${f.id} strays from the theme (${deg(dev.degrees)}, limit ${limit.toFixed(0)}° in a ${kind.toLowerCase()}). Set it aside, or keep it in?`, maths: `intent ${iv.length.toFixed(2)}` });
    else if (!aside && out.dirStatus === 'off')
      notes.push({ kind: 'off-theme', fsId: f.id, text: `${f.id} wanders off the theme (${deg(dev.degrees)}, limit ${limit.toFixed(0)}°).`, maths: `direction ${deg(dev.degrees)}` });
    if (out.repeat) notes.push({ kind: 'repeat', fsId: f.id, text: `${f.id} is the same line as ${out.repeat.id}, outside a chorus. Delete it, or keep both?`, maths: `${Math.round(out.repeat.similarity * 100)}% alike` });
    if (m > SPLIT_AT || (usual > 0 && m > 2 * usual)) notes.push({ kind: 'split', fsId: f.id, text: `${f.id} may hold two images in one line. Split it in two?`, maths: `magnitude ${m}` });
  });

  // Section notes: meter, rhyme, a chorus that changed on its return.
  sections.forEach((sec) => {
    const ids = sec.ids;
    const syl = ids.map((id) => metrics[id].syllables);
    const mid = median(syl);
    if (ids.length >= 3 && mid > 0)
      ids.forEach((id) => {
        const g = Math.abs(metrics[id].syllables - mid) / mid;
        metrics[id].meterGap = round2(g);
        if (g > METER_GAP)
          notes.push({ kind: 'meter', fsId: id, text: `${id} runs ${metrics[id].syllables > mid ? 'long' : 'short'}: ${metrics[id].syllables} syllables where ${sec.name} has about ${mid}.`, maths: `gap ${Math.round(g * 100)}%` });
      });
    // A line rhymes when it ends like one of the two lines before it in the section.
    const rh = ids.map((id, i) => ids.slice(Math.max(0, i - RHYME_BACK), i).some((p) => rhymes(metrics[p].end, metrics[id].end)) || ids.slice(i + 1, i + 1 + RHYME_BACK).some((n) => rhymes(metrics[n].end, metrics[id].end)));
    ids.forEach((id, i) => (metrics[id].rhymes = rh[i]));
    if (ids.length >= 4)
      ids.forEach((id, i) => {
        if (rh[i]) return;
        const others = rh.filter((x, k) => k !== i);
        if (others.filter(Boolean).length / others.length >= 0.75) notes.push({ kind: 'rhyme', fsId: id, text: `${id} breaks the rhyme the rest of ${sec.name} keeps.`, maths: `end sound “${metrics[id].end}”` });
      });
  });
  // A chorus that comes back with only some of its lines.
  const choruses = sections.filter((s) => s.kind === 'Chorus');
  choruses.slice(1).forEach((sec) => {
    const back = sec.ids.filter((id) => metrics[id].returnOf).length;
    if (back && back < sec.ids.length) {
      const changed = sec.ids.find((id) => !metrics[id].returnOf);
      notes.push({ kind: 'chorus-changed', fsId: changed, text: `This chorus returns with ${sec.ids.length - back} line${sec.ids.length - back > 1 ? 's' : ''} changed, starting at ${changed}. Update the first chorus too, or keep them different?`, maths: `${back} of ${sec.ids.length} lines return` });
    }
  });
  // The bridge should change the view.
  const bridge = live.filter((f) => f.thread !== 'branch' && metrics[f.id]?.sectionKind === 'Bridge' && metrics[f.id].bridgeTurn !== null);
  let bridgeTurn = null;
  // Offline vectors are hashed words: too rough to say a bridge does not turn.
  const real = bridge.some((f) => (cleanVector(decodeVector(f)) || []).length >= 512);
  if (bridge.length >= 2 && real) {
    bridgeTurn = median(bridge.map((f) => Math.abs(metrics[f.id].bridgeTurn)));
    if (bridgeTurn < limitFor(tf, 'Verse') / 3)
      notes.push({ kind: 'bridge-flat', fsId: bridge[0].id, text: `The bridge stays close to the verses (${bridgeTurn.toFixed(0)}°). A bridge usually turns: a new view, a new feeling. On purpose?`, maths: `turn ${bridgeTurn.toFixed(0)}°` });
  }
  const judged = live.filter((f) => f.thread !== 'branch' && metrics[f.id].judged);
  const offs = judged.slice(-6).filter((f) => ['off', 'drifting'].includes(metrics[f.id].dirStatus)).length;
  return {
    metrics,
    notes,
    info: {
      tf,
      autoTf: DEFAULT_TF,
      sections: sections.map((s) => ({ name: s.name, kind: s.kind, count: s.ids.length, returns: s.ids.filter((id) => metrics[id].returnOf).length })),
      bridgeTurn,
      health: judged.length < 3 ? 'quiet' : offs >= 3 ? 'drift' : offs ? 'wander' : 'ok',
    },
  };
}

const deg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(0)}°`;

// No stages in a song: its sections are the flow.
function stagesFor() {
  return { after: Infinity, labels: [] };
}

// Offline placement: a line names its section when the writer says so ("chorus: …"),
// else it stays in the section of the line before it.
function placeFor(input = {}) {
  const t = String(input.text || '');
  const said = /^\s*(verse\s*\d*|chorus|refrain|bridge|outro|pre-?chorus)\s*[:\-–]/i.exec(t);
  return { section: said ? said[1].replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null, text: said ? t.slice(said[0].length).trim() : t };
}

export { SECTIONS, WEIGHT, sectionKind, limitFor, scoreJourney, stagesFor, placeFor };
