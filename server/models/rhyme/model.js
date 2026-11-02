// Rhyme · definition 

export default {
  id: 'rhyme',
  name: 'Rhyme',
  status: 'live',
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

  footstep: [
    { field: 'event', means: 'One line or one image, in the writer\'s words.' },
    { field: 'section', means: 'Verse 1, Chorus, Verse 2, Bridge, Outro…' },
    { field: 'subjects', means: 'Images and motifs in the line.' },
    { field: 'context', means: 'The feeling, in a few words.' },
    { field: 'intensity', means: 'How strongly the line lands, 0 to 1.' },
  ],
  signals: [
    { name: 'Direction', means: 'How far a line strays from the theme of the piece: on theme, wandering, drifting or off theme. Tight in the chorus and outro, wide in the bridge.' },
    { name: 'Return', means: 'A chorus line that comes back. Never a repeat.' },
    { name: 'Bridge turn', means: 'How far the bridge turns from the verses. A bridge should change the view.' },
    { name: 'Meter', means: 'Syllables against the section\'s usual count.' },
    { name: 'Rhyme', means: 'Whether a line ends like the lines around it.' },
  ],
  notes: ['Set aside', 'Off theme', 'Same line again', 'Two images in one line', 'Line runs long or short', 'Breaks the rhyme', 'Chorus changed on its return', 'The bridge does not turn'],
};
