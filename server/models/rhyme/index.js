// Rhyme: definition + engine + prompts in one object.
import definition from './model.js';
import { scoreJourney, stagesFor, placeFor } from './rules.js';
import { TASKS } from './prompts.js';

export default {
  ...definition,
  engine: { score: scoreJourney, stages: stagesFor, place: placeFor },
  tasks: TASKS,
};
