// Rhyme · definition (coming soon: no engine or prompts yet)

export default {
  id: 'rhyme',
  name: 'Rhyme',
  status: 'coming-soon',
  for: 'Songs and poems',
  flow: 'Runs top to bottom through verses, chorus and bridge. A chorus can return.',

  map: {
    layout: 'top to bottom',
    reads: 'From the first line down, the way a song or poem is read.',
  },

  // The parts of a piece. Unlike story stages, a phase such as the chorus can return.
  phases: [
    { name: 'Verse', means: 'A part that moves the piece forward (a para).' },
    { name: 'Chorus', means: 'The part that returns.' },
    { name: 'Bridge', means: 'A change of view or feeling before the piece closes.' },
  ],

  footstep: 'To define.',
  signals: 'To define: what on course, drift and repetition mean in a song or poem.',
  notes: 'To define.',
};
