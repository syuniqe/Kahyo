// Rhyme · prompts. Server only: the browser sends the song so far and a task name.

const list = (xs) => (Array.isArray(xs) ? xs.map(String) : []);

export const TASKS = {
  // data: { title, setup?, lines: [{id, section, event}], transcript }
  extract(d) {
    const song = (d.lines || []).map((f) => `[${f.section}] ${f.id}: ${f.event}`).join('\n');
    return {
      prompt: `You are the extraction layer of Kāhyo's Rhyme model, for songs and poems.
The writer just said or typed a line (or one image) for their piece. Turn it into exactly ONE Footstep. Never split it; if it holds more than one image, set events_count to how many.
Keep the writer's words exactly, fixing only obvious filler ("um", "so the next line is"). Never rewrite a lyric.
Decide which section it belongs to: "Verse 1", "Verse 2"…, "Pre-chorus", "Chorus", "Bridge" or "Outro". If the writer names the section, use it. A line that repeats an earlier chorus line goes in a new "Chorus". Otherwise continue the section of the last line, or start the next verse when the writer says so.
Piece: ${d.title}${d.setup ? `\nAbout: ${d.setup}` : ''}
The piece so far, top to bottom:
${song || '(empty)'}

Writer's line:
"""${String(d.transcript || '')}"""`,
      schema: `{"footsteps":[{"event":"the line, in the writer's words","section":"Verse 1|Chorus|Bridge|Outro|…","events_count":1,"subjects":["images or motifs in it, e.g. rain, letters"],"context":"the feeling, in two or three words","intensity":0.0-1.0}]}`,
    };
  },

  split(d) {
    return {
      prompt: `Split this line of a song or poem into exactly two lines, keeping the writer's own words and adding nothing. Rate each one's intensity from 0 to 1.\nLine: ${d.event}`,
      schema: '{"footsteps":[{"event":"","subjects":[""],"context":"","intensity":0.5},{"event":"","subjects":[""],"context":"","intensity":0.5}]}',
    };
  },

  // data: { title, setup?, sections: [{name, lines: [string]}], asides: [string] }
  draft(d) {
    return {
      prompt: `You help a songwriter or poet; you never replace them. Lay out "${d.title}" as a lyric sheet from their lines below.
RULES: Use only their lines, in this order, under their section headings (## Verse 1, ## Chorus…). Do not write new lines. Where a section feels short, add one bracketed question for the writer, e.g. [A line that answers the rain?]. End with "## Set aside": the lines they set aside, if any. No commentary.
${d.setup ? `About: ${d.setup}\n` : ''}
${(d.sections || []).map((s) => `## ${s.name}\n${list(s.lines).join('\n')}`).join('\n\n')}

Set aside:
${list(d.asides).join('\n') || '(none)'}`,
      temperature: 0.2,
    };
  },
};
