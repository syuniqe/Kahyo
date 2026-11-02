// Wordwalk · definition
// What this model is, in plain words. The rules that make it work are in rules.js,
// the AI instructions in prompts.js. Only `id`, `name`, `for` and `status` ever
// reach the browser (see ../index.js).

export default {
  id: 'wordwalk',
  name: 'Wordwalk',
  status: 'live',
  for: 'Stories, novels, plays, screen, TV and film',
  flow: 'Rises as a story line through Origin, Pandiculation, Max Span, Convergence and Conclusion.',

  // How the map is drawn.
  map: {
    layout: 'rising line',
    reads: 'From the first idea upward. A Footstep on course climbs at 35°; one that turns away leans off that line.',
  },

  // The flow a story moves through, in order. Stages only move forward.
  phases: [
    { name: 'Origin', means: 'The world and characters before the story moves.' },
    { name: 'Pandiculation', means: 'The story stretches open: the inciting event and new threads.' },
    { name: 'Maxspan', means: 'The widest point: most threads open, complications peak.' },
    { name: 'Convergence', means: 'Threads pull together toward the end.' },
    { name: 'Conclusion', means: 'The decisive confrontation and its resolution. The tightest stage.' },
  ],

  // One Footstep = one idea in the story.
  footstep: [
    { field: 'event', means: "The idea in the writer's own words." },
    { field: 'subjects', means: 'The characters or things involved.' },
    { field: 'context', means: 'When and in what circumstances.' },
    { field: 'environment', means: 'Where it happens.' },
    { field: 'promises', means: 'Setups planted that must be paid off later.' },
    { field: 'seeds', means: 'Links to other Footsteps: cause, casual or character arc.' },
    { field: 'intensity', means: 'How big the event is for the story, 0 to 1.' },
  ],

  // What each ThoughtSense signal means in a story.
  signals: [
    { name: 'Direction', means: "Where a Footstep took the story compared with the story's course so far: on course, wandering, drifting or off course. The allowed turn narrows stage by stage." },
    { name: 'Magnitude', means: 'How much happened in the Footstep. Much more than usual is a Jump; much less is a Crawl.' },
    { name: 'Intent vector', means: 'Direction and magnitude together. Too much in an unusual direction suggests a branch (a side path).' },
    { name: 'Intensity', means: 'How big the event is, separate from how much happened or which way it went.' },
    { name: 'Terminancy', means: 'Side paths only: how far a side path has strayed from the main story. A drifting side path fades, with one note when it reaches the limit.' },
    { name: 'Repetition', means: 'A Footstep that says again what an earlier one said.' },
  ],

  // Notes the writer can see.
  notes: ['Off course', 'Drifting story', 'May be two Footsteps (offer to split)', 'Repeat', 'Character breaks a trait', 'Side path at its limit'],
};
