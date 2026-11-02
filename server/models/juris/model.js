// Juris · definition (coming soon: no engine or prompts yet)

export default {
  id: 'juris',
  name: 'Juris',
  status: 'coming-soon',
  for: 'Lawyers: map how a case progresses and document every event in it.',

  map: {
    layout: 'mind map',
    reads: 'Circular nodes. The case sits at the centre. Every other node attaches to the centre or to another node, and every chain leads back to the centre.',
  },

  // No fixed order: a case grows outward from its centre.
  phases: [{ name: 'Case', means: 'The central node the whole map belongs to.' }],

  footstep: 'To define: one event in the case, documented.',
  signals: 'To define: what a missing link or an unconnected event means for a case.',
  notes: 'To define. Legal safeguards must be set before launch.',
};
