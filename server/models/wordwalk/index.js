// Wordwalk: the NSMM for stories. Definition + engine + prompts in one object.
import definition from './model.js';
import { scoreJourney, stagesFor } from './rules.js';
import { TASKS } from './prompts.js';

export default {
  ...definition,
  engine: { score: scoreJourney, stages: stagesFor },
  tasks: TASKS,
};
