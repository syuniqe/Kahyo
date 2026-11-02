// Reason · prompts. Server only.

const list = (xs) => (Array.isArray(xs) ? xs.map(String) : []);
const PHASES = 'Introduction|Literature|Methodology|Results & Inference|Conclusion';

export const TASKS = {
  // data: { title, setup?, points: [{id, phase, role, event}], transcript }
  extract(d) {
    const paper = (d.points || []).map((f) => `[${f.phase}${f.role === 'main' ? ', main point' : ''}] ${f.id}: ${f.event}`).join('\n');
    return {
      prompt: `You are the extraction layer of Kāhyo's Reason model, for studies, articles, papers and theses.
The writer just said or typed one point of their work. Turn it into exactly ONE Footstep. Never split it; set events_count to the number of separate points it holds.
Keep the writer's own words, fixing only grammar and filler. Never add a claim, number or source they did not give.
Decide its phase: ${PHASES}.
- role "main" only if it is the phase's central statement (the research question, the gap in what is known, the overall method, the main finding, the answer) and that phase has no main point yet; otherwise "work".
- source: the citation or source the writer names, if any.
- supports: ids of earlier Methodology Footsteps a result or inference comes from.
- unplanned: true only if it reports something that happened outside the plan (lost data, a changed sample, an unexpected event).
Work: ${d.title}${d.setup ? `\nAbout: ${d.setup}` : ''}
The work so far:
${paper || '(empty)'}

Writer's point:
"""${String(d.transcript || '')}"""`,
      schema: `{"footsteps":[{"event":"the point, in the writer's words","phase":"${PHASES}","role":"main|work","source":"","supports":["FS#…"],"unplanned":false,"events_count":1,"subjects":["key terms"],"context":"","intensity":0.0-1.0}]}`,
    };
  },

  split(d) {
    return {
      prompt: `Split this point from a research paper into exactly two consecutive points, keeping the writer's words and adding nothing. Rate each one's importance from 0 to 1.\nPoint: ${d.event}`,
      schema: '{"footsteps":[{"event":"","subjects":[""],"context":"","intensity":0.5},{"event":"","subjects":[""],"context":"","intensity":0.5}]}',
    };
  },

  // data: { title, setup?, phases: [{name, main, work: [string], sources: [string]}], sidePaths: [string] }
  draft(d) {
    return {
      prompt: `You help a researcher; you never replace them. Turn their points into a helper outline of "${d.title}".
RULES: One "## <phase>" heading per phase, in order. Under it, the phase's main point as a short paragraph, then its work as bullet points, in the writer's words. Use only their facts, numbers and sources; never add any. Where an argument has a gap, write a bracketed question, e.g. [Which test supports this?]. End with "## Outside the plan" for side-path points, if any. No commentary.
${d.setup ? `About: ${d.setup}\n` : ''}
${(d.phases || []).map((p) => `${p.name}\nMain: ${p.main || '(none)'}\nWork:\n${list(p.work).map((w) => `- ${w}`).join('\n') || '(none)'}${list(p.sources).length ? `\nSources: ${list(p.sources).join('; ')}` : ''}`).join('\n\n')}

Outside the plan:
${list(d.sidePaths).join('\n') || '(none)'}`,
      temperature: 0.2,
    };
  },
};
