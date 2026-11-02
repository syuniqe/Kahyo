// Rhyme, Reason and Juris rules, run on their sample Journeys: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
require('../js/samples-nsmm.js');
const { localEmbedding } = require('../server/thoughtsense/words.js');
const { syllables, endSound } = require('../server/thoughtsense/sounds.js');
const { factsOf, factsDiffer } = require('../server/thoughtsense/facts.js');
const { depthToRoot } = require('../server/thoughtsense/links.js');

const S = globalThis.KAHYO_NSMM_SAMPLES;
const id = S.id;

// The sample as the app sends it to the server.
function journeyOf(model) {
  const edges = [];
  const footsteps = S[model].points.map((p, i) => {
    (p.supports || []).forEach((s) => edges.push({ from: id(s), to: id(i + 1), type: 'relies' }));
    (p.relates || []).forEach((s) => edges.push({ from: id(s), to: id(i + 1), type: 'relates' }));
    const parent = p.parent === null ? null : typeof p.parent === 'number' ? id(p.parent) : p.parent;
    return { ...p, id: id(i + 1), thread: p.aside || p.unplanned ? 'branch' : 'main', parent, embedding: localEmbedding(p.event) };
  });
  return { footsteps, edges };
}
const kinds = (out) => out.notes.map((n) => n.kind);

test('sounds: syllables and end sounds', () => {
  assert.strictEqual(syllables('The kettle hums before the rain'), 8);
  assert.strictEqual(endSound('before the rain'), endSound('along the pane'));
  assert.strictEqual(endSound('in the night'), endSound('what a sight'));
  assert.notStrictEqual(endSound('the rain'), endSound('the sea'));
});

test('facts: dates, numbers and disagreement', () => {
  const a = factsOf('Possession offered in Feb 2023 to 42 families');
  assert.deepStrictEqual(a.dates, ['2023-02']);
  assert.deepStrictEqual(a.numbers, ['42']);
  assert.ok(factsDiffer(a, factsOf('Possession letter dated Jan 2024')));
  assert.strictEqual(factsDiffer(factsOf('Hearing on 4 Jun 2024'), factsOf('Hearing 2, June 2024')), null);
});

test('links: depth to the case, loops never reach it', () => {
  const d = depthToRoot(['a', 'b', 'c', 'x', 'y'], { a: 'CASE', b: 'a', c: 'b', x: 'y', y: 'x' }, 'CASE');
  assert.deepStrictEqual([d.a, d.b, d.c], [1, 2, 3]);
  assert.strictEqual(d.x, Infinity);
});

test('Rhyme: sections, chorus returns, limits per section', async () => {
  const { scoreJourney, limitFor } = await import('../server/models/rhyme/rules.js');
  assert.ok(limitFor(0.35, 'Chorus') < limitFor(0.35, 'Verse 1') && limitFor(0.35, 'Verse 1') < limitFor(0.35, 'Bridge'));
  const out = scoreJourney(journeyOf('rhyme'));
  assert.strictEqual(out.metrics['FS#010'].returnOf, 'FS#005');
  assert.ok(!out.metrics['FS#010'].repeat, 'a returning chorus is not a repeat');
  assert.ok(kinds(out).includes('chorus-changed'));
  assert.ok(kinds(out).includes('split'));
  assert.deepStrictEqual(out.info.sections.map((s) => s.name), ['Verse 1', 'Chorus', 'Verse 2', 'Chorus 2', 'Bridge', 'Outro']);
});

test('Reason: spine, support, missing Conclusion', async () => {
  const { scoreJourney, limitFor } = await import('../server/models/reason/rules.js');
  assert.ok(limitFor(0.35, 'Conclusion') < limitFor(0.35, 'Methodology'));
  const out = scoreJourney(journeyOf('reason'));
  assert.strictEqual(out.info.question, 'FS#001');
  assert.deepStrictEqual(out.info.phases.map((p) => p.main), ['FS#001', 'FS#004', 'FS#009', 'FS#014', null]);
  const unsupported = out.notes.filter((n) => n.kind === 'unsupported').map((n) => n.fsId);
  assert.deepStrictEqual(unsupported, ['FS#017']);
  assert.ok(out.notes.some((n) => n.kind === 'empty' && n.phase === 'Conclusion'));
});

test('Juris: linked to the case, dates, facts', async () => {
  const { scoreJourney } = await import('../server/models/juris/rules.js');
  const out = scoreJourney(journeyOf('juris'));
  assert.strictEqual(out.metrics['FS#001'].level, 1);
  assert.strictEqual(out.metrics['FS#010'].level, 3);
  assert.strictEqual(out.metrics['FS#014'].linked, false);
  assert.ok(out.notes.some((n) => n.kind === 'unlinked' && n.fsId === 'FS#014'));
  assert.ok(out.notes.some((n) => n.kind === 'dates' && n.fsId === 'FS#012'));
  assert.ok(out.notes.some((n) => n.kind === 'facts' && n.fsId === 'FS#008' && n.other === 'FS#003'));
  assert.strictEqual(out.info.loose, 1);
});
