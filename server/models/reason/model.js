// Reason · definition (coming soon: no engine or prompts yet)

export default {
  id: 'reason',
  name: 'Reason',
  status: 'coming-soon',
  for: 'Articles, papers and theses',
  flow: 'Runs left to right through Introduction, Literature, Methodology, Results & Inference and Conclusion.',

  map: {
    layout: 'horizontal, left to right',
    reads: 'Across the page from left to right, one phase after another. Each phase drops down into what was done in it.',
  },

  phases: [
    { name: 'Introduction', means: 'The question and why it matters.' },
    { name: 'Literature', means: 'What is already known.' },
    { name: 'Methodology', means: 'How the question is studied.' },
    { name: 'Results and Inference', means: 'What was found and what it means.' },
    { name: 'Conclusion', means: 'The answer and what follows from it.' },
  ],

  footstep: 'To define.',
  signals: 'To define: what on course, off topic and a missing step mean in a study.',
  notes: 'To define.',
};
