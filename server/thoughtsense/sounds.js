// ThoughtSense core · sounds
// Syllables in a line and the sound it ends on, read from spelling alone (English).
// Rough on purpose: good enough to notice a line that runs long or breaks a rhyme.
// Server only.

const VOWELS = /[aeiouy]+/g;

function syllablesOf(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = w.match(VOWELS);
  return Math.max(1, groups ? groups.length : 1);
}

function syllables(text) {
  return (String(text || '').match(/[A-Za-z']+/g) || []).reduce((n, w) => n + syllablesOf(w), 0);
}

// Long vowels spelled different ways sound the same: rain / pane, night / bite.
const LONG = [
  [/(ai|ay|ei|eigh)$/, 'A'],
  [/(ee|ea|ie|ey)$/, 'E'],
  [/(igh|ie|y)$/, 'I'],
  [/(oa|oe|ow)$/, 'O'],
  [/(oo|ue|ew|ou)$/, 'U'],
];

// The end sound: the last vowel sound of the last word and what follows it.
function endSound(text) {
  const words = String(text || '').toLowerCase().match(/[a-z']+/g);
  if (!words) return '';
  let w = words[words.length - 1].replace(/'/g, '');
  if (w.length > 3 && /[^s]s$/.test(w)) w = w.slice(0, -1);
  // Magic e: pane, bite, home sound like a long vowel.
  const magic = /([aeiou])([^aeiouy]{1,2})e$/.exec(w);
  if (magic) return { a: 'A', e: 'E', i: 'I', o: 'O', u: 'U' }[magic[1]] + coda(magic[2]);
  const m = /([aeiouy]+)([^aeiouy]*)$/.exec(w);
  if (!m) return w;
  let v = m[1];
  if (!m[2] && v === 'y' && w.length > 2) v = 'E';
  for (const [re, s] of LONG) if (re.test(m[1] + (m[2] === 'gh' ? 'gh' : ''))) v = s;
  if (/igh$/.test(w.slice(0, w.length - m[2].length + (m[2].startsWith('gh') ? 2 : 0)))) v = 'I';
  return v + coda(m[2].replace(/^gh/, ''));
}

function coda(c) {
  return c.replace(/ck/g, 'k').replace(/(.)\1/g, '$1');
}

function rhymes(a, b) {
  return Boolean(a && b && a === b);
}

export { syllablesOf, syllables, endSound, rhymes };
