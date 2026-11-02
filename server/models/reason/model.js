// Reason · definition (coming soon: no engine or prompts yet)

export default {
  id: 'reason',
  name: 'Reason',
  status: 'coming-soon',
  for: 'Studies, investigations, articles, research papers and theses.',

  map: {
    layout: 'horizontal, right to left',
    reads: 'Across the page from right to left, one phase after another.',
  },

  phases: [
    { name: 'Introduction', means: 'The question and why it matters.' },
    { name: 'Literature', means: 'What is already known.' },
    { name: 'Methodology', means: 'How the question is studied.' },
    { name: 'Results', means: 'What was found.' },
    { name: 'Inference', means: 'What the results mean.' },
    { name: 'Conclusion', means: 'The answer and what follows from it.' },
  ],

  footstep: 'To define.',
  signals: 'To define: what on course, off topic and a missing step mean in a study.',
  notes: 'To define.',
};
