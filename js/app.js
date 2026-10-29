// Kahyo demo app: Journeys home → voice → Footsteps → Journey graph → continuity checks → helper draft.

(function () {
  const $ = (sel) => document.querySelector(sel);
  const INDEX_KEY = 'kahyo.journeys';
  const LEGACY_KEY = 'kahyo.journey';
  const jKey = (id) => 'kahyo.j.' + id;
  // Links between Footsteps. A cause link is stored once (from the cause to its
  // consequence); the consequence side is shown on the other Footstep automatically.
  const EDGE_TYPES = {
    cause: { label: 'Cause', back: 'Consequence of', color: '#FD3A0A' },
    casual: { label: 'Casual link', back: 'Casual link', color: '#b07ad4' },
    character_arc: { label: 'Character arc', back: 'Character arc', color: '#6db3e0' },
    temporal: { label: 'Story order', back: 'Story order', color: '#7a7a8e' },
  };
  // Each link type has its own line: cause solid, casual dashed, character arc dotted.
  const LINK_DASHES = { casual: [7, 5], character_arc: [2, 4] };
  const LILAC = '#9b72d9';
  const OLD_EDGE = { causal: 'cause', setup_resolution: 'cause', thematic: 'casual' };
  const OLD_STRICTNESS = { strict: 0.9, moderate: 0.6, flexible: 0.3, off: 0 };
  // Graph geometry: 0° points right. A Footstep's line leaves the one before it at
  // its direction (anticlockwise +, clockwise −), its length is the magnitude and
  // its circle size the intensity.
  const PHYSICAL_WORDS =
    'tall short fat thin big small huge tiny old young elderly bald bearded beard moustache scar scarred blind lame limp limping strong heavy heavy-set wiry pale dark fair red-faced grey gray white-haired grey-haired blue-eyed one-eyed hunched giant plump skinny muscular beautiful handsome ugly wrinkled stout slender broad frail tattooed freckled curly'.split(
      ' '
    );

  let journey = null;
  let network = null;
  let selectedId = null;
  let charView = null;
  let busy = false;
  let stageMarks = [];
  let nodeSet = null;

  // ---------- persistence: one record per Journey, plus an index ----------

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newJourney(title = 'Untitled Journey') {
    return {
      id: uid(),
      title,
      stage: null,
      plannedLength: NSMM.DEFAULT_PLANNED_LENGTH,
      tf: null, // null = automatic from the planned length
      branchShare: NSMM.DEFAULT_BRANCH_SHARE,
      embedder: null,
      footsteps: [],
      edges: [],
      characters: [],
      alerts: [],
      draft: '',
      order: [],
      nextId: 1,
      aiStaged: 0,
      created: Date.now(),
      updated: Date.now(),
    };
  }

  function normalize(j) {
    if (!j || !Array.isArray(j.footsteps)) return null;
    j = { ...newJourney(), ...j };
    delete j.threshold;
    if (!Array.isArray(j.order)) j.order = j.footsteps.filter((f) => f.thread === 'main').map((f) => f.id);
    j.characters.forEach((c) => {
      c.traits = (c.traits || []).map((t) => (typeof t === 'string' ? { text: t } : t));
      c.physical = c.physical || [];
      c.aliases = c.aliases || [];
      if (!Number.isFinite(c.strictness)) {
        const levels = c.traits.map((t) => OLD_STRICTNESS[t.level] ?? 0.6);
        c.strictness = levels.length ? Math.max(...levels) : 0.6;
      }
      c.traits.forEach((t) => delete t.level);
    });
    if (j.stage) j.stage = NSMM.stageName(j.stage);
    j.footsteps.forEach((f) => {
      if (f.stage === undefined) f.stage = null;
      if (f.stage) f.stage = NSMM.stageName(f.stage);
      f.violations = f.violations || [];
      if (!f.environment) f.environment = f.world_rules || [];
      delete f.world_rules;
      delete f.intent_signal;
      if (f.intensity === undefined && Number.isFinite(f.plot_intensity)) f.intensity = f.plot_intensity;
      delete f.plot_intensity;
    });
    j.edges.forEach((e) => (e.type = OLD_EDGE[e.type] || (EDGE_TYPES[e.type] ? e.type : 'casual')));
    return j;
  }

  function listIds() {
    try {
      return JSON.parse(localStorage.getItem(INDEX_KEY)) || [];
    } catch {
      return [];
    }
  }

  function setIds(ids) {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
    } catch {}
  }

  // The first version kept a single Journey. Move it into the library.
  function migrate() {
    if (localStorage.getItem(INDEX_KEY)) return;
    const ids = [];
    try {
      const old = normalize(JSON.parse(localStorage.getItem(LEGACY_KEY)));
      if (old && old.footsteps.length) {
        old.id = uid();
        localStorage.setItem(jKey(old.id), JSON.stringify(old));
        ids.push(old.id);
      }
    } catch {}
    setIds(ids);
  }

  function readJourney(id) {
    try {
      return normalize(JSON.parse(localStorage.getItem(jKey(id))));
    } catch {
      return null;
    }
  }

  // Embeddings are rounded so many Journeys fit in the browser's storage.
  function save() {
    if (!journey) return;
    journey.updated = Date.now();
    try {
      localStorage.setItem(jKey(journey.id), JSON.stringify(journey, (k, v) => (k === 'embedding' && Array.isArray(v) ? v.map((x) => Math.round(x * 1e4) / 1e4) : v)));
      const ids = listIds();
      if (!ids.includes(journey.id)) setIds([journey.id, ...ids]);
    } catch (e) {
      console.warn('Could not save journey', e);
      setStatus('Browser storage is full. Export and delete an old Journey to keep saving.', 'err');
    }
  }

  function deleteJourney(id) {
    localStorage.removeItem(jKey(id));
    setIds(listIds().filter((x) => x !== id));
  }

  function saveSettings(patch) {
    const s = { ...LLM.settings(), ...patch };
    try {
      localStorage.setItem('kahyo.settings', JSON.stringify(s));
    } catch {}
  }

  // ---------- helpers ----------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  function fsById(id) {
    return journey.footsteps.find((f) => f.id === id);
  }

  // Story order of the main thread. The spine of the graph and the draft both
  // follow it, so a new idea continues the story or slots in where it belongs.
  function storyOrder() {
    const main = new Set(journey.footsteps.filter((f) => f.thread === 'main').map((f) => f.id));
    journey.order = (journey.order || []).filter((id) => main.has(id));
    main.forEach((id) => {
      if (!journey.order.includes(id)) journey.order.push(id);
    });
    return journey.order;
  }

  function mainInOrder() {
    return storyOrder().map(fsById);
  }

  function placeInOrder(id, afterId) {
    const order = storyOrder().filter((x) => x !== id);
    const at = afterId === 'START' ? 0 : afterId && order.includes(afterId) ? order.indexOf(afterId) + 1 : order.length;
    order.splice(at, 0, id);
    journey.order = order;
  }

  function moveInOrder(id, delta) {
    const order = storyOrder();
    const i = order.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
  }

  // The Footstep a side-path Footstep grew from (a main one, or the previous one on its path).
  function branchRoot(f) {
    const e =
      journey.edges.find((x) => x.to === f.id && x.type === 'temporal' && fsById(x.from) && fsById(x.from).thread !== 'archived') ||
      journey.edges.find((x) => x.to === f.id && fsById(x.from) && fsById(x.from).thread !== 'archived');
    return e ? fsById(e.from) : null;
  }

  // The first Footstep of the side path f is on.
  function pathStart(f) {
    let cur = f;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const up = branchRoot(cur);
      if (!up || up.thread !== 'branch') return cur;
      cur = up;
    }
    return f;
  }

  // Terminancy factor: the writer's override, else automatic from the planned length.
  function tfValue() {
    return Number.isFinite(journey.tf) ? journey.tf : NSMM.autoTerminancy(journey.plannedLength);
  }

  function fsText(f) {
    return [f.event, f.context, (f.environment || []).join(', '), (f.subjects || []).join(', ')].filter(Boolean).join('. ');
  }

  function shortText(s, n) {
    return s.length > n ? s.slice(0, n - 1) + '…' : s;
  }

  function setStatus(msg, kind = '') {
    const el = $('#status');
    if (!el) return;
    el.textContent = msg;
    el.className = 'status ' + kind;
  }

  function character(name) {
    const n = String(name).toLowerCase();
    return journey.characters.find((c) => c.name.toLowerCase() === n) || journey.characters.find((c) => (c.aliases || []).some((a) => a.toLowerCase() === n));
  }

  function ensureCharacter(name) {
    name = String(name || '').trim();
    if (!name) return null;
    let c = character(name);
    if (!c) {
      c = { name, traits: [], physical: [], aliases: [], strictness: 0.6 };
      journey.characters.push(c);
    }
    return c;
  }

  // One character known by two names ("the prince's wife" is Rita): fold `from`
  // into `into`, keep the old name as an alias, and rename it in every Footstep.
  function mergeCharacters(fromName, intoName) {
    const into = ensureCharacter(intoName);
    const from = journey.characters.find((c) => c.name.toLowerCase() === String(fromName).toLowerCase());
    if (!into || !from || from === into) return false;
    const same = (a, b) => a.toLowerCase() === b.toLowerCase();
    [from.name, ...(from.aliases || [])].forEach((a) => {
      if (!same(a, into.name) && !into.aliases.some((x) => same(x, a))) into.aliases.push(a);
    });
    from.traits.forEach((t) => {
      if (!into.traits.some((x) => same(x.text, t.text))) into.traits.push(t);
    });
    from.physical.forEach((p) => addPhysical(into, p));
    into.strictness = Math.max(into.strictness ?? 0.6, from.strictness ?? 0.6);
    journey.characters = journey.characters.filter((c) => c !== from);
    journey.footsteps.forEach((f) => {
      f.subjects = [...new Set((f.subjects || []).map((s) => (into.aliases.some((a) => same(a, s)) ? into.name : s)))];
      (f.violations || []).forEach((v) => {
        if (into.aliases.some((a) => same(a, v.character))) v.character = into.name;
      });
    });
    journey.alerts.forEach((a) => {
      if (a.character && into.aliases.some((x) => same(x, a.character))) a.character = into.name;
    });
    return true;
  }

  function addPhysical(c, feature) {
    feature = String(feature || '').trim();
    if (c && feature && !c.physical.some((p) => p.toLowerCase() === feature.toLowerCase())) c.physical.push(feature);
  }

  // A character appears in a Footstep when a subject matches their name, or
  // one contains the other ("Hale" and "Collector Hale").
  function appearsIn(f, name) {
    const n = name.toLowerCase();
    return (f.subjects || []).some((s) => {
      const x = s.toLowerCase();
      return x === n || (x.length >= 3 && n.includes(x)) || (n.length >= 3 && x.includes(n));
    });
  }

  function recurrence(c) {
    const pool = journey.footsteps.filter((f) => f.thread !== 'archived');
    const hits = pool.filter((f) => [c.name, ...(c.aliases || [])].some((n) => appearsIn(f, n)));
    return { hits, total: pool.length, pct: pool.length ? Math.round((100 * hits.length) / pool.length) : 0 };
  }

  // Offline: physical words the writer used in sentences that name the character.
  function offlinePhysical(text, name) {
    const first = name.split(/\s+/).pop().toLowerCase();
    return (text || '')
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.toLowerCase().includes(first))
      .flatMap((s) => s.toLowerCase().match(/[a-z-]+/g) || [])
      .filter((w) => PHYSICAL_WORDS.includes(w));
  }

  function currentEmbedder() {
    return LLM.hasEmbedKey() ? 'gemini' : 'local';
  }

  async function embedTexts(texts) {
    if (currentEmbedder() === 'gemini') return LLM.embed(texts);
    return texts.map((t) => NSMM.localEmbedding(t));
  }

  // If the embedder changed (key added or removed), re-embed every Footstep so
  // cosine similarity always compares vectors from the same model. Also when any
  // vector has the wrong size (an import or a fallback mixed the two).
  async function ensureEmbedder() {
    const want = currentEmbedder();
    const size = want === 'gemini' ? LLM.EMBED_DIM : NSMM.localEmbedding('').length;
    const mixed = journey.footsteps.some((f) => !f.embedding || f.embedding.length !== size);
    if (journey.embedder === want && !mixed) return;
    if (journey.footsteps.length) {
      setStatus('Re-embedding Journey with ' + (want === 'gemini' ? 'Gemini' : 'offline') + ' embeddings…');
      const vecs = await embedTexts(journey.footsteps.map(fsText));
      journey.footsteps.forEach((f, i) => (f.embedding = vecs[i]));
    }
    journey.embedder = want;
  }

  // ---------- extraction ----------

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
  "place_after": "the existing main-thread id these new Footsteps come right after in STORY time, START if they come before everything, or END if they simply continue the story",
  "aliases": [{"alias": "another name or description used for a character", "name": "that character's canonical name"}],
  "new_traits": [{"character": "name", "trait": "one short trait, e.g. jealous, arrogant, never lies"}],
  "physical_features": [{"character": "name", "feature": "a short phrase about body, face, age, clothing or voice the writer stated, e.g. 'big, fat king'"}],
  "violations": [{"footstep": "NEW1", "character": "name", "trait": "exact existing trait text", "severity": "soft|hard", "suggestion": "how the writer could keep the character true to the trait, or justify the change"}]
}`;

  function extractPrompt(transcript) {
    const recent = [
      ...mainInOrder().map((f, i) => `${i + 1}. ${f.id}: ${f.event}`),
      ...journey.footsteps.filter((f) => f.thread === 'branch').map((f) => `   (side path) ${f.id}: ${f.event}`),
    ]
      .slice(-80)
      .join('\n');
    const people = journey.characters
      .map((c) => {
        const aka = c.aliases?.length ? ` (also called: ${c.aliases.join(', ')})` : '';
        const traits = c.traits.length ? `: traits ${c.traits.map((t) => `"${t.text}"`).join(', ')}, strictness ${(c.strictness ?? 0.6).toFixed(1)}` : '';
        return `- ${c.name}${aka}${c.physical.length ? ` [looks: ${c.physical.join('; ')}]` : ''}${traits}`;
      })
      .join('\n');
    return `You are the extraction layer of Kahyo, a voice-first storytelling system based on the Wordwalk Model, a Narrative Storyline Mapping Model (NSMM), and its ThoughtSense Engine.
A writer just spoke a fragment of their story out loud. Turn it into exactly ONE Footstep, however many sentences it has. Never split it: the writer decides that. Instead, set events_count to the number of separate story events it holds.
The event is the writer's own words. Keep their wording; fix only grammar and drop filler ("um", "so basically"). Do not summarise, shorten or rephrase.
Writers speak out of order. Decide where the new Footsteps belong in the story's timeline and set place_after. Use END unless the writer signals otherwise (e.g. "before the king...", "earlier,", "at the start", "back in step 2") or the content clearly happens earlier. Use the story so far to understand pronouns and references.
Characters: use one canonical name per person. When the writer reveals that a description or second name is someone already known (e.g. "the prince's wife" is Rita, or Arjun's father turns out to be Krishna), add it to aliases and use the canonical name in subjects.
Link each new Footstep to earlier ones for every real relationship: cause (one makes the other happen; if one changed, the other would too; this includes a setup and its payoff, or a promise and where it is kept), casual (a looser connection, like a shared theme, place or object), or character_arc (the same character's change or return). Most Footsteps have one or two links. Story order is tracked separately.
Check every new Footstep against the character traits below. Strictness goes from 0 (the character may evolve freely) to 1 (must never break a trait). Report a violation only when a character acts against a trait by more than their strictness allows. Use "hard" when strictness is 0.8 or more.
Only report new_traits the writer explicitly states about a character's lasting nature, as short list items (jealous, arrogant, loyal to the king), and physical_features the writer states about how a character looks or sounds.

Journey: ${journey.title}
Main thread in story order (oldest first):
${recent || '(none yet)'}

Characters:
${people || '(none yet)'}

Writer's spoken fragment:
"""${transcript}"""`;
  }

  // Free, no-key fallback: one Footstep per sentence, subjects from known
  // character names and capitalised words, linked in time order.
  function offlineExtract(transcript) {
    const sentences = transcript
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.split(/\s+/).length >= 4);
    const known = journey.characters.map((c) => c.name);
    const skip = new Set(['The', 'Then', 'So', 'And', 'But', 'What', 'When', 'She', 'He', 'They', 'It', 'In', 'On', 'At', 'This', 'That', 'Her', 'His', 'I', 'We', 'Maybe', 'Just']);
    // One idea is one Footstep; each sentence that says something counts as an event.
    const text = transcript.trim().replace(/^(so|and|then|okay|um|uh)[,\s]+/i, '');
    const caps = sentences.flatMap((s) => (s.slice(1).match(/\b[A-Z][a-z]+\b/g) || []).filter((w) => !skip.has(w)));
    const subjects = [...new Set([...known.filter((k) => transcript.includes(k)), ...caps])].slice(0, 6);
    return {
      footsteps: [
        {
          event: text[0] ? text[0].toUpperCase() + text.slice(1) : text,
          events_count: Math.max(1, sentences.length),
          subjects,
          context: '',
          environment: [],
          promises: [],
          seeds: [],
        },
      ],
      place_after: 'END',
      aliases: [],
      new_traits: [],
      physical_features: known.flatMap((name) => offlinePhysical(transcript, name).map((w) => ({ character: name, feature: w }))),
      violations: [],
    };
  }

  // Offline links: when a character comes back after a gap, a character-arc
  // link joins their last Footstep to this one (at most two per Footstep).
  function linkCharacterArcs(fs) {
    const order = mainInOrder();
    const at = order.findIndex((f) => f.id === fs.id);
    if (at < 2) return;
    // Offline, subjects are names spotted in the text, so match them by name or alias.
    const key = (s) => (character(s)?.name || String(s)).toLowerCase();
    const names = [...new Set(fs.subjects.map(key))];
    let added = 0;
    names.forEach((name) => {
      if (added >= 2) return;
      const has = (f) => (f.subjects || []).some((s) => key(s) === name);
      if (has(order[at - 1])) return; // no gap: story order already joins them
      const before = order.slice(0, at - 1).reverse().find(has);
      if (!before || journey.edges.some((e) => e.from === before.id && e.to === fs.id)) return;
      journey.edges.push({ from: before.id, to: fs.id, type: 'character_arc' });
      added++;
    });
  }

  // ---------- core pipeline ----------

  async function addThought(transcript, preExtracted, placeAfter) {
    transcript = transcript.trim();
    if (!transcript) return;
    const extracted = preExtracted || (LLM.hasKey() ? await LLM.generateJSON(extractPrompt(transcript), EXTRACT_SCHEMA) : offlineExtract(transcript));
    let items = (extracted.footsteps || []).filter((f) => f && f.event);
    // A spoken idea becomes one Footstep. If the AI returned several anyway, join them.
    if (!preExtracted && items.length > 1) {
      const all = (k) => items.flatMap((x) => x[k] || []);
      items = [
        {
          ...items[0],
          event: items.map((x) => x.event).join(' '),
          events_count: items.reduce((n, x) => n + (Number(x.events_count) || 1), 0),
          subjects: [...new Set(all('subjects'))],
          environment: [...new Set(all('environment'))],
          promises: all('promises'),
          seeds: all('seeds').filter((sd) => !/^NEW/i.test(String(sd.target))),
          context: items.map((x) => x.context).filter(Boolean).join('; '),
          intensity: Math.max(...items.map((x) => Number(x.intensity) || 0)),
        },
      ];
    }
    if (!items.length) {
      setStatus('No Footsteps found in that fragment. Try saying what happens.', 'warn');
      return;
    }
    const reliable = LLM.hasKey() || Boolean(preExtracted);

    (extracted.aliases || []).forEach((a) => {
      if (!a?.alias || !a?.name) return;
      if (character(a.alias) && character(a.alias) !== character(a.name)) mergeCharacters(character(a.alias).name, a.name);
      else {
        const c = ensureCharacter(a.name);
        if (c && a.alias.toLowerCase() !== c.name.toLowerCase() && !c.aliases.some((x) => x.toLowerCase() === a.alias.toLowerCase())) c.aliases.push(String(a.alias));
      }
    });
    (extracted.new_traits || []).forEach((t) => {
      const c = ensureCharacter(t.character);
      if (c && t.trait && !c.traits.some((x) => x.text.toLowerCase() === t.trait.toLowerCase())) c.traits.push({ text: String(t.trait) });
    });
    (extracted.physical_features || []).forEach((p) => {
      const c = reliable ? ensureCharacter(p.character) : character(p.character);
      addPhysical(c, p.feature);
    });

    await ensureEmbedder();
    const newIds = items.map((_, i) => 'FS#' + String(journey.nextId + i).padStart(3, '0'));
    journey.nextId += items.length;
    const resolve = (target) => {
      const m = /^NEW(\d+)$/i.exec(String(target || '').trim());
      if (m) return newIds[Number(m[1]) - 1];
      return fsById(target) ? target : null;
    };
    const canonical = (name) => character(name)?.name || String(name);

    const vecs = await embedTexts(items.map(fsText));
    // Where the new Footsteps go: the writer's pick, else the model's, else the end.
    // Picking a side-path Footstep continues that side path.
    let anchor = placeAfter && placeAfter !== 'AUTO' ? placeAfter : String(extracted.place_after || 'END').trim();
    const onBranch = fsById(anchor)?.thread === 'branch';
    if (!onBranch && anchor !== 'START' && !storyOrder().includes(anchor)) anchor = 'END';

    items.forEach((raw, i) => {
      const fs = {
        id: newIds[i],
        event: String(raw.event),
        subjects: [...new Set((raw.subjects || []).map(canonical))],
        context: String(raw.context || ''),
        environment: (raw.environment || raw.world_rules || []).map(String).filter(Boolean),
        promises: (raw.promises || []).map(String),
        stage: null,
        created_at: Date.now(),
        transcript,
        embedding: vecs[i],
        thread: onBranch ? 'branch' : 'main',
        violations: [],
      };
      const events = Number(raw.events_count);
      if (Number.isFinite(events) && events > 1) fs.events = Math.round(events);
      const ai = Number(raw.intensity ?? raw.plot_intensity);
      if (reliable && Number.isFinite(ai)) fs.intensity = clamp(ai, 0, 1);
      if (reliable) fs.subjects.forEach(ensureCharacter);
      journey.footsteps.push(fs);

      (raw.seeds || []).forEach((sd) => {
        const other = resolve(sd.target);
        if (!other || other === fs.id) return;
        const type = OLD_EDGE[sd.type] || (EDGE_TYPES[sd.type] && sd.type !== 'temporal' ? sd.type : null);
        if (!type) return;
        const forward = String(sd.direction || 'from').toLowerCase() === 'to';
        journey.edges.push(forward ? { from: fs.id, to: other, type } : { from: other, to: fs.id, type });
      });

      if (onBranch) {
        journey.edges.push({ from: anchor, to: fs.id, type: 'temporal' });
      } else {
        placeInOrder(fs.id, anchor);
      }
      if (!reliable) linkCharacterArcs(fs);
      anchor = fs.id;
    });

    (extracted.violations || []).forEach((v) => {
      const id = resolve(v.footstep) || newIds[0];
      const fs = fsById(id);
      const c = character(v.character);
      const trait = c?.traits.find((t) => t.text.toLowerCase() === String(v.trait).toLowerCase()) || c?.traits[0];
      if (!fs || !trait || (c.strictness ?? 0.6) <= 0) return;
      const severity = (c.strictness ?? 0.6) >= 0.8 || v.severity === 'hard' ? 'hard' : 'soft';
      fs.violations.push({ character: c.name, trait: trait.text, severity, suggestion: v.suggestion || '' });
      addNote({ kind: 'trait', fsId: fs.id, character: c.name, trait: trait.text, severity, text: `In ${fs.id}, ${c.name} acts against "${trait.text}".`, suggestion: v.suggestion || '' });
    });

    await relabelStages(!preExtracted);
    syncNotes(newIds);
    checkDrift();
    save();
    renderAll({ fit: true });
    selectFootstep(newIds[newIds.length - 1]);
    // Quiet notes: a dot on the Footstep and a count on the Notes tab, no interruption.
    const flagged = journey.alerts.filter((a) => a.open && newIds.includes(a.fsId)).length;
    setStatus(`Added ${items.length} Footstep${items.length > 1 ? 's' : ''}.${flagged ? ` Kahyo left ${flagged} note${flagged > 1 ? 's' : ''} in the margin.` : ''}`, 'ok');
  }

  // ---------- notes ----------

  // A note stays in the list until the writer clears it. The same flag on the
  // same Footstep is noted once, even after it is cleared.
  function addNote(n) {
    if (journey.alerts.some((a) => a.kind === n.kind && a.fsId === n.fsId && (n.kind !== 'trait' || (a.character === n.character && a.trait === n.trait)))) return false;
    journey.alerts.unshift({ id: 'a' + uid(), open: true, created: Date.now(), ...n });
    return true;
  }

  const deg = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(0)}°`;

  // Turns each Footstep's flags into notes. Main thread: direction (wandering /
  // off course) and size (Jump / Crawl). Side paths: drifting and terminancy.
  function syncNotes(ids) {
    const tf = tfValue();
    journey.footsteps
      .filter((f) => f.metrics && f.thread !== 'archived' && (!ids || ids.includes(f.id)))
      .forEach((f) => {
        const m = f.metrics;
        if (f.events > 1)
          addNote({
            kind: 'split',
            fsId: f.id,
            text: `${f.id} may hold ${f.events} Footsteps in one. Split it, or keep it as one?`,
            maths: `${f.events} events`,
          });
        if (f.thread === 'main') {
          if (m.dirStatus === 'off')
            addNote({
              kind: 'off',
              fsId: f.id,
              text: `${f.id} turns ${deg(m.direction)} from where your story is heading. That is past the ${m.limit.toFixed(0)}° limit, so it is off course. Branch it into a side path?`,
              maths: `direction ${deg(m.direction)} · limit ${m.limit.toFixed(0)}°`,
            });
          else if (m.dirStatus === 'wander')
            addNote({
              kind: 'wander',
              fsId: f.id,
              text: `${f.id} wanders slightly (${deg(m.direction)}). It would be off course past ${m.limit.toFixed(0)}°.`,
              maths: `direction ${deg(m.direction)} · limit ${m.limit.toFixed(0)}°`,
            });
          if (m.sizeFlag === 'jump')
            addNote({
              kind: 'jump',
              fsId: f.id,
              text: `${f.id} is a Jump: a lot happens at once (${m.magnitude} against a usual ${m.avgMagnitude.toFixed(0)}). Split it, or keep it as one big step?`,
              maths: `magnitude ${m.magnitude} · usual ${m.avgMagnitude.toFixed(0)}`,
            });
          if (m.sizeFlag === 'crawl')
            addNote({
              kind: 'crawl',
              fsId: f.id,
              text: `${f.id} is a Crawl: much less happens than usual (${m.magnitude} against ${m.avgMagnitude.toFixed(0)}). Add to it or fold it into a neighbour?`,
              maths: `magnitude ${m.magnitude} · usual ${m.avgMagnitude.toFixed(0)}`,
            });
        } else if (f.thread === 'branch' && !pathStart(f).ended) {
          const bf = m.iv.length;
          if (m.branch === 'terminate')
            addNote({
              kind: 'terminate',
              fsId: f.id,
              text: `The side path at ${f.id} has wandered so far it will be hard to bring back. Let it end here, or change its steps to lean back toward the main story.`,
              maths: `branching factor ${bf.toFixed(2)} · terminancy ${tf.toFixed(2)}`,
            });
          else if (m.branch === 'drifting')
            addNote({
              kind: 'drifting',
              fsId: f.id,
              text: `The side path at ${f.id} is drifting further from where it branched.`,
              maths: `branching factor ${bf.toFixed(2)} · terminancy ${tf.toFixed(2)}`,
            });
        }
      });
  }

  // Story drift: of the last six Footsteps written, if half or more are side
  // paths or off course, the story is wandering from its main line.
  const DRIFT_WINDOW = 6;
  const DRIFT_SHARE = 0.5;
  function recentOffCourse() {
    const recent = journey.footsteps
      .filter((f) => f.thread !== 'archived')
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-DRIFT_WINDOW);
    const off = recent.filter((f) => f.thread === 'branch' || f.metrics?.dirStatus === 'off');
    const wander = recent.filter((f) => f.thread === 'main' && f.metrics?.dirStatus === 'wander');
    return { recent, off, wander, drifting: recent.length >= 4 && off.length >= 3 && off.length / recent.length >= DRIFT_SHARE };
  }

  // One signal for the writer instead of six numbers.
  function storyHealth() {
    const { recent, off, wander, drifting } = recentOffCourse();
    if (recent.length < 3) return { level: 'quiet', label: 'Just starting', why: 'Kahyo judges direction from the 4th Footstep on.' };
    if (drifting) return { level: 'drift', label: 'Drifting', why: `${off.length} of your last ${recent.length} Footsteps are side paths or off course.` };
    if (off.length + wander.length >= 2) return { level: 'wander', label: 'Wandering a little', why: `${off.length + wander.length} of your last ${recent.length} Footsteps wander or branch off.` };
    return { level: 'ok', label: 'On course', why: `Your last ${recent.length} Footsteps follow the main story.` };
  }

  // The drift note is raised once per drift; "It's on purpose" pauses it until
  // more Footsteps are written.
  function checkDrift() {
    const { recent, off, drifting } = recentOffCourse();
    if (!drifting) return;
    const count = journey.footsteps.length;
    if (journey.driftDismissedAt && count - journey.driftDismissedAt < DRIFT_WINDOW) return;
    if (journey.alerts.some((a) => a.open && a.kind === 'drift')) return;
    journey.alerts.unshift({
      id: 'a' + uid(),
      kind: 'drift',
      fsId: off[off.length - 1].id,
      text: `${off.length} of your last ${recent.length} Footsteps wander away from the main story (${off.map((f) => f.id).join(', ')}). Is that on purpose? If not, bring the next idea back to the main line.`,
      maths: `${off.length} of ${recent.length} recent Footsteps`,
      open: true,
      created: Date.now(),
    });
  }

  // ---------- stages ----------

  // No stage labels until 20% of the planned Footsteps exist. Then the AI reads
  // the whole story and labels each Footstep (every 3 new Footsteps, to save the
  // free quota), with a position-based fallback offline.
  async function relabelStages(allowAI) {
    const main = mainInOrder();
    const n = main.length;
    if (n < NSMM.stageLabelAfter(journey.plannedLength)) {
      journey.footsteps.forEach((f) => (f.stage = null));
      journey.stage = null;
      journey.aiStaged = 0;
      rescoreAll();
      return;
    }
    let labels = null;
    if (allowAI && LLM.hasKey() && (!journey.aiStaged || n - journey.aiStaged >= 3)) {
      try {
        setStatus('Reading the whole Journey to label its stages…');
        labels = await aiStages(main);
        journey.aiStaged = n;
      } catch (e) {
        console.warn('Stage labelling failed', e);
      }
    }
    if (!labels) {
      if (journey.aiStaged) {
        // Keep the AI's labels; a new Footstep takes the stage of the one before it.
        let prev = NSMM.STAGES[0];
        labels = main.map((f) => (prev = f.stage || prev));
      } else {
        labels = NSMM.heuristicStages(n, journey.plannedLength);
      }
    }
    labels = NSMM.monotonicStages(labels);
    main.forEach((f, i) => (f.stage = labels[i]));
    journey.footsteps
      .filter((f) => f.thread !== 'main')
      .forEach((f) => {
        const root = branchRoot(f);
        f.stage = root?.stage || null;
      });
    journey.stage = labels[n - 1];
    rescoreAll();
  }

  async function aiStages(main) {
    const res = await LLM.generateJSON(
      `You label the stages of a story being written in Kahyo (Wordwalk Journey Mapping). The story is unfinished: ${main.length} of about ${journey.plannedLength} planned Footsteps are written.
Stages, in order:
- Origin: the world and characters before the story moves.
- Pandiculation: the story stretches open: the inciting event and new threads.
- Maxspan: the widest point: most threads open, complications peak.
- Convergence: threads pull together toward the end.
- Conclusion: the decisive confrontation and its resolution; the story closes.
Label every Footstep. Stages only move forward through the list. Do not use a stage the story has not reached yet.

Footsteps in story order:
${main.map((f, i) => `${i + 1}. ${f.id}: ${f.event}`).join('\n')}`,
      '{"stages":[{"id":"FS#001","stage":"Origin|Pandiculation|Maxspan|Convergence|Conclusion"}]}'
    );
    const byId = Object.fromEntries((res.stages || []).map((s) => [s.id, NSMM.stageName(s.stage)]));
    let prev = NSMM.STAGES[0];
    return main.map((f) => (prev = NSMM.STAGES.includes(byId[f.id]) ? byId[f.id] : prev));
  }

  // Re-score every Footstep in writing order, each against the main thread as
  // it stood before it. A side-path Footstep's intent vector is measured from
  // the direction its path started at.
  function rescoreAll() {
    const prior = [];
    const tf = tfValue();
    journey.footsteps.forEach((f) => {
      const start = f.thread === 'branch' ? pathStart(f) : null;
      const from = start && start !== f ? start.metrics : null;
      f.metrics = NSMM.scoreFootstep(f, prior, { tf, stage: f.stage, rootDirection: from?.direction, rootMagnitude: from?.magnitude });
      if (f.thread === 'branch') f.metrics.branch = NSMM.branchState(f.metrics.iv.length, tf, journey.branchShare);
      if (f.thread === 'main') prior.push(f);
    });
  }

  // ---------- footstep edits ----------

  async function reembed(f) {
    await ensureEmbedder();
    [f.embedding] = await embedTexts([fsText(f)]);
  }

  function removeFootstep(id) {
    journey.footsteps = journey.footsteps.filter((f) => f.id !== id);
    journey.edges = journey.edges.filter((e) => e.from !== id && e.to !== id);
    journey.alerts.filter((x) => x.fsId === id).forEach((x) => (x.open = false));
    if (selectedId === id) selectedId = null;
  }

  // Split a heavy Footstep in two. The first part keeps the id and incoming
  // seeds; the second follows right after it and takes the outgoing seeds.
  async function splitFootstep(id) {
    const f = fsById(id);
    if (!f) return;
    let parts = null;
    if (LLM.hasKey()) {
      setStatus('Splitting ' + id + ' into two Footsteps…');
      const r = await LLM.generateJSON(
        `Split this story Footstep into exactly two smaller, consecutive Footsteps. Keep the writer's own words and facts; do not add events. Rate each one's intensity (impact on the story) from 0 to 1.\nEvent: ${f.event}\nContext: ${f.context}\nSubjects: ${(f.subjects || []).join(', ')}\nPromises: ${(f.promises || []).join('; ')}\nEnvironment: ${(f.environment || []).join('; ')}`,
        '{"footsteps":[{"event":"","subjects":[""],"context":"","promises":[""],"environment":[""],"intensity":0.5},{"event":"","subjects":[""],"context":"","promises":[""],"environment":[""],"intensity":0.5}]}'
      );
      if (Array.isArray(r.footsteps) && r.footsteps.length >= 2) parts = r.footsteps.slice(0, 2);
    }
    if (!parts) {
      const text = f.event;
      const cuts = [/;\s+/, /,\s+(?:and\s+)?then\s+/i, /\.\s+/, /,\s+and\s+/i, /\s+and\s+/i, /,\s+/];
      let a = null;
      let b = null;
      for (const re of cuts) {
        const ms = [...text.matchAll(new RegExp(re.source, 'gi'))];
        if (!ms.length) continue;
        const mid = ms.reduce((best, m) => (Math.abs(m.index - text.length / 2) < Math.abs(best.index - text.length / 2) ? m : best));
        a = text.slice(0, mid.index).trim();
        b = text.slice(mid.index + mid[0].length).trim();
        if (a.split(/\s+/).length >= 3 && b.split(/\s+/).length >= 3) break;
        a = b = null;
      }
      if (!a) return setStatus('Kahyo could not find a natural place to split this one offline. Edit the event text instead.', 'warn');
      const who = (s) => (f.subjects || []).filter((x) => s.toLowerCase().includes(x.toLowerCase().split(/\s+/).pop()));
      parts = [
        { event: a, subjects: who(a).length ? who(a) : f.subjects, context: f.context, promises: [], environment: f.environment },
        { event: b[0].toUpperCase() + b.slice(1), subjects: who(b).length ? who(b) : f.subjects, context: f.context, promises: f.promises, environment: f.environment },
      ];
    }
    const g = {
      ...f,
      id: 'FS#' + String(journey.nextId++).padStart(3, '0'),
      violations: [],
      created_at: Date.now(),
    };
    [f, g].forEach((x, i) => {
      const p = parts[i];
      x.event = String(p.event || x.event);
      x.subjects = (p.subjects || []).filter(Boolean).map(String);
      x.context = String(p.context ?? x.context);
      x.promises = (p.promises || []).filter(Boolean).map(String);
      x.environment = (p.environment || []).filter(Boolean).map(String);
      if (Number.isFinite(Number(p.intensity)) && p.intensity !== undefined) x.intensity = clamp(Number(p.intensity), 0, 1);
      else delete x.intensity;
    });
    journey.footsteps.splice(journey.footsteps.indexOf(f) + 1, 0, g);
    journey.edges.filter((e) => e.from === f.id).forEach((e) => (e.from = g.id));
    if (f.thread === 'main') placeInOrder(g.id, f.id);
    else journey.edges.push({ from: f.id, to: g.id, type: 'temporal' });
    await reembed(f);
    await reembed(g);
    journey.alerts.filter((a) => ['jump', 'heavy', 'split'].includes(a.kind) && a.fsId === f.id).forEach((a) => ((a.open = false), (a.resolution = 'split')));
    // What was left over may still hold more than one event; the writer can split again.
    const left = Math.max(1, (f.events || 2) - 1);
    delete f.events;
    if (left > 1) g.events = left;
    else delete g.events;
    await relabelStages(false);
    syncNotes([g.id]);
    save();
    renderAll({ fit: true });
    selectFootstep(f.id);
    setStatus(`Split into ${f.id} and ${g.id}.`, 'ok');
  }

  async function pickPhysical(c) {
    const hits = recurrence(c).hits;
    const texts = [...new Set(hits.map((f) => f.transcript).filter(Boolean)), ...hits.map((f) => `${f.event}. ${f.context}`)];
    if (!texts.length) return setStatus(`${c.name} is not in any Footstep yet.`, 'warn');
    let found = [];
    if (LLM.hasKey()) {
      setStatus(`Reading the story for how ${c.name} looks…`);
      const r = await LLM.generateJSON(
        `From these story notes, list the physical features of the character "${c.name}" that the writer stated or clearly implied: body, face, age, clothing, voice, marks. Short phrases. Do not invent anything.\n\n${texts.join('\n')}`,
        '{"physical":["short phrase"]}'
      );
      found = r.physical || [];
    } else {
      found = [...new Set(texts.flatMap((t) => offlinePhysical(t, c.name)))];
    }
    const before = c.physical.length;
    found.forEach((p) => addPhysical(c, p));
    save();
    renderCharacters();
    const added = c.physical.length - before;
    setStatus(added ? `Found ${added} physical detail${added > 1 ? 's' : ''} for ${c.name}.` : `No new physical details for ${c.name} in the story so far.`, added ? 'ok' : '');
  }

  // ---------- alert actions ----------

  // Move a main Footstep onto a side path that leaves the Footstep before it.
  function makeBranch(fs) {
    if (fs.thread === 'branch') return;
    const order = storyOrder();
    const i = order.indexOf(fs.id);
    const from = i > 0 ? order[i - 1] : order.find((id) => id !== fs.id);
    fs.thread = 'branch';
    storyOrder();
    if (from && !journey.edges.some((e) => e.to === fs.id && e.type === 'temporal')) journey.edges.push({ from, to: fs.id, type: 'temporal' });
  }

  // Bring a side-path Footstep back into the main story, right after where it branched.
  function makeMain(fs) {
    const root = branchRoot(fs);
    journey.edges = journey.edges.filter((e) => !(e.to === fs.id && e.type === 'temporal'));
    fs.thread = 'main';
    placeInOrder(fs.id, root && storyOrder().includes(root.id) ? root.id : 'END');
  }

  // Remold: rewrite the Footstep minimally so the character stays true to the trait.
  async function remold(a) {
    const fs = fsById(a.fsId);
    const c = character(a.character);
    if (!fs || !c) return;
    if (!LLM.hasKey()) return setStatus('Remolding needs an AI key. Edit the event yourself, or loosen the character.', 'warn');
    setStatus(`Remolding ${fs.id} so ${c.name} stays true to "${a.trait}"…`);
    const r = await LLM.generateJSON(
      `Rewrite this story Footstep as little as possible so that ${c.name} no longer acts against the trait "${a.trait}". Keep the writer's words, other events and every other character as they are.\nFootstep: ${fs.event}${a.suggestion ? `\nHint: ${a.suggestion}` : ''}`,
      '{"event":"the rewritten Footstep"}'
    );
    if (!r.event) throw new Error('The AI did not return a rewrite. Try again.');
    fs.event = String(r.event);
    fs.violations = fs.violations.filter((v) => !(v.character === c.name && v.trait === a.trait));
    await reembed(fs);
    rescoreAll();
    a.open = false;
    a.resolution = 'remold';
    save();
    renderAll();
    selectFootstep(fs.id);
    setStatus(`Remolded ${fs.id}.`, 'ok');
  }

  function resolveAlert(alertId, action) {
    const a = journey.alerts.find((x) => x.id === alertId);
    if (!a) return;
    const fs = fsById(a.fsId);
    if (action === 'split' && fs) return run(() => splitFootstep(fs.id));
    if (action === 'remold') return run(() => remold(a));
    if (action === 'change' && fs) return selectFootstep(fs.id);
    if (action === 'branch' && fs) makeBranch(fs);
    if (action === 'keep' && fs && fs.thread === 'branch') makeMain(fs);
    if (action === 'archive' && fs) fs.thread = 'archived';
    if (action === 'end' && fs) pathStart(fs).ended = fs.id;
    if (action === 'dismiss') journey.driftDismissedAt = journey.footsteps.length;
    if (action === 'relax') {
      const c = character(a.character);
      if (c) c.strictness = Math.max(0, Math.round(((c.strictness ?? 0.6) - 0.3) * 10) / 10);
    }
    if (action === 'remove' && fs) removeFootstep(fs.id);
    a.open = false;
    a.resolution = action;
    const rethread = ['branch', 'keep', 'archive', 'remove'].includes(action);
    (rethread
      ? run(async () => {
          await relabelStages(false);
          syncNotes();
        })
      : Promise.resolve()
    ).then(() => {
      save();
      renderAll();
    });
  }

  function clearNotes() {
    journey.alerts.filter((a) => a.open).forEach((a) => ((a.open = false), (a.resolution = 'cleared')));
    save();
    renderAll();
  }

  // ---------- helper draft ----------

  async function renderDraft() {
    const main = mainInOrder();
    if (!main.length) return setStatus('Add some Footsteps first.', 'warn');
    const branches = journey.footsteps.filter((f) => f.thread === 'branch');
    if (!LLM.hasKey()) {
      const groups = [];
      main.forEach((f, i) => {
        const key = f.stage || 'Story so far';
        if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
        groups[groups.length - 1].items.push(`${i + 1}. **${f.event}**${f.context ? ` (${f.context})` : ''}`);
      });
      journey.draft =
        `# ${journey.title}\n\n_Helper outline from your Footsteps. Add an AI key in Settings for a prose scaffold._\n\n` +
        groups.map((g) => `## ${g.key}\n\n${g.items.join('\n')}`).join('\n\n') +
        (journey.characters.length ? `\n\n## Characters\n\n${journey.characters.map((c) => `- **${c.name}**${c.physical.length ? `: ${c.physical.join(', ')}` : ''}`).join('\n')}` : '') +
        (branches.length ? `\n\n## Side paths you explored\n\n${branches.map((f) => `- ${f.event}`).join('\n')}` : '');
    } else {
      setStatus('Building a helper draft from every Footstep…');
      const people = journey.characters
        .map((c) => `${c.name}${c.aliases?.length ? ` (also called ${c.aliases.join(', ')})` : ''}${c.physical.length ? ` (looks: ${c.physical.join(', ')})` : ''}${c.traits.length ? `; traits: ${c.traits.map((t) => t.text).join(', ')}` : ''}`)
        .join('\n');
      // Grounded on purpose: the draft may only use what the writer said.
      // Anything missing becomes a [question] for the writer, never invented.
      const raw = await LLM.generateText(
        `You help a writer; you never replace them. Turn the story Footsteps below into a helper draft of "${journey.title}".

STRICT RULES:
- Use ONLY the facts in the Footsteps, characters and context below. Do not invent any new character, place, object, event, backstory, motive, dialogue or description.
- If a scene needs a detail the writer has not given, write a short question in brackets for the writer instead, e.g. [What does the king build?]. Never fill it in yourself.
- One short paragraph per Footstep, 1 to 3 sentences, about as long as the Footstep itself. Keep the writer's own wording where you can. Do not pad.
- Start each paragraph with the Footstep number in bold, e.g. **3.** Keep the Footsteps in this order.
- Group the paragraphs under "## <stage>" headings when a stage is given.
- No word counts, no notes about length, no commentary.
- End with "## Open threads": the promises below that later Footsteps do not pay off, one per line. Then "## Side paths": the side-path Footsteps, one per line, if there are any.

Characters:
${people || '(none)'}

Main story, in order:
${main.map((f, i) => `${i + 1}. [${f.stage || 'unstaged'}] ${f.event}${f.context ? ` (${f.context})` : ''}${f.environment?.length ? ` | where: ${f.environment.join('; ')}` : ''}${f.subjects?.length ? ` | who: ${f.subjects.join(', ')}` : ''}${f.promises?.length ? ` | promises: ${f.promises.join('; ')}` : ''}`).join('\n')}

Side paths (branches, not in the main story):
${branches.map((f) => `- ${f.event}`).join('\n') || '(none)'}`,
        { temperature: 0.2 }
      );
      journey.draft = raw.replace(/\s*\(\s*\d+\s*words?\s*\)/gi, '');
    }
    save();
    renderDraftPanel();
    showTab('draft');
    setStatus('Helper draft ready.', 'ok');
  }

  // ---------- home ----------

  function timeAgo(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString();
  }

  function renderHome() {
    const list = listIds().map(readJourney).filter(Boolean).sort((a, b) => b.updated - a.updated);
    const el = $('#journey-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-home"><img src="assets/kahyo-mark-256.png" alt="" /><p>No Journeys yet.</p><p class="muted">Start a new one and speak your first idea, or open the sample story to see how Kahyo maps it.</p></div>`;
      return;
    }
    el.innerHTML = list
      .map((j) => {
        const main = j.footsteps.filter((f) => f.thread === 'main').length;
        const branches = j.footsteps.filter((f) => f.thread === 'branch').length;
        const open = j.alerts.filter((a) => a.open).length;
        const pct = Math.min(100, Math.round((100 * main) / (j.plannedLength || 60)));
        const after = NSMM.stageLabelAfter(j.plannedLength);
        const stage = main >= after && j.stage ? j.stage : `Stages after ${after} Footsteps`;
        return `<article class="jcard">
          <a class="jcard-main" href="#/j/${esc(j.id)}">
            <h3><img src="assets/kahyo-mark-256.png" alt="" />${esc(j.title)}</h3>
            <p class="muted small">${esc(stage)}</p>
            <div class="progress" title="${main} of about ${j.plannedLength} planned Footsteps"><i style="width:${pct}%"></i></div>
            <p class="small">${main} / ~${j.plannedLength} Footsteps · ${branches} side path${branches === 1 ? '' : 's'}${open ? ` · <span class="warn-text">${open} note${open > 1 ? 's' : ''}</span>` : ''}</p>
            <p class="muted small">${esc(j.characters.map((c) => c.name).slice(0, 4).join(', ') || 'No characters yet')}</p>
          </a>
          <div class="jcard-foot"><span class="muted small">Edited ${timeAgo(j.updated)}</span><button class="ghost small" data-del-journey="${esc(j.id)}">Delete</button></div>
        </article>`;
      })
      .join('');
  }

  function showHome() {
    freezeMic();
    journey = null;
    document.body.classList.remove('view-journey');
    document.body.classList.add('view-home');
    $('#home').hidden = false;
    $('#journey-view').hidden = true;
    $('#menu').hidden = true;
    renderBadge();
    renderHome();
    document.title = 'Kahyo · Your Journeys';
  }

  function openJourney(j) {
    journey = j;
    selectedId = null;
    charView = null;
    toggleCharPop(false);
    document.body.classList.remove('view-home');
    document.body.classList.add('view-journey');
    $('#home').hidden = true;
    $('#journey-view').hidden = false;
    renderAll({ fit: true });
    $('#drawer').hidden = true;
    placeDrawer();
    if (!inspecting()) showTab('notes');
    setStatus(journey.footsteps.length ? 'Welcome back to ' + journey.title + '.' : 'Press Speak and tell your story the way you think it.');
  }

  function route() {
    const m = /^#\/j\/(.+)$/.exec(location.hash);
    const j = m && readJourney(decodeURIComponent(m[1]));
    if (j) openJourney(j);
    else showHome();
  }

  function go(id) {
    location.hash = '#/j/' + encodeURIComponent(id);
  }

  async function createSample() {
    const S = window.KAHYO_SAMPLE;
    journey = newJourney(S.title);
    journey.plannedLength = S.plannedLength || 16;
    journey.characters = normalize({ ...journey, characters: JSON.parse(JSON.stringify(S.characters)) }).characters;
    selectedId = null;
    for (const t of S.thoughts) {
      const pre = {
        footsteps: t.footsteps,
        new_traits: [],
        violations: t.footsteps.flatMap((f, i) => (f.violations || []).map((v) => ({ ...v, footstep: 'NEW' + (i + 1) }))),
      };
      await addThought(t.transcript, pre);
    }
    save();
    go(journey.id);
  }

  // ---------- rendering ----------

  function renderBadge() {
    $('#mode-badge').textContent = LLM.hasKey() ? LLM.providerLabel() : 'Offline mode';
    $('#mode-badge').className = 'badge ' + (LLM.hasKey() ? 'on' : 'off');
  }

  function renderAll(opts = {}) {
    if (!journey || $('#journey-view').hidden) return;
    $('#journey-title').value = journey.title;
    document.title = journey.title + ' · Kahyo';
    $('#planned').value = journey.plannedLength;
    renderGraph(opts);
    renderStats();
    renderCharacters();
    renderAlerts();
    renderDetail();
    renderModifier();
    renderDraftPanel();
    renderBadge();
  }

  // On screen an on-course story climbs at 35°, up and to the right; each Footstep's
  // signed direction turns its line from that climb (+ up and back, − flat or down).
  const CLIMB = 35;
  function heading(f) {
    return CLIMB + (f.metrics?.direction ?? 0);
  }

  function segLength(f) {
    return clamp(40 + 5 * (f.metrics?.magnitude ?? 4), 60, 200);
  }

  function step(f, extraDeg = 0) {
    const rad = ((heading(f) + extraDeg) * Math.PI) / 180;
    const L = segLength(f);
    return { dx: L * Math.cos(rad), dy: -L * Math.sin(rad) };
  }

  // Positions: each main Footstep is placed from the one before it by its own
  // vector. Side paths leave the Footstep they grew from by their own vector.
  function layout(visible) {
    const pos = {};
    let x = 0;
    let y = 0;
    storyOrder().forEach((id, i) => {
      const f = fsById(id);
      if (i > 0) {
        const s = step(f);
        x += s.dx;
        y += s.dy;
      }
      pos[id] = { x, y };
    });
    const fan = {};
    visible
      .filter((f) => !pos[f.id])
      .sort((a, b) => a.created_at - b.created_at)
      .forEach((f) => {
        const root = branchRoot(f);
        const base = (root && pos[root.id]) || { x, y };
        const k = (fan[root?.id] = (fan[root?.id] || 0) + 1);
        const s = step(f, f.thread === 'branch' && Math.abs(f.metrics?.direction ?? 0) < 25 ? -35 - 18 * (k - 1) : -18 * (k - 1));
        pos[f.id] = { x: base.x + s.dx, y: base.y + s.dy };
      });
    return pos;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try {
      localStorage.setItem('kahyo.theme', t);
    } catch {}
    if (journey) renderGraph();
  }

  // Labels keep the same on-screen size at any zoom; only the circles and
  // lines grow, so zooming in shows magnitude and data more clearly.
  function labelFont(k) {
    return { color: cssVar('--node-font'), size: 12 * k, strokeWidth: 4 * k, strokeColor: cssVar('--bg2'), face: 'Manrope, system-ui, sans-serif', vadjust: 2 * k };
  }

  function scaleLabels() {
    if (!network || !nodeSet) return;
    const k = 1 / Math.max(0.05, network.getScale());
    const font = labelFont(k);
    nodeSet.update(nodeSet.getIds().map((id) => ({ id, font })));
  }

  function renderGraph(opts = {}) {
    const C = {
      bg: cssVar('--node-bg'),
      border: cssVar('--node-border'),
      font: cssVar('--node-font'),
      order: cssVar('--edge-order'),
      branchBg: cssVar('--branch-bg'),
      breakBg: cssVar('--break-bg'),
      amber: cssVar('--amber'),
      red: cssVar('--red'),
      head: cssVar('--head'),
    };
    const visible = journey.footsteps.filter((f) => f.thread !== 'archived');
    $('#graph-empty').hidden = visible.length > 0;
    const order = storyOrder();
    const num = {};
    order.forEach((id, i) => (num[id] = i + 1));
    const pos = layout(visible);

    const nodes = visible.map((f) => {
      const hasViolation = f.violations?.some((v) => v);
      const branch = f.thread === 'branch';
      const m = f.metrics || {};
      const heavy = m.sizeFlag === 'jump';
      const over = f.thread === 'main' ? m.dirStatus === 'off' : m.branch === 'terminate' && !pathStart(f).ended;
      const wander = f.thread === 'main' && m.dirStatus === 'wander';
      const intensity = NSMM.intensity(f);
      const status = f.thread === 'main' ? { on: 'on course', wander: 'wandering slightly', off: 'off course' }[m.dirStatus] || '' : 'side path';
      return {
        id: f.id,
        x: pos[f.id].x,
        y: pos[f.id].y,
        fixed: true,
        // Short labels keep a long Journey readable: FS#012 shows as 12.
        label: f.id.replace(/^FS#0*/, ''),
        title: `${num[f.id] ? `#${num[f.id]} · ` : 'Side path · '}${f.id}\n${f.event}\n${status}${m.sizeFlag ? ` · ${m.sizeFlag === 'jump' ? 'Jump' : 'Crawl'}` : ''}`,
        size: 8 + 16 * intensity,
        shape: 'dot',
        color: {
          background: branch ? C.branchBg : hasViolation ? C.breakBg : C.bg,
          border: hasViolation ? C.red : over || wander ? LILAC : branch ? C.amber : heavy ? '#FD3A0A' : C.border,
          highlight: { background: C.bg, border: '#FD3A0A' },
          hover: { background: C.bg, border: '#FD3A0A' },
        },
        borderWidth: heavy || over ? 4 : hasViolation || branch || wander ? 3 : 2,
        // Off course (or a side path past terminancy): a thick lilac outline with a glow.
        shadow: { enabled: over, color: LILAC, size: 16, x: 0, y: 0 },
        shapeProperties: { borderDashes: branch ? [6, 4] : heavy ? [3, 3] : false },
        font: labelFont(1),
      };
    });
    const ids = new Set(visible.map((f) => f.id));
    const spine = order.slice(1).map((id, i) => ({ from: order[i], to: id, type: 'temporal', spine: true }));
    const typed = journey.edges.filter((e) => !(e.type === 'temporal' && num[e.from] && num[e.to]));
    const edges = [...spine.map((e, i) => ({ ...e, key: 's' + i })), ...typed.map((e) => ({ ...e, key: 'j' + journey.edges.indexOf(e) }))]
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => {
        const to = fsById(e.to);
        const vecLine = e.spine || (e.type === 'temporal' && to.thread !== 'main');
        const m = to.metrics || {};
        return {
          id: e.key,
          from: e.from,
          to: e.to,
          arrows: { to: { enabled: true, scaleFactor: 0.6 } },
          color: { color: e.type === 'temporal' ? C.order : EDGE_TYPES[e.type]?.color || '#888', opacity: vecLine ? 0.9 : 0.85 },
          dashes: vecLine ? to.thread === 'branch' : LINK_DASHES[e.type] || false,
          title: vecLine
            ? inspecting()
              ? `${e.from} → ${e.to}\nDirection ${deg(m.direction ?? 0)}\nMagnitude ${m.magnitude ?? 0}`
              : `${e.from} → ${e.to}`
            : EDGE_TYPES[e.type]?.label,
          width: vecLine ? 2.5 : e.type === 'cause' ? 2 : 1.7,
          smooth: vecLine ? false : { type: 'curvedCW', roundness: 0.3 },
        };
      });

    // Stage names sit above the first Footstep of each stage.
    stageMarks = [];
    let last = null;
    order.forEach((id) => {
      const f = fsById(id);
      if (f.stage && f.stage !== last) stageMarks.push({ ...pos[id], stage: f.stage, lift: 0 });
      last = f.stage;
    });
    // Stage names that would touch the one before are lifted a row.
    stageMarks.forEach((m, i) => {
      const prev = stageMarks[i - 1];
      if (prev && Math.abs(m.x - prev.x) < 160 && !prev.lift) m.lift = 1;
    });

    if (typeof vis === 'undefined') {
      $('#graph').innerHTML = '<p class="muted pad">Graph library failed to load.</p>';
      return;
    }
    nodeSet = new vis.DataSet(nodes);
    const data = { nodes: nodeSet, edges: new vis.DataSet(edges) };
    if (!network) {
      network = new vis.Network($('#graph'), data, {
        layout: { hierarchical: false, improvedLayout: false },
        physics: false,
        interaction: { hover: true, tooltipDelay: 150, dragNodes: false },
      });
      network.on('click', (p) => {
        if (p.nodes.length) selectFootstep(p.nodes[0]);
        else if (!p.edges.length) closeDrawer();
      });
      network.on('zoom', scaleLabels);
      // Quiet notes: a small dot on each Footstep that has one.
      network.on('afterDrawing', (ctx) => {
        if (!journey) return;
        const k = 1 / Math.max(0.2, network.getScale());
        const kinds = {};
        journey.alerts.filter((a) => a.open && nodeSet?.get(a.fsId)).forEach((a) => (kinds[a.fsId] = kinds[a.fsId] === 'trait' ? 'trait' : a.kind));
        const pos = network.getPositions(Object.keys(kinds));
        ctx.save();
        Object.entries(pos).forEach(([id, p]) => {
          const r = nodeSet.get(id).size || 10;
          ctx.beginPath();
          ctx.arc(p.x + r * 0.8, p.y - r * 0.8, 5 * k, 0, Math.PI * 2);
          ctx.fillStyle = kinds[id] === 'trait' ? cssVar('--red') : cssVar('--amber');
          ctx.fill();
          ctx.lineWidth = 2 * k;
          ctx.strokeStyle = cssVar('--card');
          ctx.stroke();
        });
        ctx.restore();
      });
      network.on('selectEdge', (p) => {
        if (!p.nodes.length && p.edges.length) showEdgeTool(p.edges[0]);
      });
      network.on('deselectEdge', () => showEdgeTool(null));
      network.on('beforeDrawing', (ctx) => {
        ctx.save();
        // Keep stage names readable at any zoom.
        const k = 1 / Math.max(0.2, network.getScale());
        ctx.font = `600 ${11 * k}px Manrope, system-ui, sans-serif`;
        ctx.lineWidth = k;
        const head = cssVar('--head');
        const bg = cssVar('--bg2');
        ctx.textAlign = 'right';
        stageMarks.forEach((s) => {
          const up = (52 + 18 * s.lift) * k;
          ctx.strokeStyle = 'rgba(253, 58, 10, 0.35)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - 26);
          ctx.lineTo(s.x, s.y - 26 - up);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 4 * k;
          ctx.strokeStyle = bg;
          ctx.strokeText(s.stage, s.x - 6 * k, s.y - 26 - up + 8 * k);
          ctx.fillStyle = head;
          ctx.fillText(s.stage, s.x - 6 * k, s.y - 26 - up + 8 * k);
          ctx.lineWidth = k;
        });
        ctx.restore();
      });
      network.once('afterDrawing', () => {
        network.fit({ animation: false });
        scaleLabels();
      });
    } else {
      const view = !opts.fit && { position: network.getViewPosition(), scale: network.getScale() };
      network.setData(data);
      if (view) network.moveTo({ ...view, animation: false });
      else network.fit({ animation: false });
      scaleLabels();
    }
    renderPlaceOptions();
    if (selectedId && ids.has(selectedId)) network.selectNodes([selectedId]);
  }

  // Clicking a link in the graph offers to delete it. Story-order lines are
  // not links: they follow the order and change with Earlier/Later.
  function showEdgeTool(key) {
    const el = $('#edge-tool');
    const e = key && key[0] === 'j' ? journey.edges[Number(key.slice(1))] : null;
    if (!key) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = e
      ? `<span>${esc(e.from)} → ${esc(e.to)} · ${EDGE_TYPES[e.type]?.label}</span><button class="small primary" data-edge-del="${key.slice(1)}">Delete link</button>`
      : `<span class="muted">Story order line. Move Footsteps with Earlier and Later to change it.</span>`;
  }

  function deleteEdge(index) {
    journey.edges.splice(index, 1);
    showEdgeTool(null);
    save();
    renderGraph();
    renderDetail();
    setStatus('Link deleted.', 'ok');
  }

  function renderPlaceOptions() {
    const sel = $('#place');
    const keep = sel.value || 'AUTO';
    const order = mainInOrder();
    // Side-path tips: the last Footstep on each side path that has not ended.
    const tips = journey.footsteps.filter(
      (f) => f.thread === 'branch' && !pathStart(f).ended && !journey.edges.some((e) => e.from === f.id && e.type === 'temporal' && fsById(e.to)?.thread === 'branch')
    );
    sel.innerHTML =
      `<option value="AUTO">${LLM.hasKey() ? 'Let Kahyo decide' : 'At the end'}</option><option value="START">At the very start</option>` +
      order.map((f, i) => `<option value="${esc(f.id)}">After ${i + 1}. ${esc(shortText(f.event, 40))}</option>`).join('') +
      tips.map((f) => `<option value="${esc(f.id)}">Continue side path after ${esc(f.id)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'AUTO';
  }

  // Storyline (Inspect): the factors, the planned length and the story's stats.
  function renderStats() {
    const main = journey.footsteps.filter((f) => f.thread === 'main');
    const branches = journey.footsteps.filter((f) => f.thread === 'branch');
    const open = journey.alerts.filter((a) => a.open).length;
    const st = NSMM.threadStats(main);
    const count = (fn) => main.filter((f) => f.metrics && fn(f.metrics)).length;
    const off = count((m) => m.dirStatus === 'off');
    const wander = count((m) => m.dirStatus === 'wander');
    const jumps = count((m) => m.sizeFlag === 'jump');
    const crawls = count((m) => m.sizeFlag === 'crawl');
    const tf = tfValue();
    const after = NSMM.stageLabelAfter(journey.plannedLength);
    const stat = (v, word, cls = '') => `<div class="${cls}"><span>${v}</span>${word}</div>`;
    $('#stats').innerHTML =
      stat(main.length, 'on the main thread') +
      stat(branches.length, 'side paths') +
      stat(open, 'open notes', open ? 'warn' : '') +
      stat(off, 'off course', off ? 'warn' : '') +
      stat(wander, 'wandering') +
      stat(`${jumps} / ${crawls}`, 'jumps / crawls') +
      stat(st ? st.magnitude.toFixed(1) : '–', 'average magnitude') +
      stat(st ? st.intensity.toFixed(2) : '–', 'average intensity') +
      stat(`${NSMM.directionLimit(tf, journey.stage).toFixed(0)}°`, `direction limit${journey.stage ? ' in ' + journey.stage : ''}`);
    $('#tf').value = tf;
    $('#tf-val').textContent = tf.toFixed(2);
    $('#tf-note').textContent = Number.isFinite(journey.tf)
      ? `Set by you. Automatic for ${journey.plannedLength} planned Footsteps would be ${NSMM.autoTerminancy(journey.plannedLength).toFixed(2)}.`
      : `Automatic from ${journey.plannedLength} planned Footsteps: longer stories are more lenient. Drag to override.`;
    if (Number.isFinite(journey.tf) && !$('#tf-auto')) $('#tf-note').insertAdjacentHTML('beforeend', ' <a href="#" id="tf-auto">Back to automatic</a>');
    $('#branch-share').value = journey.branchShare;
    $('#branch-share-val').textContent = Math.round(journey.branchShare * 100) + '%';
    const h = storyHealth();
    const hb = $('#health');
    hb.className = 'health ' + h.level;
    hb.innerHTML = `<i></i>${h.label}`;
    hb.title = h.why + ' Click for more.';
    $('#health-why').innerHTML = `<strong>${h.label}.</strong> ${esc(h.why)}`;
    const n = main.length;
    if (n < after) {
      $('#rail').innerHTML =
        NSMM.STAGES.map((s) => `<li class="pending">${s}</li>`).join('') + `<li class="rail-note">Stages are labelled after ${after} Footsteps · ${n}/${after}</li>`;
    } else {
      const counts = {};
      mainInOrder().forEach((f) => (counts[f.stage] = (counts[f.stage] || 0) + 1));
      const now = NSMM.STAGES.indexOf(journey.stage);
      $('#rail').innerHTML = NSMM.STAGES.map((s, i) => `<li class="${i < now ? 'done' : i === now ? 'now' : ''}">${s}${counts[s] ? ` · ${counts[s]}` : ''}</li>`).join('');
    }
    $('#alert-count').textContent = open ? String(open) : '';
    $('#alert-count').className = open ? 'count' : '';
  }

  // Left pane, bottom half: every character, or one character's profile.
  function renderCharacters() {
    const el = $('#characters');
    const c = charView && character(charView);
    if (c) {
      const r = recurrence(c);
      el.innerHTML = `
        <div class="pop-head"><button class="back ghost small" data-char-back>← All characters</button><button class="x" data-char-close aria-label="Close">×</button></div>
        <div class="char-head">${avatar(c.name)}<h3>${esc(c.name)}</h3><button class="ghost small" data-char-del>Remove</button></div>
        <div class="recur"><div class="bar"><i style="width:${r.pct}%"></i></div><span class="small">Appears in ${r.hits.length} of ${r.total} Footsteps · <strong>${r.pct}%</strong> recurring</span></div>
        <h4>Physical features</h4>
        <div class="chips">${c.physical.map((p, i) => `<span class="chip">${esc(p)}<button data-phys-del="${i}" aria-label="Remove ${esc(p)}">×</button></span>`).join('') || '<span class="muted small">None yet.</span>'}</div>
        <form class="add-physical"><input placeholder="Add a feature, e.g. big, fat king" aria-label="New physical feature" /></form>
        <button class="small" data-char-pick>Pick from the story</button>
        ${c.aliases?.length ? `<p class="small muted">Also called ${c.aliases.map(esc).join(', ')}</p>` : ''}
        <h4>Traits</h4>
        <div class="chips">${c.traits.map((t, ti) => `<span class="chip">${esc(t.text)}<button data-trait-del="${ti}" aria-label="Remove ${esc(t.text)}">×</button></span>`).join('') || '<span class="muted small">None yet.</span>'}</div>
        <form class="add-trait"><input placeholder="Add a trait, e.g. jealous" aria-label="New trait" /></form>
        <div class="field strict">
          <span>Strictness<small class="mword">how firmly the traits hold</small></span>
          <div class="slider-row"><input class="strictness" type="range" min="0" max="1" step="0.1" value="${c.strictness ?? 0.6}" aria-label="Strictness" /><b class="strict-val">${(c.strictness ?? 0.6).toFixed(1)}</b></div>
          <p class="muted small">Higher means ${esc(c.name)} is less likely to change. When they act against a trait, Kahyo notes it and can remold the Footstep to fit.</p>
        </div>
        ${
          journey.characters.length > 1
            ? `<form class="merge-char"><label class="small">Same person as <select aria-label="Merge into">${journey.characters
                .filter((x) => x !== c)
                .map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`)
                .join('')}</select></label><button class="small">Merge</button></form>`
            : ''
        }
        <h4>In these Footsteps</h4>
        <ul class="appear">${r.hits.map((f) => `<li><a href="#" data-goto="${esc(f.id)}">${esc(f.id)}</a> ${esc(shortText(f.event, 60))}</li>`).join('') || '<li class="muted">None yet.</li>'}</ul>`;
      return;
    }
    charView = null;
    const people = journey.characters.map((x) => ({ c: x, r: recurrence(x) })).sort((a, b) => b.r.hits.length - a.r.hits.length);
    const grid = people
      .map(
        ({ c: x, r }) => `<button class="person" data-char-open="${esc(x.name)}" title="${esc(x.physical.join(', ') || x.name)}">
          ${avatar(x.name)}
          <span class="person-name">${esc(x.name)}</span>
          <span class="person-pct">${r.pct}%</span>
        </button>`
      )
      .join('');
    el.innerHTML = `
      <div class="pop-head"><h2>Characters</h2><button class="x" data-char-close aria-label="Close">×</button></div>
      ${grid ? `<div class="people-grid">${grid}</div>` : '<p class="muted small">Characters appear here as you speak. Click one to see their traits, how often they recur and how they look.</p>'}
      <form class="add-char"><input placeholder="Add a character" aria-label="New character name" /></form>`;
    renderCharBar();
  }

  // A round user icon, tinted per character.
  function avatar(name, cls = '') {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="avatar ${cls}" style="--hue:${h}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z"/></svg></span>`;
  }

  function renderCharBar() {
    const people = journey.characters;
    $('#char-count').textContent = people.length ? `(${people.length})` : '';
    $('#char-faces').innerHTML = people.slice(0, 5).map((c) => avatar(c.name, 'face')).join('');
  }

  function toggleCharPop(open) {
    const pop = $('#char-pop');
    open = open ?? pop.hidden;
    pop.hidden = !open;
    $('#char-toggle').setAttribute('aria-expanded', String(open));
    $('#char-toggle').classList.toggle('open', open);
  }

  const NOTE_TITLES = {
    off: 'Off course',
    split: 'May be two Footsteps',
    wander: 'Wandering slightly',
    jump: 'Jump',
    crawl: 'Crawl',
    drifting: 'Side path drifting',
    terminate: 'Side path at its limit',
    drift: 'The story is drifting',
    terminancy: 'Moved to a side path',
    contradiction: 'Points against the story',
    heavy: 'Holds a lot',
  };

  function noteActions(a) {
    const b = (act, label) => `<button data-a="${a.id}" data-act="${act}">${label}</button>`;
    const fs = fsById(a.fsId);
    switch (a.kind) {
      case 'off':
        return fs?.thread === 'main' ? b('branch', 'Branch it') + b('accept', 'Keep on the main story') : b('accept', 'Clear');
      case 'jump':
      case 'split':
        return b('split', 'Split in two') + b('accept', 'Keep as one');
      case 'terminate':
        return b('end', 'Let it end here') + b('change', 'Change its steps') + b('accept', 'Keep going');
      case 'trait':
        return b('remold', 'Remold to fit') + b('accept', "It's intentional") + b('relax', 'Loosen the character');
      case 'drift':
        return b('dismiss', "It's on purpose");
      case 'heavy':
        return b('split', 'Split in two') + b('accept', 'Keep as one');
      case 'terminancy':
        return fs?.thread === 'branch' ? b('keep', 'Bring into main story') + b('accept', 'Clear') : b('accept', 'Clear');
      default:
        return b('accept', 'Clear');
    }
  }

  function noteHtml(a) {
    const title = a.kind === 'trait' ? 'Out of character' : NOTE_TITLES[a.kind] || 'Note';
    const maths = a.kind === 'trait' ? `trait break · ${a.severity}` : a.maths || '';
    return `<div class="alert note ${a.kind} ${a.severity || ''}">
      <div class="alert-title"><i class="ndot"></i>${title}${maths ? `<small class="mword">${esc(maths)}</small>` : ''}</div>
      <p>${esc(a.text)} <a href="#" data-goto="${esc(a.fsId)}">View</a></p>
      ${a.suggestion ? `<p class="suggest">${esc(a.suggestion)}</p>` : ''}
      <div class="actions">${noteActions(a)}</div>
    </div>`;
  }

  // Notes stay until the writer clears them, one by one or all at once.
  function renderAlerts() {
    const el = $('#alerts');
    const list = journey.alerts.filter((a) => a.open);
    $('#clear-notes').hidden = list.length < 2;
    if (!list.length) {
      el.innerHTML = '<p class="muted">No notes right now. When a Footstep wanders off course, jumps or crawls, a character acts out of character, or a side path goes too far, Kahyo leaves a quiet note here. Notes stay until you clear them.</p>';
      return;
    }
    el.innerHTML = list.map(noteHtml).join('');
  }

  // The Footstep in a writer's words.
  function pullWords(f) {
    const m = f.metrics || {};
    if (f.thread === 'branch') {
      const st = { ok: 'It stays close to where its side path began.', drifting: 'Its side path is drifting further away.', terminate: 'Its side path has gone so far it will be hard to bring back.' };
      return st[m.branch] || 'A side path.';
    }
    if (!m.limit || f.thread !== 'main') return '';
    const size = m.sizeFlag === 'jump' ? 'A Jump: a lot happens at once' : m.sizeFlag === 'crawl' ? 'A Crawl: little happens' : 'A usual-sized step';
    const dir = m.dirStatus === 'off' ? 'that goes off course' : m.dirStatus === 'wander' ? 'that wanders slightly' : 'on course';
    return `${size}, ${dir}.`;
  }

  // The selected Footstep's packet, editable, shown in the drawer.
  function renderDetail() {
    const el = $('#detail');
    const f = selectedId && fsById(selectedId);
    if (!f) {
      el.innerHTML = '<p class="muted">Click a Footstep on the map.</p>';
      return;
    }
    const pos = storyOrder().indexOf(f.id);
    const links = journey.edges.map((e, i) => ({ ...e, i })).filter((e) => (e.to === f.id || e.from === f.id) && e.type !== 'temporal');
    const others = journey.footsteps.filter((x) => x.id !== f.id && x.thread !== 'archived');
    const linkLabel = (e) => {
      const t = EDGE_TYPES[e.type] || EDGE_TYPES.casual;
      if (e.type === 'cause') return e.from === f.id ? `Causes → ${esc(e.to)}` : `${t.back} ← ${esc(e.from)}`;
      return `${t.label} · ${esc(e.from === f.id ? e.to : e.from)}`;
    };
    const notes = journey.alerts.filter((a) => a.open && a.fsId === f.id);
    el.innerHTML = `
      <div class="fs-head"><strong>${pos >= 0 ? `#${pos + 1} · ` : ''}${esc(f.id)}</strong><span class="pill ${f.thread}">${f.thread === 'branch' ? 'side path' : f.thread}</span><span class="pill">${esc(f.stage || 'unstaged')}</span></div>
      <label class="field"><span>What happens<small class="mword">event · your words</small></span><textarea data-edit="event" rows="3">${esc(f.event)}</textarea></label>
      <label class="field"><span>Who<small class="mword">characters</small></span><input data-edit="subjects" value="${esc((f.subjects || []).join(', '))}" placeholder="Comma separated" /></label>
      <label class="field"><span>Where<small class="mword">environment</small></span><input data-edit="environment" value="${esc((f.environment || []).join(', '))}" placeholder="The place or space where it happens" /></label>
      <label class="field"><span>When and how<small class="mword">context</small></span><input data-edit="context" value="${esc(f.context || '')}" placeholder="Time, circumstances" /></label>
      <details class="more"><summary>Setups to pay off later</summary>
        <label class="field"><span>One per line<small class="mword">promises</small></span><textarea data-edit="promises" rows="2">${esc((f.promises || []).join('\n'))}</textarea></label>
      </details>
      ${pullWords(f) ? `<p class="iv-words">${pullWords(f)}</p>` : ''}
      ${notes.length ? `<div class="fs-notes inspect-only">${notes.map(noteHtml).join('')}</div>` : ''}
      <div class="field"><span>Links to other Footsteps<small class="mword">setups and links</small></span>
        <ul class="seeds">${
          links
            .map((e) => `<li><span class="dot" style="background:${EDGE_TYPES[e.type]?.color}"></span>${linkLabel(e)}<button class="ghost small" data-seed-del="${e.i}" aria-label="Delete this link">Delete</button></li>`)
            .join('') || '<li class="muted">No links yet.</li>'
        }</ul>
        ${links.length > 1 ? '<button class="ghost small" data-seeds-clear>Delete all links</button>' : ''}
        <form class="add-seed">
          <select name="type" aria-label="Link type">
            <option value="cause-out">Causes</option>
            <option value="cause-in">Is a consequence of</option>
            <option value="casual">Casual link to</option>
            <option value="character_arc">Character arc with</option>
          </select>
          <select name="other" aria-label="Other Footstep">${others.map((x) => `<option value="${esc(x.id)}">${esc(x.id)} ${esc(shortText(x.event, 28))}</option>`).join('')}</select>
          <button>Link</button>
        </form>
      </div>
      ${(f.violations || []).map((v) => `<div class="alert note trait ${v.severity}"><div class="alert-title"><i class="ndot"></i>Out of character<small class="mword">trait break · ${v.severity}</small></div><p>${esc(v.character)}: “${esc(v.trait)}”</p>${v.suggestion ? `<p class="suggest">${esc(v.suggestion)}</p>` : ''}</div>`).join('')}
      <details><summary>What you said</summary><p class="quote">${esc(f.transcript || '')}</p></details>`;
  }

  // Right pane, bottom half: move the Footstep, its intensity, and (Inspect) its numbers.
  function renderModifier() {
    const el = $('#modifier');
    const f = selectedId && fsById(selectedId);
    if (!f) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="actions">
        ${f.thread === 'main' ? `<button data-place-after="${esc(f.id)}">Add next idea after this</button><button data-shift="-1" aria-label="Move earlier in the story">↑ Earlier</button><button data-shift="1" aria-label="Move later in the story">↓ Later</button>` : ''}
        ${f.thread === 'branch' ? `<button data-place-after="${esc(f.id)}">Continue this side path</button>` : ''}
        ${f.thread !== 'main' ? `<button data-move="main">Bring into main story</button>` : `<button data-move="branch">Make it a side path</button>`}
        <button data-split class="${f.metrics?.sizeFlag === 'jump' ? 'primary' : ''}">Split in two</button>
        <button data-move="archived">Set aside</button>
        <button data-delete class="ghost">Delete</button>
      </div>
      <div class="iv">
        <div class="iv-title">Intensity<small class="mword">0 to 1 · circle size</small></div>
        <div class="slider-row"><input type="range" min="0" max="1" step="0.05" data-intensity value="${NSMM.intensity(f)}" aria-label="Intensity" /><b id="v-int"></b></div>
        <p class="muted small" id="int-note"></p>
        <div id="iv-readout" class="inspect-only"></div>
      </div>`;
    updateReadouts(f);
  }

  function updateReadouts(f) {
    const m = f.metrics || {};
    const ai = Number.isFinite(f.intensity);
    $('#v-int').textContent = NSMM.intensity(f).toFixed(2);
    $('#int-note').textContent = ai ? (f.intensityByWriter ? 'Set by you.' : 'Judged by the AI. Drag to change it.') : 'Estimated offline from how much happens. Drag to set it.';
    $('[data-split]')?.classList.toggle('primary', m.sizeFlag === 'jump');
    const box = $('#iv-readout');
    if (!box) return;
    const row = (k, v, warn) => `<dt>${k}</dt><dd class="${warn ? 'warn' : ''}">${v}</dd>`;
    const judged = Number.isFinite(m.limit) && storyOrder().length >= 3;
    const status = { on: 'on course', wander: 'wandering slightly', off: 'off course' }[m.dirStatus] || '–';
    let html = `<div class="iv-wrap">${gauge(m.direction ?? 0, m.limit ?? 180)}<dl class="readout">
      ${row('Magnitude', `${m.magnitude ?? 0} <small class="muted">usual ${(m.avgMagnitude ?? 0).toFixed(0)}</small>`, Boolean(m.sizeFlag))}
      ${row('Size', m.sizeFlag === 'jump' ? 'Jump' : m.sizeFlag === 'crawl' ? 'Crawl' : 'usual', Boolean(m.sizeFlag))}
      ${row('Direction', judged ? deg(m.direction ?? 0) : 'from the 4th Footstep')}
      ${row('Limit', judged ? `${(m.limit ?? 0).toFixed(0)}°` : '–')}
      ${f.thread === 'main' ? row('Status', status, m.dirStatus !== 'on') : ''}
    </dl></div>`;
    if (f.thread === 'branch' && m.iv) {
      const tf = tfValue();
      const iv = m.iv;
      html += `<div class="iv-title">Intent vector<small class="mword">aî + bĵ · from where this side path began</small></div>
      <dl class="readout">
        ${row('Vector', `${iv.magnitude.toFixed(2)}î ${iv.direction >= 0 ? '+' : '−'} ${Math.abs(iv.direction).toFixed(2)}ĵ`)}
        ${row('Branching factor', iv.length.toFixed(2), m.branch !== 'ok')}
        ${row('Drifting from', (journey.branchShare * tf).toFixed(2))}
        ${row('Terminancy', tf.toFixed(2))}
        ${row('State', { ok: 'close to its start', drifting: 'drifting', terminate: 'at its limit' }[m.branch] || '–', m.branch !== 'ok')}
      </dl>`;
    } else {
      html += `<p class="muted small">The intent vector shows on side-path Footsteps only. This one is on the main thread.</p>`;
    }
    box.innerHTML = html;
    const words = $('.iv-words');
    if (words) words.textContent = pullWords(f);
  }

  // Dial for the signed direction: 0° points right, + turns anticlockwise, − clockwise.
  // The shaded wedge is the on-course zone (±X/2), the lines mark the off-course limit (±X).
  function gauge(direction, limit) {
    const R = 44;
    const cx = 60;
    const cy = 60;
    const pt = (d, r = R) => [cx + r * Math.cos((d * Math.PI) / 180), cy - r * Math.sin((d * Math.PI) / 180)];
    const arc = (a, b, r) => {
      const [x1, y1] = pt(a, r);
      const [x2, y2] = pt(b, r);
      return `M${cx} ${cy}L${x1.toFixed(1)} ${y1.toFixed(1)}A${r} ${r} 0 ${Math.abs(b - a) > 180 ? 1 : 0} 0 ${x2.toFixed(1)} ${y2.toFixed(1)}Z`;
    };
    const lim = Math.min(180, limit);
    const half = lim / 2;
    const d = clamp(direction, -180, 180);
    const color = Math.abs(d) > lim ? 'var(--red)' : Math.abs(d) > half ? 'var(--amber)' : 'var(--green)';
    const [lx1, ly1] = pt(lim);
    const [lx2, ly2] = pt(-lim);
    const [nx, ny] = pt(d, R - 4);
    return `<svg viewBox="0 0 120 120" class="gauge" role="img" aria-label="Direction ${d.toFixed(0)} degrees, limit ${lim.toFixed(0)}">
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--border2-solid)" stroke-width="2"/>
      <path d="${arc(-lim, lim, R)}" fill="color-mix(in srgb, var(--amber) 14%, transparent)"/>
      <path d="${arc(-half, half, R)}" fill="color-mix(in srgb, var(--green) 22%, transparent)"/>
      <line x1="${cx}" y1="${cy}" x2="${lx1.toFixed(1)}" y2="${ly1.toFixed(1)}" stroke="var(--amber)" stroke-width="1" stroke-dasharray="3 3"/>
      <line x1="${cx}" y1="${cy}" x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" stroke="var(--amber)" stroke-width="1" stroke-dasharray="3 3"/>
      <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>
      <text x="${cx + R + 3}" y="${cy + 4}" class="g-l">0°</text>
      <text x="${cx}" y="${cy + R + 14}" text-anchor="middle" class="g-v">${deg(d)}</text>
    </svg>`;
  }

  function renderDraftPanel() {
    const el = $('#draft');
    if (!journey.draft) {
      el.innerHTML = '<p class="muted">Press <strong>Build helper draft</strong> to connect your Footsteps into a scene-by-scene scaffold. Brackets mark the choices that are yours to make.</p>';
      return;
    }
    el.innerHTML = `<div class="actions"><button id="copy-draft">Copy</button><button id="dl-draft">Download .md</button></div><div class="prose">${mdToHtml(journey.draft)}</div>`;
  }

  // Tiny Markdown renderer for the draft (headings, bold, italics, lists, rules).
  function mdToHtml(md) {
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/_(.+?)_/g, '<em>$1</em>');
    return md
      .split(/\n{2,}/)
      .map((block) => {
        const b = block.trim();
        if (!b) return '';
        if (/^#{1,6}\s/.test(b)) {
          const lvl = Math.min(4, b.match(/^#+/)[0].length + 1);
          return `<h${lvl}>${inline(b.replace(/^#+\s*/, ''))}</h${lvl}>`;
        }
        if (/^(\*\s*\*\s*\*|-{3,}|\*{3,})$/.test(b)) return '<hr>';
        if (/^(\d+\.|[-*])\s/.test(b)) {
          const ordered = /^\d+\./.test(b);
          const items = b.split(/\n/).map((l) => `<li>${inline(l.replace(/^(\d+\.|[-*])\s*/, ''))}</li>`).join('');
          return ordered ? `<ol start="${parseInt(b, 10) || 1}">${items}</ol>` : `<ul>${items}</ul>`;
        }
        return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
      })
      .join('');
  }

  // Write keeps the map calm: a click only highlights the Footstep. Inspect opens its pane.
  function selectFootstep(id) {
    selectedId = id;
    renderDetail();
    renderModifier();
    if (network && fsById(id)?.thread !== 'archived') {
      network.selectNodes([id]);
      if (!inspecting()) network.focus(id, { scale: network.getScale(), animation: { duration: 300 } });
    }
    if (inspecting()) {
      $('#drawer').hidden = false;
      showTab('footstep');
    }
  }

  function closeDrawer() {
    selectedId = null;
    network?.unselectAll();
    if (inspecting()) {
      renderDetail();
      renderModifier();
    } else $('#drawer').hidden = true;
  }

  // Inspect docks the Footstep's pane in the right column as its first tab, next
  // to Storyline; Write floats it as a drawer over the map, next to Notes and Draft.
  function placeDrawer() {
    const d = $('#drawer');
    const active = $('.tab.active')?.dataset.tab;
    if (inspecting()) {
      $('#panel-footstep').appendChild(d);
      d.classList.add('docked');
      d.hidden = false;
      if (active !== 'storyline') showTab('footstep');
    } else {
      $('.layout').appendChild(d);
      d.classList.remove('docked');
      d.hidden = true;
      if (active !== 'draft') showTab('notes');
    }
  }

  function setPane(open) {
    document.body.classList.toggle('pane-closed', !open);
    try {
      localStorage.setItem('kahyo.pane', open ? 'open' : 'closed');
    } catch {}
    if (network)
      setTimeout(() => {
        network.fit({ animation: false });
        scaleLabels();
      }, 0);
  }

  function inspecting() {
    return document.body.classList.contains('mode-inspect');
  }

  // Write: calm, for writing. Inspect: numbers, sliders and the factors.
  function setMode(mode) {
    document.body.classList.toggle('mode-inspect', mode === 'inspect');
    document.body.classList.toggle('mode-write', mode !== 'inspect');
    document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    try {
      localStorage.setItem('kahyo.mode', mode);
    } catch {}
    placeDrawer();
    if (journey && network) renderGraph();
  }

  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== 'panel-' + name));
  }

  // ---------- speech ----------

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognizer = null;
  let listening = false;
  let baseText = '';
  let heardFrozen = false; // set once the writer edits or adds, so late mic results never overwrite their text

  function toggleMic() {
    if (!SR) {
      setStatus('Voice input needs Chrome or Edge. You can type your idea instead.', 'warn');
      $('#transcript').focus();
      return;
    }
    if (listening) {
      recognizer.stop();
      return;
    }
    recognizer = new SR();
    recognizer.lang = $('#lang').value;
    recognizer.continuous = true;
    recognizer.interimResults = true;
    baseText = $('#transcript').value ? $('#transcript').value.trim() + ' ' : '';
    heardFrozen = false;
    // Chrome on Android repeats the phrase so far in every result ("this", "this is",
    // "this is a"), so a result that extends the one before replaces it instead of adding to it.
    recognizer.onresult = (e) => {
      if (heardFrozen) return;
      const parts = [];
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (!t) continue;
        const last = parts[parts.length - 1];
        const a = last?.toLowerCase();
        const b = t.toLowerCase();
        if (last && b.startsWith(a)) parts[parts.length - 1] = t;
        else if (last && a.startsWith(b)) continue;
        else parts.push(t);
      }
      $('#transcript').value = baseText + parts.join(' ');
    };
    recognizer.onerror = (e) => setStatus('Mic error: ' + e.error + (e.error === 'not-allowed' ? '. Allow microphone access in your browser.' : ''), 'warn');
    recognizer.onend = () => {
      listening = false;
      $('#mic').classList.remove('live');
      $('#mic-label').textContent = 'Speak';
      if (heardFrozen) return;
      if ($('#transcript').value.trim()) setStatus('Got it. Fix any words if needed, then press Add to Journey.');
    };
    recognizer.start();
    listening = true;
    $('#mic').classList.add('live');
    $('#mic-label').textContent = 'Listening… tap to stop';
    setStatus('Listening. Speak your story the way you think it.');
  }

  // Stop the mic and ignore anything it still sends, so typed text is never replaced.
  function freezeMic(message) {
    if (!listening) return;
    heardFrozen = true;
    recognizer.stop();
    if (message) setStatus(message);
  }

  // ---------- events ----------

  // Loader: draws the logo's strokes one after another like a pen, holds the
  // finished mark for a moment, then starts again while Kahyo is working.
  let scribbleFrame = null;
  function scribble(on) {
    cancelAnimationFrame(scribbleFrame);
    const paths = [...document.querySelectorAll('.scribble path')];
    if (!on || !paths.length) return;
    const lens = paths.map((p) => p.getTotalLength());
    const total = lens.reduce((a, b) => a + b, 0);
    paths.forEach((p, i) => (p.style.strokeDasharray = lens[i] + ' ' + lens[i]));
    const DRAW = 2200;
    const HOLD = 600;
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) % (DRAW + HOLD);
      let ink = (Math.min(t, DRAW) / DRAW) * total;
      const svg = paths[0].ownerSVGElement;
      svg.style.opacity = t > DRAW + HOLD * 0.6 ? String(1 - (t - DRAW - HOLD * 0.6) / (HOLD * 0.4)) : '1';
      paths.forEach((p, i) => {
        const drawn = Math.max(0, Math.min(lens[i], ink));
        ink -= lens[i];
        p.style.strokeDashoffset = String(lens[i] - drawn);
      });
      scribbleFrame = requestAnimationFrame(tick);
    };
    scribbleFrame = requestAnimationFrame(tick);
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    document.body.classList.add('busy');
    scribble(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      // The status line lives in the Journey view; on the home page, say it out loud.
      if (document.body.classList.contains('view-home')) alert(e.message || String(e));
      else setStatus(e.message || String(e), 'err');
    } finally {
      busy = false;
      document.body.classList.remove('busy');
      scribble(false);
    }
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function slug() {
    return (journey.title || 'journey').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'journey';
  }

  function deleteFootstep(f) {
    if (!confirm(`Delete ${f.id}? This cannot be undone.`)) return;
    removeFootstep(f.id);
    run(async () => {
      await relabelStages(false);
      save();
      renderAll();
      setStatus(`Deleted ${f.id}.`, 'ok');
    });
  }

  // Apply an edit to one of the Footstep's text parameters, then re-score.
  function editFootstep(f, field, value) {
    const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
    if (field === 'event' && value.trim()) {
      f.event = value.trim();
      f.transcript = f.event; // the correction replaces what the mic heard everywhere
    }
    if (field === 'context') f.context = value.trim();
    if (field === 'subjects') {
      f.subjects = value.split(',').map((s) => s.trim()).filter(Boolean);
      f.subjects.forEach(ensureCharacter);
    }
    if (field === 'promises') f.promises = lines(value);
    if (field === 'environment') f.environment = value.split(',').map((s) => s.trim()).filter(Boolean);
    // Not behind the busy lock: a blur from clicking another button fires this
    // change, and that button's own action must still run.
    return (async () => {
      if (['event', 'context', 'subjects'].includes(field)) await reembed(f);
      rescoreAll();
      syncNotes([f.id]);
      save();
      renderGraph();
      renderStats();
      renderCharacters();
      renderAlerts();
      updateReadouts(f);
      renderPlaceOptions();
      setStatus(`Updated ${f.id}.`, 'ok');
    })().catch((e) => setStatus(e.message || String(e), 'err'));
  }

  function bind() {
    window.addEventListener('hashchange', route);
    $('#mic').addEventListener('click', toggleMic);
    $('#add').addEventListener('click', () =>
      run(async () => {
        freezeMic();
        const text = $('#transcript').value;
        if (!text.trim()) return setStatus('Speak or type a story idea first.', 'warn');
        setStatus(LLM.hasKey() ? 'Understanding where this goes in your story…' : 'Structuring (offline mode)…');
        await addThought(text, null, $('#place').value);
        $('#transcript').value = '';
        $('#place').value = 'AUTO';
      })
    );
    // Typing while the mic is on pauses it, so a correction stays put.
    $('#transcript').addEventListener('input', (e) => {
      if (e.isTrusted) freezeMic('Mic paused so your edit stays. Tap Speak to go on.');
    });
    $('#transcript').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#add').click();
    });
    $('#render').addEventListener('click', () => run(renderDraft));
    $('#fit').addEventListener('click', () => {
      if (!network) return;
      network.fit({ animation: false });
      scaleLabels();
    });
    $('#journey-title').addEventListener('change', (e) => {
      journey.title = e.target.value.trim() || 'Untitled Journey';
      save();
    });
    $('#planned').addEventListener('change', (e) => {
      journey.plannedLength = clamp(Math.round(Number(e.target.value) || NSMM.DEFAULT_PLANNED_LENGTH), 12, 300);
      journey.aiStaged = 0;
      run(async () => {
        await relabelStages(true);
        syncNotes();
        save();
        renderAll();
      });
    });
    // Factors: outlines and numbers follow the slider live; notes are raised on release.
    const factorChanged = () => {
      rescoreAll();
      renderGraph();
      renderStats();
      if (selectedId && fsById(selectedId)) updateReadouts(fsById(selectedId));
    };
    const factorSettled = () => {
      rescoreAll();
      syncNotes();
      checkDrift();
      save();
      renderAll();
    };
    $('#tf').addEventListener('input', (e) => {
      journey.tf = Math.round(Number(e.target.value) * 100) / 100;
      factorChanged();
    });
    $('#tf').addEventListener('change', factorSettled);
    $('#branch-share').addEventListener('input', (e) => {
      journey.branchShare = Number(e.target.value);
      factorChanged();
    });
    $('#branch-share').addEventListener('change', factorSettled);
    $('#panel-storyline').addEventListener('click', (e) => {
      if (e.target.id !== 'tf-auto') return;
      e.preventDefault();
      journey.tf = null;
      factorSettled();
    });
    $('#pane-close').addEventListener('click', () => setPane(false));
    $('#pane-open').addEventListener('click', () => setPane(true));
    $('#clear-notes').addEventListener('click', () => {
      if (confirm('Clear every open note?')) clearNotes();
    });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    // home
    $('#h-new').addEventListener('click', () => {
      journey = newJourney();
      save();
      go(journey.id);
      setTimeout(() => $('#journey-title').select(), 50);
    });
    $('#h-sample').addEventListener('click', () => run(createSample));
    $('#h-import').addEventListener('click', () => $('#import-file').click());
    $('#journey-list').addEventListener('click', (e) => {
      const b = e.target.closest('[data-del-journey]');
      if (!b) return;
      const j = readJourney(b.dataset.delJourney);
      if (j && confirm(`Delete "${j.title}"? This cannot be undone. Export it first if you want to keep it.`)) {
        deleteJourney(j.id);
        renderHome();
      }
    });

    document.body.addEventListener('click', (e) => {
      const t = e.target.closest(
        '[data-act],[data-goto],[data-move],[data-shift],[data-place-after],[data-split],[data-delete],[data-seed-del],[data-edge-del],[data-seeds-clear],[data-drift],[data-drawer-close],[data-char-open],[data-char-back],[data-char-close],[data-char-del],[data-char-pick],[data-phys-del],[data-trait-del],#copy-draft,#dl-draft'
      );
      if (!t || !journey) return;
      const f = selectedId && fsById(selectedId);
      const c = charView && character(charView);
      if (t.hasAttribute('data-drift')) {
        if (document.body.classList.contains('pane-closed')) setPane(true);
        showTab(inspecting() ? 'storyline' : 'notes');
      }
      else if (t.hasAttribute('data-drawer-close')) closeDrawer();
      else if (t.dataset.act) resolveAlert(t.dataset.a, t.dataset.act);
      else if (t.dataset.goto) {
        e.preventDefault();
        selectFootstep(t.dataset.goto);
      } else if (t.dataset.move && f) {
        if (t.dataset.move === 'branch') makeBranch(f);
        else if (t.dataset.move === 'main') makeMain(f);
        else f.thread = t.dataset.move;
        run(async () => {
          await relabelStages(false);
          syncNotes([f.id]);
          save();
          renderAll();
        });
      } else if (t.dataset.shift) {
        moveInOrder(selectedId, Number(t.dataset.shift));
        run(async () => {
          await relabelStages(false);
          save();
          renderAll();
        });
      } else if (t.dataset.placeAfter) {
        $('#place').value = t.dataset.placeAfter;
        $('#transcript').focus();
        setStatus(
          (fsById(t.dataset.placeAfter)?.thread === 'branch' ? 'Your next idea will continue the side path after ' : 'Your next idea will go right after ') +
            t.dataset.placeAfter +
            '. Speak or type it now.'
        );
      } else if (t.hasAttribute('data-split') && f) {
        run(() => splitFootstep(f.id));
      } else if (t.hasAttribute('data-delete') && f) {
        deleteFootstep(f);
      } else if (t.dataset.seedDel) {
        deleteEdge(Number(t.dataset.seedDel));
      } else if (t.dataset.edgeDel) {
        deleteEdge(Number(t.dataset.edgeDel));
      } else if (t.hasAttribute('data-seeds-clear') && f) {
        journey.edges = journey.edges.filter((x) => x.from !== f.id && x.to !== f.id);
        save();
        renderGraph();
        renderDetail();
        setStatus(`Deleted every link of ${f.id}.`, 'ok');
      } else if (t.dataset.charOpen) {
        charView = t.dataset.charOpen;
        renderCharacters();
      } else if (t.hasAttribute('data-char-close')) {
        toggleCharPop(false);
      } else if (t.hasAttribute('data-char-back')) {
        charView = null;
        renderCharacters();
      } else if (t.hasAttribute('data-char-del') && c) {
        if (!confirm(`Remove ${c.name} from the character list? Footsteps keep their text.`)) return;
        journey.characters = journey.characters.filter((x) => x !== c);
        charView = null;
        save();
        renderCharacters();
      } else if (t.hasAttribute('data-char-pick') && c) {
        run(() => pickPhysical(c));
      } else if (t.dataset.physDel && c) {
        c.physical.splice(Number(t.dataset.physDel), 1);
        save();
        renderCharacters();
      } else if (t.dataset.traitDel && c) {
        c.traits.splice(Number(t.dataset.traitDel), 1);
        save();
        renderCharacters();
      } else if (t.id === 'copy-draft') {
        navigator.clipboard?.writeText(journey.draft).then(() => setStatus('Draft copied.', 'ok'));
      } else if (t.id === 'dl-draft') {
        download(slug() + '.md', journey.draft, 'text/markdown');
      }
    });

    // characters pane forms and strictness
    $('#characters').addEventListener('input', (e) => {
      const c = charView && character(charView);
      if (!c || !e.target.classList.contains('strictness')) return;
      c.strictness = Number(e.target.value);
      $('#characters .strict-val').textContent = c.strictness.toFixed(1);
    });
    $('#characters').addEventListener('change', (e) => {
      if (e.target.classList.contains('strictness')) save();
    });
    $('#characters').addEventListener('submit', (e) => {
      e.preventDefault();
      const c = charView && character(charView);
      if (e.target.classList.contains('merge-char')) {
        const into = e.target.querySelector('select').value;
        if (c && into && confirm(`Merge ${c.name} into ${into}? ${c.name} becomes another name for ${into} in every Footstep.`)) {
          mergeCharacters(c.name, into);
          charView = into;
          save();
          renderAll();
        }
        return;
      }
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      if (e.target.classList.contains('add-char')) {
        ensureCharacter(text);
        charView = text;
      } else if (e.target.classList.contains('add-trait') && c) c.traits.push({ text });
      else if (e.target.classList.contains('add-physical') && c) addPhysical(c, text);
      save();
      renderCharacters();
      $('#characters input')?.focus();
    });

    // footstep edits
    $('#detail').addEventListener('change', (e) => {
      const f = fsById(selectedId);
      if (f && e.target.dataset.edit) editFootstep(f, e.target.dataset.edit, e.target.value);
    });
    $('#detail').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = fsById(selectedId);
      const other = e.target.elements.other?.value;
      if (!f || !other) return;
      const kind = e.target.elements.type.value;
      // A cause is stored once; its consequence shows on the other Footstep by itself.
      if (kind === 'cause-out') journey.edges.push({ from: f.id, to: other, type: 'cause' });
      else if (kind === 'cause-in') journey.edges.push({ from: other, to: f.id, type: 'cause' });
      else journey.edges.push({ from: other, to: f.id, type: kind });
      save();
      renderGraph();
      renderDetail();
    });

    // intensity: live readout while dragging, graph on release
    $('#modifier').addEventListener('input', (e) => {
      const f = fsById(selectedId);
      if (!f || !e.target.hasAttribute('data-intensity')) return;
      f.intensity = Number(e.target.value);
      f.intensityByWriter = true;
      rescoreAll();
      updateReadouts(f);
    });
    $('#modifier').addEventListener('change', (e) => {
      if (!e.target.hasAttribute('data-intensity')) return;
      save();
      renderGraph();
      renderStats();
    });

    // menu
    $('#menu-btn').addEventListener('click', () => $('#menu').toggleAttribute('hidden'));
    $('#menu').addEventListener('click', (e) => {
      if (e.target.closest('button')) $('#menu').hidden = true;
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#menu, #menu-btn')) $('#menu').hidden = true;
    });
    $('#m-export').addEventListener('click', () => {
      const out = { ...journey, footsteps: journey.footsteps.map(({ embedding, ...f }) => f) };
      download(slug() + '.kahyo.json', JSON.stringify(out, null, 2), 'application/json');
    });
    $('#m-delete').addEventListener('click', () => {
      if (!confirm(`Delete "${journey.title}"? This cannot be undone. Export it first if you want to keep it.`)) return;
      deleteJourney(journey.id);
      location.hash = '#/';
    });
    $('#import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) =>
        run(async () => {
          let data = null;
          try {
            data = JSON.parse(txt.replace(/^\uFEFF/, ''));
          } catch {
            throw new Error('Could not read that file. Pick the .kahyo.json file you exported.');
          }
          const j = normalize(data);
          if (!j) throw new Error('That file is not a Kahyo Journey. Pick the .kahyo.json file you exported.');
          journey = { ...j, id: uid(), embedder: null };
          try {
            await ensureEmbedder();
          } catch (err) {
            // Never lose an import over embeddings: fall back to offline ones; they upgrade on the next add.
            console.warn(err);
            journey.footsteps.forEach((f) => (f.embedding = NSMM.localEmbedding(fsText(f))));
            journey.embedder = 'local';
          }
          await relabelStages(false);
          save();
          go(journey.id);
        })
      );
      e.target.value = '';
    });

    // settings
    $('#char-toggle').addEventListener('click', () => toggleCharPop());
    document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#drawer').hidden && !e.target.closest('input, textarea, select')) closeDrawer();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('#char-pop').hidden) toggleCharPop(false);
    });
    // Delete or Backspace removes the selected Footstep (in Write and Inspect).
    document.addEventListener('keydown', (e) => {
      if (!['Delete', 'Backspace'].includes(e.key) || !journey || !selectedId) return;
      if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('dialog[open]')) return;
      const f = fsById(selectedId);
      if (!f) return;
      e.preventDefault();
      deleteFootstep(f);
    });
    $('#theme-btn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    $('#settings-btn').addEventListener('click', openSettings);
    $('#m-settings').addEventListener('click', openSettings);
    $('#settings-save').addEventListener('click', () => {
      const provider = $('#provider').value;
      const before = LLM.settings();
      saveSettings({
        provider,
        apiKey: $('#api-key').value.trim(),
        model: $('#model').value.trim(),
        baseUrl: $('#base-url').value.trim(),
        embedKey: provider === 'gemini' ? '' : $('#embed-key').value.trim(),
      });
      // A new provider has its own model names.
      if (before.provider !== provider && !$('#model').value.trim()) saveSettings({ model: '' });
      $('#settings').close();
      renderBadge();
      if (!journey) return;
      run(async () => {
        await ensureEmbedder();
        rescoreAll();
        save();
        renderAll();
        setStatus(LLM.hasKey() ? `${LLM.providerLabel()} connected. Kahyo will now extract Footsteps with AI.` : 'Offline mode. Footsteps are split by sentence.', 'ok');
      });
    });
    $('#settings-clear').addEventListener('click', () => {
      $('#api-key').value = '';
      $('#embed-key').value = '';
    });
    $('#provider').addEventListener('change', showProvider);
  }

  // Settings show what the chosen provider needs.
  function showProvider() {
    const p = $('#provider').value;
    const info = LLM.PROVIDERS[p];
    $('#api-key').placeholder = info.keyHint;
    $('#model').placeholder = info.model || 'model name';
    $('#base-url-row').hidden = p !== 'custom';
    $('#embed-key-row').hidden = p === 'gemini';
    $('#key-help').innerHTML = info.keyUrl
      ? `Get a key at <a href="${info.keyUrl}" target="_blank" rel="noopener">${info.keyUrl.replace(/^https:\/\//, '')}</a>${p === 'gemini' || p === 'groq' ? ' (free, no card).' : '.'}`
      : 'Any service with an OpenAI-compatible chat API.';
  }

  function openSettings() {
    const s = LLM.settings();
    $('#provider').value = LLM.provider();
    $('#api-key').value = s.apiKey || '';
    $('#model').value = s.model && !/gemini-2\./.test(s.model) ? s.model : '';
    $('#base-url').value = s.baseUrl || '';
    $('#embed-key').value = s.embedKey || '';
    showProvider();
    $('#settings').showModal();
  }

  // ---------- init ----------

  function init() {
    migrate();
    LLM.onBusy = (n) => setStatus(`The AI is busy right now. Trying again (${n} of 2)…`, 'warn');
    $('#legend').innerHTML =
      '<span class="legend-geo">On course climbs at 35° · the line turns by its direction · line length = magnitude · circle size = intensity · click a link to delete it</span>' +
      Object.values(EDGE_TYPES)
        .map((t, i) => `<span><i class="line ${Object.keys(EDGE_TYPES)[i]}" style="--c:${t.color}"></i>${t.label}</span>`)
        .join('') +
      '<span><i class="ring over"></i>Off course</span><span><i class="ring wander"></i>Wandering</span><span><i class="ring branch"></i>Side path</span><span><i class="ring heavy"></i>Jump</span><span><i class="ring broken"></i>Trait break</span>';
    if (!SR) $('#mic-note').textContent = 'Voice needs Chrome or Edge. Typing works everywhere.';
    let mode = 'write';
    try {
      mode = localStorage.getItem('kahyo.mode') || 'write';
    } catch {}
    setMode(mode);
    try {
      if (localStorage.getItem('kahyo.pane') === 'closed') document.body.classList.add('pane-closed');
    } catch {}
    bind();
    route();
    document.fonts?.ready.then(() => journey && renderGraph());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
