// Juris · prompts. Server only. Kāhyo organises a case; it never gives legal advice.

const list = (xs) => (Array.isArray(xs) ? xs.map(String) : []);
const SAFE = 'Never invent a date, party, citation, statute or fact. Never predict an outcome or give legal advice.';

export const TASKS = {
  // data: { title, setup?, nodes: [{id, kind, date, parent, event}], transcript }
  extract(d) {
    const map = (d.nodes || []).map((f) => `${f.id} [${f.kind}${f.date ? `, ${f.date}` : ''}] under ${f.parent || 'nothing'}: ${f.event}`).join('\n');
    return {
      prompt: `You are the extraction layer of Kāhyo's Juris model, which helps a lawyer map and document a case. ${SAFE}
The lawyer just said or typed one point about the case. Turn it into exactly ONE Footstep. Never split it; set events_count to the number of separate events it holds.
Keep the lawyer's words, fixing only grammar and filler.
- kind: filing, hearing, order, evidence, or outcome (what happened at, or what came of, an earlier point).
- date: the date stated, as YYYY-MM-DD or YYYY-MM; empty if none was said.
- parent: "CASE" for a filing, hearing, order or piece of evidence that belongs to the case directly; for an outcome, the id of the point it happened at or came from.
- relates_to: ids of evidence Footsteps this point relies on or refers to.
Case: ${d.title}${d.setup ? `\nAbout the case: ${d.setup}` : ''}
The case map so far:
${map || '(empty)'}

Lawyer's point:
"""${String(d.transcript || '')}"""`,
      schema: `{"footsteps":[{"event":"the point, in the lawyer's words","kind":"filing|hearing|order|evidence|outcome","date":"","parent":"CASE or FS#…","relates_to":["FS#…"],"events_count":1,"subjects":["parties or people named"],"context":"","environment":["court or place"],"intensity":0.0-1.0}]}`,
    };
  },

  split(d) {
    return {
      prompt: `Split this note about a legal case into exactly two notes, keeping the lawyer's words and adding nothing. ${SAFE} Rate each one's importance to the case from 0 to 1.\nNote: ${d.event}`,
      schema: '{"footsteps":[{"event":"","subjects":[""],"context":"","intensity":0.5},{"event":"","subjects":[""],"context":"","intensity":0.5}]}',
    };
  },

  // data: { title, setup?, events: [{id, kind, date, event, outcomes: [string], evidence: [string]}], loose: [string] }
  draft(d) {
    return {
      prompt: `You help a lawyer organise a case; you never replace their judgment. ${SAFE}
Write a chronology of "${d.title}" from their points below: "## Chronology" with one bullet per event in date order (date, what it was, then what happened and what it led to, then the evidence it relies on, in their words). Then "## Evidence" listing each piece. Then "## Loose points" for points not yet linked to the case. Where a date or link is missing, write a bracketed question. End with the line: "Kāhyo helps you organise a case. It is not legal advice."
${d.setup ? `About the case: ${d.setup}\n` : ''}
${(d.events || []).map((e) => `- ${e.date || '[no date]'} · ${e.kind} · ${e.id}: ${e.event}${list(e.outcomes).length ? `\n  led to: ${list(e.outcomes).join(' | ')}` : ''}${list(e.evidence).length ? `\n  evidence: ${list(e.evidence).join(' | ')}` : ''}`).join('\n')}

Loose points:
${list(d.loose).join('\n') || '(none)'}`,
      temperature: 0.2,
    };
  },
};
