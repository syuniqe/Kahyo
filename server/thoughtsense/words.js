// ThoughtSense core · words
// Turns text into content words (no filler, no stop words, rough stems), and into
// offline vectors when no embedding service is available. Server only.

import { norm } from './vectors.js';

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

export { STOP, FILLER, contentWords, localEmbedding };
