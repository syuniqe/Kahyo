// Juris · definition 

export default {
  id: 'juris',
  name: 'Juris',
  status: 'live',
  for: 'Legal case preparation',
  flow: 'A map around the case: hearings and evidence, then what each one led to. Everything links back to the centre.',

  map: {
    layout: 'mind map',
    reads: 'Circular nodes. The case sits at the centre. Every other node attaches to the centre or to another node, and every chain leads back to the centre.',
  },

  // No fixed order: a case grows outward from its centre.
  phases: [{ name: 'Case', means: 'The central node the whole map belongs to.' }],

  footstep: [
    { field: 'event', means: 'One point in the case, in the lawyer\'s words.' },
    { field: 'kind', means: 'filing, hearing, order, evidence or outcome.' },
    { field: 'date', means: 'When it happened.' },
    { field: 'parent', means: 'The Case, or the point it happened at or came from.' },
    { field: 'seeds', means: 'Relates-to links to evidence.' },
    { field: 'intensity', means: 'How much it matters to the case, 0 to 1.' },
  ],
  signals: [
    { name: 'Linked', means: 'Whether a point leads back to the case, and how many steps away.' },
    { name: 'Direction', means: 'How far a point reads from the rest of the case.' },
    { name: 'Dates', means: 'An outcome dated before what it came from.' },
    { name: 'Facts', means: 'Two points about the same thing with different dates or figures.' },
  ],
  notes: ['Not linked to the case', 'Far from the case', 'Dates out of order', 'Facts disagree', 'Evidence not used yet', 'Same point twice'],
};
