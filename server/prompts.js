// Kahyo's prompts. Server only: the browser sends story data and a task name,
// never sees these words, and gets back the model's answer.

const EXTRACT_SCHEMA = `{
  "footsteps": [{
    "events_count": how many separate story events this Footstep holds (1 if it is one step),
    "event": "the writer's own words for this Footstep, with only grammar and filler fixed (change under 5% of the words; never paraphrase or summarise)",
    "subjects": ["canonical character or entity names involved"],
    "context": "when and in what circumstances, if the writer said",
    "environment": ["the place or space where it happens, if the writer said"],
    "intensity": 0.0-1.0 (impact on the story: 0 = a quiet beat, 1 = changes everything),
    "promises": ["setups planted that the story must later pay off"],
    "seeds": [{"target": "existing id like FS#003, or NEW1/NEW2 for an earlier footstep in this same list", "type": "cause|casual|character_arc", "direction": "from (the target causes this one) or to (this one causes the target)"}]
  }],
  "rejoins": "only if this fragment is where an open side path's character or thread comes back into the MAIN story (e.g. a missing character returns for the final fight): that side path's latest Footstep id; otherwise null",
  "place_after": "a side path's latest Footstep id if this continues that side path; otherwise the main-thread id these new Footsteps come right after in STORY time, START if they come before everything, or END if they simply continue the main story",
  "aliases": [{"alias": "another name or description used for a character", "name": "that character's canonical name"}],
  "new_traits": [{"character": "name", "trait": "one short trait, e.g. jealous, arrogant, never lies"}],
  "physical_features": [{"character": "name", "feature": "a short phrase about body, face, age, clothing or voice the writer stated, e.g. 'big, fat king'"}],
  "violations": [{"footstep": "NEW1", "character": "name", "trait": "exact existing trait text", "severity": "soft|hard", "suggestion": "how the writer could keep the character true to the trait, or justify the change"}]
}`;

const list = (xs) => (Array.isArray(xs) ? xs.map(String) : []);

function extractPeople(characters = []) {
  return characters
    .map((c) => {
      const aka = list(c.aliases).length ? ` (also called: ${list(c.aliases).join(', ')})` : '';
      const traits = list(c.traits).length ? `: traits ${list(c.traits).map((t) => `"${t}"`).join(', ')}, strictness ${Number(c.strictness ?? 0.6).toFixed(1)}` : '';
      return `- ${c.name}${aka}${list(c.physical).length ? ` [looks: ${list(c.physical).join('; ')}]` : ''}${traits}`;
    })
    .join('\n');
}

function people(characters = []) {
  return characters
    .map((c) => `${c.name}${list(c.aliases).length ? ` (also called ${list(c.aliases).join(', ')})` : ''}${list(c.physical).length ? ` (looks: ${list(c.physical).join(', ')})` : ''}${list(c.traits).length ? `; traits: ${list(c.traits).join(', ')}` : ''}`)
    .join('\n');
}

// Each task: (data) => { prompt, schema?, temperature? }. With a schema the answer is JSON.
export const TASKS = {
  // data: { title, main: [{id, event}], branches: [{id, event}], characters, transcript }
  extract(d) {
    const recent = (d.main || [])
      .map((f, i) => `${i + 1}. ${f.id}: ${f.event}`)
      .slice(-80)
      .join('\n');
    // Older clients sent a flat list of side-path Footsteps.
    const paths = (d.branches || []).map((p) => (Array.isArray(p.steps) ? p : { from: null, steps: [p] }));
    const sides = paths
      .map(
        (p) =>
          `Side path${p.from ? ` leaving ${p.from}` : ''}${p.ended ? ' (ended)' : ''}${p.rejoins ? ` (already rejoined the main story at ${p.rejoins})` : ''}:\n` +
          p.steps.map((f, i) => `   ${f.id}: ${f.event}${i === p.steps.length - 1 && !p.ended && !p.rejoins ? '   <- its latest Footstep' : ''}`).join('\n')
      )
      .join('\n');
    const people = extractPeople(d.characters);
    const transcript = String(d.transcript || '');
    return {
      prompt: `You are the extraction layer of Kahyo, a voice-first storytelling system based on the Wordwalk Model, a Narrative Storyline Mapping Model (NSMM), and its ThoughtSense Engine.
A writer just spoke a fragment of their story out loud. Turn it into exactly ONE Footstep, however many sentences it has. Never split it: the writer decides that. Instead, set events_count to the number of separate story events it holds.
The event is the writer's own words. Keep their wording; fix only grammar and drop filler ("um", "so basically"). Do not summarise, shorten or rephrase.
Writers speak out of order and do not say where an idea goes. Read its content and decide where it belongs, then set place_after:
- If it continues one of the side paths below (the same "what if", the same characters in that situation, or it follows from that path's events), set place_after to that side path's latest Footstep id. This matters most: never put a side path's idea on the main thread.
- If it happens earlier in the main story (e.g. "before the king...", "earlier,", "back when", or the content clearly comes before), set place_after to the main Footstep it follows, or START.
- Only use END when it truly continues the end of the main story.
- A side path can also come back: when the fragment happens on the main story but brings back a side path's character or thread (a missing character returns, two threads meet for the climax), place it on the main story and set rejoins to that side path's latest Footstep id.
Use the story so far to understand pronouns and references.
Characters: use one canonical name per person. When the writer reveals that a description or second name is someone already known (e.g. "the prince's wife" is Rita, or Arjun's father turns out to be Krishna), add it to aliases and use the canonical name in subjects.
Link each new Footstep to earlier ones for every real relationship: cause (one makes the other happen; if one changed, the other would too; this includes a setup and its payoff, or a promise and where it is kept), casual (a looser connection, like a shared theme, place or object), or character_arc (the same character's change or return). Most Footsteps have one or two links. Story order is tracked separately.
Check every new Footstep against the character traits below. Strictness goes from 0 (the character may evolve freely) to 1 (must never break a trait). Report a violation only when a character acts against a trait by more than their strictness allows. Use "hard" when strictness is 0.8 or more.
Only report new_traits the writer explicitly states about a character's lasting nature, as short list items (jealous, arrogant, loyal to the king), and physical_features the writer states about how a character looks or sounds.

Journey: ${d.title}
Main thread in story order (oldest first):
${recent || '(none yet)'}

Side paths (what-ifs that leave the main thread):
${sides || '(none yet)'}

Characters:
${people || '(none yet)'}

Writer's spoken fragment:
"""${transcript}"""`,
      schema: EXTRACT_SCHEMA,
    };
  },

  // data: { plannedLength, main: [{id, event}] }
  stages(d) {
    return {
      prompt: `You label the stages of a story being written in Kahyo (Wordwalk Journey Mapping). The story is unfinished: ${d.main.length} of about ${d.plannedLength} planned Footsteps are written.
Stages, in order:
- Origin: the world and characters before the story moves.
- Pandiculation: the story stretches open: the inciting event and new threads.
- Maxspan: the widest point: most threads open, complications peak.
- Convergence: threads pull together toward the end.
- Conclusion: the decisive confrontation and its resolution; the story closes.
Label every Footstep. Stages only move forward through the list. Do not use a stage the story has not reached yet.

Footsteps in story order:
${d.main.map((f, i) => `${i + 1}. ${f.id}: ${f.event}`).join('\n')}`,
      schema: '{"stages":[{"id":"FS#001","stage":"Origin|Pandiculation|Maxspan|Convergence|Conclusion"}]}',
    };
  },

  // data: { event, context, subjects, promises, environment }
  split(d) {
    return {
      prompt: `Split this story Footstep into exactly two smaller, consecutive Footsteps. Keep the writer's own words and facts; do not add events. Rate each one's intensity (impact on the story) from 0 to 1.\nEvent: ${d.event}\nContext: ${d.context || ''}\nSubjects: ${list(d.subjects).join(', ')}\nPromises: ${list(d.promises).join('; ')}\nEnvironment: ${list(d.environment).join('; ')}`,
      schema:
        '{"footsteps":[{"event":"","subjects":[""],"context":"","promises":[""],"environment":[""],"intensity":0.5},{"event":"","subjects":[""],"context":"","promises":[""],"environment":[""],"intensity":0.5}]}',
    };
  },

  // data: { name, texts }
  physical(d) {
    return {
      prompt: `From these story notes, list the physical features of the character "${d.name}" that the writer stated or clearly implied: body, face, age, clothing, voice, marks. Short phrases. Do not invent anything.\n\n${(d.texts || []).join('\n')}`,
      schema: '{"physical":["short phrase"]}',
    };
  },

  // data: { name, trait, event, suggestion }
  remold(d) {
    return {
      prompt: `Rewrite this story Footstep as little as possible so that ${d.name} no longer acts against the trait "${d.trait}". Keep the writer's words, other events and every other character as they are.\nFootstep: ${d.event}${d.suggestion ? `\nHint: ${d.suggestion}` : ''}`,
      schema: '{"event":"the rewritten Footstep"}',
    };
  },

  // data: { title, characters, main: [{stage, event, context, environment, subjects, promises}], branches: [{event}] }
  draft(d) {
    return {
      prompt: `You help a writer; you never replace them. Turn the story Footsteps below into a helper draft of "${d.title}".

STRICT RULES:
- Use ONLY the facts in the Footsteps, characters and context below. Do not invent any new character, place, object, event, backstory, motive, dialogue or description.
- If a scene needs a detail the writer has not given, write a short question in brackets for the writer instead, e.g. [What does the king build?]. Never fill it in yourself.
- One short paragraph per Footstep, 1 to 3 sentences, about as long as the Footstep itself. Keep the writer's own wording where you can. Do not pad.
- Start each paragraph with the Footstep number in bold, e.g. **3.** Keep the Footsteps in this order.
- Group the paragraphs under "## <stage>" headings when a stage is given.
- No word counts, no notes about length, no commentary.
- End with "## Open threads": the promises below that later Footsteps do not pay off, one per line. Then "## Side paths": the side-path Footsteps, one per line, if there are any.

Characters:
${people(d.characters) || '(none)'}

Main story, in order:
${d.main.map((f, i) => `${i + 1}. [${f.stage || 'unstaged'}] ${f.event}${f.context ? ` (${f.context})` : ''}${f.environment?.length ? ` | where: ${f.environment.join('; ')}` : ''}${f.subjects?.length ? ` | who: ${f.subjects.join(', ')}` : ''}${f.promises?.length ? ` | promises: ${f.promises.join('; ')}` : ''}`).join('\n')}

Side paths (branches, not in the main story):
${d.branches.map((f) => `- ${f.event}`).join('\n') || '(none)'}`,
      temperature: 0.2,
    };
  },
};
