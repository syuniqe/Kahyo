// Reason · definition 

export default {
  id: 'reason',
  name: 'Reason',
  status: 'live',
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

  footstep: [
    { field: 'event', means: 'One point: a question, source, method step, result or inference.' },
    { field: 'phase', means: 'Which of the five phases it belongs to.' },
    { field: 'role', means: 'main (the phase\'s statement, on the line) or work (beneath it).' },
    { field: 'source', means: 'The citation or source, for what is already known.' },
    { field: 'seeds', means: 'Links: a result relies on the method it comes from.' },
    { field: 'intensity', means: 'How much the point matters to the argument, 0 to 1.' },
  ],
  signals: [
    { name: 'Direction', means: 'How far a point strays from its phase (main points from the spine): on topic, loose, drifting or off topic. Tight at the Conclusion.' },
    { name: 'Answer', means: 'How far the Conclusion sits from the question in the Introduction.' },
    { name: 'Intent vector', means: 'A lot in a strange direction is unplanned work: a side path.' },
    { name: 'Structure', means: 'Empty phases, findings without a method, literature without a source.' },
  ],
  notes: ['Outside the plan', 'Off topic', 'Conclusion drifts from the question', 'Phase is empty', 'Finding without a method', 'Source missing', 'Same point twice', 'May be two points'],
};
