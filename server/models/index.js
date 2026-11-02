// The NSMMs (Narrative Structure Mapping Models). Each Journey uses exactly one,
// chosen when the Journey is created. Every model shares the ThoughtSense Engine
// (../thoughtsense/) and adds its own flow, rules and prompts.
// Server only. See README.md in this folder.

import wordwalk from './wordwalk/index.js';
import rhyme from './rhyme/index.js';
import reason from './reason/index.js';
import juris from './juris/index.js';

// In the order the picker shows them.
export const MODELS = [wordwalk, rhyme, reason, juris];

// Journeys made before models existed are Wordwalk Journeys.
export const DEFAULT_MODEL = 'wordwalk';

export function getModel(id) {
  return MODELS.find((m) => m.id === (id || DEFAULT_MODEL)) || null;
}

// All the browser ever learns about the models: the picker's words, no rules or prompts.
export function publicModels() {
  return MODELS.map(({ id, name, for: forWork, flow, status }) => ({ id, name, for: forWork, flow, status }));
}
