// ThoughtSense core · signals of one Footstep
// Magnitude (how much happens), intensity (how big it is) and repetition
// (does it say again what an earlier Footstep said). Every model reads these;
// each model decides what they mean for its kind of work. Server only.

import { clamp, cosine, round2 } from './vectors.js';
import { contentWords } from './words.js';

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

export { dataAmount, magnitude, HEAVY_WORDS, intensity, repeatOf };
