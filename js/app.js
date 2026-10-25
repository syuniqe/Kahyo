// Kahyo demo app: Journeys home → voice → Footsteps → Journey graph → continuity checks → helper draft.

(function () {
  const $ = (sel) => document.querySelector(sel);
  const INDEX_KEY = 'kahyo.journeys';
  const LEGACY_KEY = 'kahyo.journey';
  const jKey = (id) => 'kahyo.j.' + id;
  const EDGE_TYPES = {
    causal: { label: 'Causal', color: '#FD3A0A' },
    temporal: { label: 'Story order', color: '#7a7a8e' },
    character_arc: { label: 'Character arc', color: '#6db3e0' },
    setup_resolution: { label: 'Setup → resolution', color: '#4a8c6a' },
    thematic: { label: 'Thematic', color: '#b07ad4' },
  };
  // Graph geometry: a line's angle is the Footstep's direction (up = toward the
  // story's intent, down = away), and its length is the Footstep's magnitude.
  const MAX_ANGLE = 60;
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
      threshold: NSMM.DEFAULT_THRESHOLD,
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
    if (!Array.isArray(j.order)) j.order = j.footsteps.filter((f) => f.thread === 'main').map((f) => f.id);
    j.characters.forEach((c) => {
      c.traits = c.traits || [];
      c.physical = c.physical || [];
    });
    j.footsteps.forEach((f) => {
      if (f.stage === undefined) f.stage = null;
      f.violations = f.violations || [];
    });
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

  // The main-thread moment a branch grew from.
  function branchRoot(f) {
    const e = journey.edges.find((x) => x.to === f.id && fsById(x.from) && fsById(x.from).thread !== 'archived');
    return e ? fsById(e.from) : null;
  }

  function fsText(f) {
    return [f.event, f.context, (f.subjects || []).join(', ')].filter(Boolean).join('. ');
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
    return journey.characters.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
  }

  function ensureCharacter(name) {
    name = String(name || '').trim();
    if (!name) return null;
    let c = character(name);
    if (!c) {
      c = { name, traits: [], physical: [] };
      journey.characters.push(c);
    }
    return c;
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
    const hits = pool.filter((f) => appearsIn(f, c.name));
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
    return LLM.hasKey() ? 'gemini' : 'local';
  }

  async function embedTexts(texts) {
    if (currentEmbedder() === 'gemini') return LLM.embed(texts);
    return texts.map((t) => NSMM.localEmbedding(t));
  }

  // If the embedder changed (key added or removed), re-embed every Footstep so
  // cosine similarity always compares vectors from the same model.
  async function ensureEmbedder() {
    const want = currentEmbedder();
    if (journey.embedder === want) return;
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
    "event": "one sentence: what happens (the atomic story moment)",
    "subjects": ["character or entity names involved"],
    "context": "where/when/circumstances",
    "plot_intensity": 0.0-1.0,
    "promises": ["setups planted that the story must later pay off"],
    "world_rules": ["new rules of the world introduced"],
    "intent_signal": -1.0 to 1.0 (-1 = writer is exploring a what-if/tangent, 0 = neutral, +1 = converging toward climax/resolution),
    "seeds": [{"target": "existing id like FS#003, or NEW1/NEW2 for an earlier footstep in this same list", "type": "causal|temporal|character_arc|setup_resolution|thematic"}]
  }],
  "place_after": "the existing main-thread id these new moments come right after in STORY time, START if they come before everything, or END if they simply continue the story",
  "new_traits": [{"character": "name", "trait": "a lasting behavioural rule the writer stated, e.g. 'never lies'"}],
  "physical_features": [{"character": "name", "feature": "a short phrase about body, face, age, clothing or voice the writer stated, e.g. 'big, fat king'"}],
  "violations": [{"footstep": "NEW1", "character": "name", "trait": "exact existing trait text", "severity": "soft|hard", "suggestion": "how the writer could fix or justify it"}]
}`;

  function extractPrompt(transcript) {
    const recent = [
      ...mainInOrder().map((f, i) => `${i + 1}. ${f.id}: ${f.event}`),
      ...journey.footsteps.filter((f) => f.thread === 'branch').map((f) => `   (side branch) ${f.id}: ${f.event}`),
    ]
      .slice(-80)
      .join('\n');
    const people = journey.characters
      .map((c) => {
        const traits = c.traits.filter((t) => t.level !== 'off').map((t) => `"${t.text}" (${t.level})`);
        return `- ${c.name}${c.physical.length ? ` [looks: ${c.physical.join('; ')}]` : ''}${traits.length ? `: ${traits.join(', ')}` : ''}`;
      })
      .join('\n');
    return `You are the extraction layer of Kahyo, a voice-first storytelling system based on the Narrative Storyline Mapping Model (NSMM).
A writer just spoke a fragment of their story out loud. Split it into Footsteps: atomic story moments, each one meaningful advancement. Usually 1-4 per fragment. Ignore filler ("um", "so basically").
Writers speak out of order. Decide where the new moments belong in the story's timeline and set place_after. Use END unless the writer signals otherwise (e.g. "before the king...", "earlier,", "at the start", "back in step 2") or the content clearly happens earlier. Use the story so far to understand pronouns and references.
Link each new Footstep to earlier ones with typed seeds only when there is a real causal, character-arc, setup-resolution or thematic relationship. Story order is tracked separately, so do not add temporal seeds.
Check every new Footstep against the character traits below. Report a violation only when a character clearly acts against a trait. Use "hard" for strict traits.
Only report new_traits the writer explicitly states about a character's lasting nature, and physical_features the writer states about how a character looks or sounds.

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
    return {
      footsteps: sentences.map((s) => {
        const caps = (s.slice(1).match(/\b[A-Z][a-z]+\b/g) || []).filter((w) => !skip.has(w));
        const subjects = [...new Set([...known.filter((k) => s.includes(k)), ...caps])].slice(0, 4);
        const exploring = /\b(what if|maybe|just exploring|thinking out loud|tangent|perhaps)\b/i.test(s);
        const converging = /\b(finally|climax|at last|in the end|realizes|realises|ending)\b/i.test(s);
        return {
          event: s.replace(/^(so|and|then|okay|um|uh)[,\s]+/i, ''),
          subjects,
          context: '',
          plot_intensity: 0.5,
          promises: [],
          world_rules: [],
          intent_signal: exploring ? -1 : converging ? 1 : 0,
          seeds: [],
        };
      }),
      place_after: 'END',
      new_traits: [],
      physical_features: known.flatMap((name) => offlinePhysical(transcript, name).map((w) => ({ character: name, feature: w }))),
      violations: [],
    };
  }

  // ---------- core pipeline ----------

  async function addThought(transcript, preExtracted, placeAfter) {
    transcript = transcript.trim();
    if (!transcript) return;
    const extracted = preExtracted || (LLM.hasKey() ? await LLM.generateJSON(extractPrompt(transcript), EXTRACT_SCHEMA) : offlineExtract(transcript));
    const items = (extracted.footsteps || []).filter((f) => f && f.event);
    if (!items.length) {
      setStatus('No story moments found in that fragment. Try saying what happens.', 'warn');
      return;
    }

    (extracted.new_traits || []).forEach((t) => {
      const c = ensureCharacter(t.character);
      if (c && t.trait && !c.traits.some((x) => x.text.toLowerCase() === t.trait.toLowerCase())) {
        c.traits.push({ text: t.trait, level: 'moderate' });
      }
    });
    (extracted.physical_features || []).forEach((p) => {
      const c = LLM.hasKey() || preExtracted ? ensureCharacter(p.character) : character(p.character);
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

    const vecs = await embedTexts(items.map(fsText));
    // Where the new moments go: the writer's pick, else the model's, else the end.
    let anchor = placeAfter && placeAfter !== 'AUTO' ? placeAfter : String(extracted.place_after || 'END').trim();
    if (anchor !== 'START' && !storyOrder().includes(anchor)) anchor = 'END';

    items.forEach((raw, i) => {
      const fs = {
        id: newIds[i],
        event: String(raw.event),
        subjects: (raw.subjects || []).map(String),
        context: String(raw.context || ''),
        plot_intensity: Number(raw.plot_intensity ?? 0.5),
        promises: (raw.promises || []).map(String),
        world_rules: (raw.world_rules || []).map(String),
        intent_signal: Number(raw.intent_signal ?? 0),
        stage: null,
        created_at: Date.now(),
        transcript,
        embedding: vecs[i],
        thread: 'main',
        violations: [],
      };
      if (LLM.hasKey() || preExtracted) fs.subjects.forEach(ensureCharacter);

      const prior = journey.footsteps.filter((f) => f.thread === 'main');
      fs.metrics = NSMM.scoreFootstep(fs, prior, fs.stage, journey.threshold);
      journey.footsteps.push(fs);

      const seeds = (raw.seeds || [])
        .map((s) => ({ from: resolve(s.target), type: EDGE_TYPES[s.type] ? s.type : 'causal' }))
        .filter((s) => s.from && s.from !== fs.id && s.type !== 'temporal');
      seeds.forEach((s) => journey.edges.push({ from: s.from, to: fs.id, type: s.type }));

      // Pruning waits until the Journey has a direction to measure against: not
      // before four main moments, and offline (weak embeddings) only when the
      // writer signals a what-if. An explicit what-if can branch any time.
      const mainCount = storyOrder().length;
      const reliable = LLM.hasKey() || Boolean(preExtracted);
      const canBranch = (fs.intent_signal < 0 && mainCount >= 1) || (reliable && mainCount >= 4);
      fs.metrics.is_branch_candidate = fs.metrics.is_branch_candidate && canBranch;

      if (fs.metrics.is_branch_candidate) {
        fs.thread = 'branch';
        // A branch hangs off the moment it grew from.
        const root = anchor === 'END' ? storyOrder()[storyOrder().length - 1] : anchor === 'START' ? storyOrder()[0] : anchor;
        if (!seeds.length && root) journey.edges.push({ from: root, to: fs.id, type: 'temporal' });
        journey.alerts.unshift({
          id: 'a' + uid(),
          kind: 'terminancy',
          fsId: fs.id,
          text: `${fs.id} wanders away from where your story is heading, so Kahyo moved it to a side path.`,
          maths: `terminancy ${fs.metrics.terminancy.toFixed(2)} > threshold ${journey.threshold}`,
          open: true,
        });
      } else {
        placeInOrder(fs.id, anchor);
        anchor = fs.id;
        if (fs.metrics.contradiction_review) {
          journey.alerts.unshift({
            id: 'a' + uid(),
            kind: 'contradiction',
            fsId: fs.id,
            text: `${fs.id} seems to point against what came before. Is that a twist, or a slip?`,
            maths: `angle ${fs.metrics.angle.toFixed(0)}° ≥ 150°`,
            open: true,
          });
        }
      }
      flagIfHeavy(fs);
    });

    (extracted.violations || []).forEach((v) => {
      const id = resolve(v.footstep) || newIds[0];
      const fs = fsById(id);
      const c = character(v.character);
      const trait = c?.traits.find((t) => t.text.toLowerCase() === String(v.trait).toLowerCase()) || c?.traits[0];
      if (!fs || !trait || trait.level === 'off') return;
      const severity = trait.level === 'strict' ? 'hard' : v.severity === 'hard' ? 'hard' : 'soft';
      fs.violations.push({ character: c.name, trait: trait.text, severity, suggestion: v.suggestion || '' });
      journey.alerts.unshift({
        id: 'a' + uid(),
        kind: 'trait',
        fsId: fs.id,
        character: c.name,
        trait: trait.text,
        severity,
        text: `In ${fs.id}, ${c.name} acts against "${trait.text}".`,
        suggestion: v.suggestion || '',
        open: true,
      });
    });

    await relabelStages(!preExtracted);
    checkDrift();
    save();
    renderAll({ fit: true });
    selectFootstep(newIds[newIds.length - 1]);
    // Quiet notes: a dot on the moment and a count on the Notes tab, no interruption.
    const flagged = journey.alerts.filter((a) => a.open && newIds.includes(a.fsId)).length;
    setStatus(`Added ${items.length} moment${items.length > 1 ? 's' : ''}.${flagged ? ` Kahyo left ${flagged} note${flagged > 1 ? 's' : ''} in the margin.` : ''}`, 'ok');
  }

  // Story drift: placeholder rule until the math study defines it. Of the last
  // six Footsteps written, if half or more are branches or past the
  // Terminancy threshold, the story is wandering from its main line.
  const DRIFT_WINDOW = 6;
  const DRIFT_SHARE = 0.5;
  function recentOffCourse() {
    const recent = journey.footsteps
      .filter((f) => f.thread !== 'archived')
      .sort((a, b) => a.created_at - b.created_at)
      .slice(-DRIFT_WINDOW);
    const off = recent.filter((f) => f.thread === 'branch' || (f.metrics?.terminancy ?? 0) > journey.threshold);
    return { recent, off, drifting: recent.length >= 4 && off.length >= 3 && off.length / recent.length >= DRIFT_SHARE };
  }

  // One signal for the writer instead of six numbers.
  function storyHealth() {
    const { recent, off, drifting } = recentOffCourse();
    if (recent.length < 2) return { level: 'quiet', label: 'Just starting' };
    if (drifting) return { level: 'drift', label: 'Drifting' };
    if (off.length >= 2) return { level: 'wander', label: 'Wandering a little' };
    return { level: 'ok', label: 'On course' };
  }

  function checkDrift() {
    const { recent, off, drifting } = recentOffCourse();
    const open = journey.alerts.find((a) => a.open && a.kind === 'drift');
    const count = journey.footsteps.length;
    if (!drifting) {
      if (open) open.open = false;
      return;
    }
    if (journey.driftDismissedAt === count) return;
    const text = `${off.length} of your last ${recent.length} moments wander away from the main story (${off.map((f) => f.id).join(', ')}). Is that on purpose? If not, bring the next idea back to the main line.`;
    if (open) open.text = text;
    const maths = `${off.length}/${recent.length} recent moments are branches or past threshold ${journey.threshold}`;
    if (open) open.maths = maths;
    else journey.alerts.unshift({ id: 'a' + uid(), kind: 'drift', fsId: off[off.length - 1].id, text, maths, open: true });
  }

  // A Footstep with too much in it is probably two moments.
  function flagIfHeavy(fs) {
    if (NSMM.dataAmount(fs) <= NSMM.SPLIT_AT) return;
    if (journey.alerts.some((a) => a.open && a.kind === 'heavy' && a.fsId === fs.id)) return;
    journey.alerts.unshift({
      id: 'a' + uid(),
      kind: 'heavy',
      fsId: fs.id,
      text: `${fs.id} holds a lot. It may be two moments in one.`,
      maths: `data ${NSMM.dataAmount(fs)} > ${NSMM.SPLIT_AT}`,
      open: true,
    });
  }

  // ---------- stages ----------

  // No stage labels until the Journey has 12 main Footsteps. Then the AI reads
  // the whole story and labels each moment (every 3 new Footsteps, to save the
  // free quota), with a position-based fallback offline.
  async function relabelStages(allowAI) {
    const main = mainInOrder();
    const n = main.length;
    if (n < NSMM.STAGE_LABEL_AFTER) {
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
        // Keep the AI's labels; a new moment takes the stage of the one before it.
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
      `You label the stages of a story being written in Kahyo (NSMM Journey Mapping). The story is unfinished: ${main.length} of about ${journey.plannedLength} planned Footsteps are written.
Stages, in order:
- Origin: the world and characters before the story moves.
- Pandiculation: the story stretches open: the inciting event and new threads.
- Maxspan: the widest point: most threads open, complications peak.
- Convergence: threads pull together toward the end.
- Climax: the decisive confrontation and its resolution.
Label every Footstep. Stages only move forward through the list. Do not use a stage the story has not reached yet.

Footsteps in story order:
${main.map((f, i) => `${i + 1}. ${f.id}: ${f.event}`).join('\n')}`,
      '{"stages":[{"id":"FS#001","stage":"Origin|Pandiculation|Maxspan|Convergence|Climax"}]}'
    );
    const byId = Object.fromEntries((res.stages || []).map((s) => [s.id, s.stage]));
    let prev = NSMM.STAGES[0];
    return main.map((f) => (prev = NSMM.STAGES.includes(byId[f.id]) ? byId[f.id] : prev));
  }

  // Re-score every Footstep in creation order (after a threshold change or edit).
  function rescoreAll() {
    const prior = [];
    journey.footsteps.forEach((f) => {
      const keepBranch = f.metrics?.is_branch_candidate;
      f.metrics = NSMM.scoreFootstep(f, prior, f.stage, journey.threshold);
      if (f.thread !== 'branch') f.metrics.is_branch_candidate = f.metrics.is_branch_candidate && keepBranch;
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
      setStatus('Splitting ' + id + ' into two moments…');
      const r = await LLM.generateJSON(
        `Split this story moment into exactly two smaller, consecutive moments. Keep the writer's facts; do not add events.\nEvent: ${f.event}\nContext: ${f.context}\nSubjects: ${(f.subjects || []).join(', ')}\nPromises: ${(f.promises || []).join('; ')}\nWorld rules: ${(f.world_rules || []).join('; ')}`,
        '{"footsteps":[{"event":"","subjects":[""],"context":"","promises":[""],"world_rules":[""]},{"event":"","subjects":[""],"context":"","promises":[""],"world_rules":[""]}]}'
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
        { event: a, subjects: who(a).length ? who(a) : f.subjects, context: f.context, promises: [], world_rules: f.world_rules },
        { event: b[0].toUpperCase() + b.slice(1), subjects: who(b).length ? who(b) : f.subjects, context: f.context, promises: f.promises, world_rules: [] },
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
      x.world_rules = (p.world_rules || []).filter(Boolean).map(String);
    });
    journey.footsteps.splice(journey.footsteps.indexOf(f) + 1, 0, g);
    journey.edges.filter((e) => e.from === f.id).forEach((e) => (e.from = g.id));
    if (f.thread === 'main') placeInOrder(g.id, f.id);
    else journey.edges.push({ from: f.id, to: g.id, type: 'temporal' });
    await reembed(f);
    await reembed(g);
    journey.alerts.filter((a) => a.kind === 'heavy' && a.fsId === f.id).forEach((a) => (a.open = false));
    await relabelStages(false);
    [f, g].forEach(flagIfHeavy);
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

  function resolveAlert(alertId, action) {
    const a = journey.alerts.find((x) => x.id === alertId);
    if (!a) return;
    const fs = fsById(a.fsId);
    if (action === 'split' && fs) return run(() => splitFootstep(fs.id));
    if (action === 'keep' && fs) {
      fs.thread = 'main';
      const from = journey.edges.find((e) => e.to === fs.id && storyOrder().includes(e.from));
      placeInOrder(fs.id, from ? from.from : 'END');
    }
    if (action === 'archive' && fs) fs.thread = 'archived';
    if (action === 'dismiss') journey.driftDismissedAt = journey.footsteps.length;
    if (action === 'relax') {
      const t = character(a.character)?.traits.find((x) => x.text === a.trait);
      if (t) t.level = 'flexible';
    }
    if (action === 'remove' && fs) removeFootstep(fs.id);
    a.open = false;
    a.resolution = action;
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
        `# ${journey.title}\n\n_Helper outline from your Footsteps. Add a free Gemini key in Settings for a prose scaffold._\n\n` +
        groups.map((g) => `## ${g.key}\n\n${g.items.join('\n')}`).join('\n\n') +
        (journey.characters.length ? `\n\n## Characters\n\n${journey.characters.map((c) => `- **${c.name}**${c.physical.length ? `: ${c.physical.join(', ')}` : ''}`).join('\n')}` : '') +
        (branches.length ? `\n\n## Side paths you explored\n\n${branches.map((f) => `- ${f.event}`).join('\n')}` : '');
    } else {
      setStatus('Building a helper draft from every Footstep…');
      const people = journey.characters
        .map((c) => `${c.name}${c.physical.length ? ` (looks: ${c.physical.join(', ')})` : ''}${c.traits.length ? `; traits: ${c.traits.filter((t) => t.level !== 'off').map((t) => t.text).join(', ')}` : ''}`)
        .join('\n');
      // Grounded on purpose: the draft may only use what the writer said.
      // Anything missing becomes a [question] for the writer, never invented.
      const raw = await LLM.generateText(
        `You help a writer; you never replace them. Turn the story moments below into a helper draft of "${journey.title}".

STRICT RULES:
- Use ONLY the facts in the moments, characters and context below. Do not invent any new character, place, object, event, backstory, motive, dialogue or description.
- If a scene needs a detail the writer has not given, write a short question in brackets for the writer instead, e.g. [What does the king build?]. Never fill it in yourself.
- One short paragraph per moment, 1 to 3 sentences, about as long as the moment itself. Do not pad.
- Start each paragraph with the moment number in bold, e.g. **3.** Keep the moments in this order.
- Group the paragraphs under "## <stage>" headings when a stage is given.
- No word counts, no notes about length, no commentary.
- End with "## Open threads": the promises below that later moments do not pay off, one per line. Then "## Side paths": the side-path moments, one per line, if there are any.

Characters:
${people || '(none)'}

Main story, in order:
${main.map((f, i) => `${i + 1}. [${f.stage || 'unstaged'}] ${f.event}${f.context ? ` (${f.context})` : ''}${f.subjects?.length ? ` | who: ${f.subjects.join(', ')}` : ''}${f.promises?.length ? ` | promises: ${f.promises.join('; ')}` : ''}`).join('\n')}

Side paths (branches, not in the main story):
${branches.map((f) => `- ${f.event}`).join('\n') || '(none)'}`,
        { temperature: 0.2, thinkingConfig: { thinkingLevel: 'low' } }
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
        const stage = main >= NSMM.STAGE_LABEL_AFTER && j.stage ? j.stage : `Stages after ${NSMM.STAGE_LABEL_AFTER} Footsteps`;
        return `<article class="jcard">
          <a class="jcard-main" href="#/j/${esc(j.id)}">
            <h3><img src="assets/kahyo-mark-256.png" alt="" />${esc(j.title)}</h3>
            <p class="muted small">${esc(stage)}</p>
            <div class="progress" title="${main} of about ${j.plannedLength} planned Footsteps"><i style="width:${pct}%"></i></div>
            <p class="small">${main} / ~${j.plannedLength} Footsteps · ${branches} branch${branches === 1 ? '' : 'es'}${open ? ` · <span class="warn-text">${open} alert${open > 1 ? 's' : ''}</span>` : ''}</p>
            <p class="muted small">${esc(j.characters.map((c) => c.name).slice(0, 4).join(', ') || 'No characters yet')}</p>
          </a>
          <div class="jcard-foot"><span class="muted small">Edited ${timeAgo(j.updated)}</span><button class="ghost small" data-del-journey="${esc(j.id)}">Delete</button></div>
        </article>`;
      })
      .join('');
  }

  function showHome() {
    if (listening) recognizer.stop();
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
    journey.characters = JSON.parse(JSON.stringify(S.characters));
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
    $('#mode-badge').textContent = LLM.hasKey() ? 'Gemini' : 'Offline mode';
    $('#mode-badge').className = 'badge ' + (LLM.hasKey() ? 'on' : 'off');
  }

  function renderAll(opts = {}) {
    if (!journey || $('#journey-view').hidden) return;
    $('#journey-title').value = journey.title;
    document.title = journey.title + ' · Kahyo';
    $('#planned').value = journey.plannedLength;
    $('#threshold').value = journey.threshold;
    $('#threshold-val').textContent = Number(journey.threshold).toFixed(2);
    renderGraph(opts);
    renderStats();
    renderCharacters();
    renderAlerts();
    renderDetail();
    renderModifier();
    renderDraftPanel();
    renderBadge();
  }

  function heading(f) {
    return clamp(f.metrics?.direction ?? 0, -1, 1) * MAX_ANGLE;
  }

  function segLength(f) {
    return clamp(30 + 7 * (f.metrics?.magnitude ?? 1), 55, 190);
  }

  function step(f, extraDeg = 0) {
    const rad = ((heading(f) + extraDeg) * Math.PI) / 180;
    const L = segLength(f);
    return { dx: L * Math.cos(rad), dy: -L * Math.sin(rad) };
  }

  // Positions: each main Footstep is placed from the one before it by its own
  // vector. Branches leave the moment they grew from by their own vector.
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
        const s = step(f, -18 * (k - 1));
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
      const data = NSMM.dataAmount(f);
      const heavy = data > NSMM.SPLIT_AT;
      const over = inspecting() && (f.metrics?.terminancy ?? 0) > journey.threshold;
      return {
        id: f.id,
        x: pos[f.id].x,
        y: pos[f.id].y,
        fixed: true,
        label: f.id,
        title: `${num[f.id] ? `#${num[f.id]} · ` : 'Branch · '}${f.id}\n${f.event}\nData ${data} / ${NSMM.SPLIT_AT}${heavy ? ' (heavy: consider splitting)' : ''}`,
        size: 8 + 16 * Math.min(1, data / NSMM.SPLIT_AT),
        shape: 'dot',
        color: {
          background: branch ? C.branchBg : hasViolation ? C.breakBg : C.bg,
          border: hasViolation ? C.red : branch || over ? C.amber : heavy ? '#FD3A0A' : C.border,
          highlight: { background: C.bg, border: '#FD3A0A' },
          hover: { background: C.bg, border: '#FD3A0A' },
        },
        borderWidth: heavy || over ? 4 : hasViolation || branch ? 3 : 2,
        // Past the Terminancy threshold: a thick amber outline with a glow.
        shadow: { enabled: over, color: C.amber, size: 14, x: 0, y: 0 },
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
          color: { color: e.type === 'temporal' ? C.order : EDGE_TYPES[e.type]?.color || '#888', opacity: vecLine ? 0.9 : 0.55 },
          dashes: e.type === 'thematic' || (vecLine && to.thread === 'branch'),
          title: vecLine
            ? `${e.from} → ${e.to}\nDirection ${(m.direction ?? 0).toFixed(2)} (line at ${heading(to).toFixed(0)}°)\nMagnitude ${(m.magnitude ?? 0).toFixed(1)} (line length)`
            : EDGE_TYPES[e.type]?.label,
          width: vecLine ? 2.5 : e.type === 'causal' || e.type === 'setup_resolution' ? 1.6 : 1.1,
          smooth: vecLine ? false : { type: 'curvedCW', roundness: 0.3 },
        };
      });

    // Stage names sit above the first Footstep of each stage.
    stageMarks = [];
    let last = null;
    order.forEach((id) => {
      const f = fsById(id);
      if (f.stage && f.stage !== last) stageMarks.push({ ...pos[id], stage: f.stage });
      last = f.stage;
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
      // Quiet notes: a small dot on each moment that has one.
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
          ctx.strokeStyle = 'rgba(253, 58, 10, 0.35)';
          ctx.setLineDash([3, 4]);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y - 26);
          ctx.lineTo(s.x, s.y - 26 - 52 * k);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 4 * k;
          ctx.strokeStyle = bg;
          ctx.strokeText(s.stage, s.x - 6 * k, s.y - 26 - 44 * k);
          ctx.fillStyle = head;
          ctx.fillText(s.stage, s.x - 6 * k, s.y - 26 - 44 * k);
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
    sel.innerHTML =
      `<option value="AUTO">${LLM.hasKey() ? 'Let Kahyo decide' : 'At the end'}</option><option value="START">At the very start</option>` +
      order.map((f, i) => `<option value="${esc(f.id)}">After ${i + 1}. ${esc(shortText(f.event, 40))}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'AUTO';
  }

  function renderStats() {
    const main = journey.footsteps.filter((f) => f.thread === 'main');
    const ji = NSMM.journeyIntent(main);
    const branches = journey.footsteps.filter((f) => f.thread === 'branch').length;
    const open = journey.alerts.filter((a) => a.open).length;
    const beyond = journey.footsteps.filter((f) => f.thread !== 'archived' && (f.metrics?.terminancy ?? 0) > journey.threshold).length;
    const stat = (v, word, maths, cls = '') => `<div class="${cls}" title="${maths}"><span>${v}</span>${word}<small class="mword">${maths}</small></div>`;
    $('#stats').innerHTML =
      stat(main.length, 'moments', 'main thread') +
      stat(branches, 'side paths', 'branches') +
      stat(ji ? ji.magnitude.toFixed(1) : '–', 'size of moments', 'avg magnitude') +
      stat(ji ? (ji.direction >= 0 ? '+' : '') + ji.direction.toFixed(2) : '–', 'pull to the ending', 'direction') +
      stat(beyond, 'off course', 'past terminancy threshold', beyond ? 'warn' : '') +
      stat(open, 'notes', 'open alerts', open ? 'warn' : '');
    const h = storyHealth();
    const hb = $('#health');
    hb.className = 'health ' + h.level;
    hb.innerHTML = `<i></i>${h.label}`;
    hb.title = `${main.length} moments, ${branches} side paths, ${beyond} off course (terminancy above ${Number(journey.threshold).toFixed(2)}), average size ${ji ? ji.magnitude.toFixed(1) : '–'}, pull ${ji ? ji.direction.toFixed(2) : '–'}. Click for notes.`;
    const n = main.length;
    if (n < NSMM.STAGE_LABEL_AFTER) {
      $('#rail').innerHTML =
        NSMM.STAGES.map((s) => `<li class="pending">${s}</li>`).join('') +
        `<li class="rail-note">Stages are labelled after ${NSMM.STAGE_LABEL_AFTER} Footsteps · ${n}/${NSMM.STAGE_LABEL_AFTER}</li>`;
    } else {
      const counts = {};
      mainInOrder().forEach((f) => (counts[f.stage] = (counts[f.stage] || 0) + 1));
      const now = NSMM.STAGES.indexOf(journey.stage);
      $('#rail').innerHTML = NSMM.STAGES.map(
        (s, i) => `<li class="${i < now ? 'done' : i === now ? 'now' : ''}">${s}${counts[s] ? ` · ${counts[s]}` : ''}</li>`
      ).join('');
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
        <h4>Traits and strictness</h4>
        ${
          c.traits
            .map(
              (t, ti) => `<div class="trait-row"><span>${esc(t.text)}</span><span class="trait-ctl">
            <select data-ti="${ti}" class="trait-level" aria-label="Strictness">${['strict', 'moderate', 'flexible', 'off'].map((l) => `<option ${l === t.level ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <button class="x" data-trait-del="${ti}" aria-label="Remove trait">×</button></span></div>`
            )
            .join('') || '<p class="muted small">No traits yet. A strict trait is guarded on every Footstep.</p>'
        }
        <form class="add-trait"><input placeholder="Add trait, e.g. never abandons a friend" aria-label="New trait" /></form>
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
    $('#char-faces').innerHTML = people.slice(0, 5).map((c) => avatar(c.name, 'mini')).join('');
  }

  function toggleCharPop(open) {
    const pop = $('#char-pop');
    open = open ?? pop.hidden;
    pop.hidden = !open;
    $('#char-toggle').setAttribute('aria-expanded', String(open));
    $('#char-toggle').classList.toggle('open', open);
  }

  function renderAlerts() {
    const el = $('#alerts');
    const list = journey.alerts.filter((a) => a.open);
    if (!list.length) {
      el.innerHTML = '<p class="muted">No notes right now. When a moment wanders off, a character acts out of character, or a moment holds too much, Kahyo leaves a quiet note here.</p>';
      return;
    }
    const titles = {
      terminancy: ['Wandered off course', 'terminancy'],
      contradiction: ['Points against the story', 'contradiction review'],
      heavy: ['Holds a lot', 'data above split limit'],
      drift: ['The story is drifting', 'story drift'],
    };
    el.innerHTML = list
      .map((a) => {
        const actions =
          a.kind === 'terminancy'
            ? `<button data-a="${a.id}" data-act="keep">Keep it in the main story</button><button data-a="${a.id}" data-act="archive">Set it aside</button>`
            : a.kind === 'trait'
            ? `<button data-a="${a.id}" data-act="accept">It's intentional</button><button data-a="${a.id}" data-act="relax">Loosen the trait</button><button data-a="${a.id}" data-act="remove">Remove moment</button>`
            : a.kind === 'drift'
            ? `<button data-a="${a.id}" data-act="dismiss">It's on purpose</button>`
            : a.kind === 'heavy'
            ? `<button data-a="${a.id}" data-act="split">Split in two</button><button data-a="${a.id}" data-act="accept">Keep as one</button>`
            : `<button data-a="${a.id}" data-act="accept">It's intentional</button><button data-a="${a.id}" data-act="remove">Remove moment</button>`;
        const [title, maths] = a.kind === 'trait' ? ['Out of character', `trait break · ${a.severity}`] : titles[a.kind];
        return `<div class="alert note ${a.kind} ${a.severity || ''}">
          <div class="alert-title"><i class="ndot"></i>${title}<small class="mword">${maths}${a.maths ? ` · ${esc(a.maths)}` : ''}</small></div>
          <p>${esc(a.text)} <a href="#" data-goto="${esc(a.fsId)}">View</a></p>
          ${a.suggestion ? `<p class="suggest">${esc(a.suggestion)}</p>` : ''}
          <div class="actions">${actions}</div>
        </div>`;
      })
      .join('');
  }

  // The Intent Vector in a writer's words.
  function pullWords(f) {
    const m = f.metrics || {};
    const mags = journey.footsteps.filter((x) => x.thread !== 'archived' && x.metrics).map((x) => x.metrics.magnitude).sort((a, b) => a - b);
    const rank = mags.length > 1 ? mags.indexOf(m.magnitude) / (mags.length - 1) : 0.5;
    const size = rank > 0.66 ? 'A big moment' : rank < 0.33 ? 'A small moment' : 'A mid-sized moment';
    const d = m.direction ?? 0;
    const pull = d > 0.3 ? 'that pulls toward your ending' : d < -0.1 ? 'that pulls away from your ending' : 'that holds the story steady';
    const off = (m.terminancy ?? 0) > journey.threshold ? ' It wanders off course.' : '';
    return `${size} ${pull}.${off}`;
  }

  // The selected moment's packet, editable, shown in the drawer.
  function renderDetail() {
    const el = $('#detail');
    const f = selectedId && fsById(selectedId);
    if (!f) {
      el.innerHTML = '<p class="muted">Click a moment on the map.</p>';
      return;
    }
    const m = f.metrics || {};
    const pos = storyOrder().indexOf(f.id);
    const seeds = journey.edges.map((e, i) => ({ ...e, i })).filter((e) => e.to === f.id || e.from === f.id);
    const others = journey.footsteps.filter((x) => x.id !== f.id && x.thread !== 'archived');
    el.innerHTML = `
      <div class="fs-head"><strong>${pos >= 0 ? `#${pos + 1} · ` : ''}${esc(f.id)}</strong><span class="pill ${f.thread}">${f.thread}</span><span class="pill">${esc(f.stage || 'unstaged')}</span></div>
      <label class="field"><span>What happens<small class="mword">event</small></span><textarea data-edit="event" rows="2">${esc(f.event)}</textarea></label>
      <label class="field"><span>Who<small class="mword">subjects</small></span><input data-edit="subjects" value="${esc((f.subjects || []).join(', '))}" placeholder="Comma separated" /></label>
      <label class="field"><span>Where and when<small class="mword">context</small></span><input data-edit="context" value="${esc(f.context || '')}" placeholder="Where, when, circumstances" /></label>
      <details class="more"><summary>Setups and world rules</summary>
        <label class="field"><span>Setups to pay off later, one per line<small class="mword">promises</small></span><textarea data-edit="promises" rows="2">${esc((f.promises || []).join('\n'))}</textarea></label>
        <label class="field"><span>World rules (one per line)</span><textarea data-edit="world_rules" rows="2">${esc((f.world_rules || []).join('\n'))}</textarea></label>
      </details>
      <div class="field"><span>How it moves the story<small class="mword">intent vector</small></span>
        <p class="iv-words">${pullWords(f)}</p>
        <p class="iv-line inspect-only">Magnitude <strong>${(m.magnitude ?? 0).toFixed(1)}</strong> · direction <strong>${(m.direction ?? 0) >= 0 ? '+' : ''}${(m.direction ?? 0).toFixed(2)}</strong> · angle <strong>${(m.angle ?? 0).toFixed(0)}°</strong> · terminancy <strong class="${m.is_branch_candidate ? 'warn-text' : ''}">${(m.terminancy ?? 0).toFixed(2)}</strong></p>
      </div>
      <div class="field"><span>Links to other moments<small class="mword">seeds</small></span>
        <ul class="seeds">${
          seeds
            .map((e) => `<li><span class="dot" style="background:${EDGE_TYPES[e.type]?.color}"></span>${e.to === f.id ? `← ${esc(e.from)}` : `→ ${esc(e.to)}`} · ${EDGE_TYPES[e.type]?.label}<button class="ghost small" data-seed-del="${e.i}" aria-label="Delete this link">Delete</button></li>`)
            .join('') || '<li class="muted">No links yet.</li>'
        }</ul>
        ${seeds.length > 1 ? '<button class="ghost small" data-seeds-clear>Delete all links</button>' : ''}
        <form class="add-seed">
          <select name="from" aria-label="Linked from">${others.map((x) => `<option value="${esc(x.id)}">${esc(x.id)} ${esc(shortText(x.event, 28))}</option>`).join('')}</select>
          <select name="type" aria-label="Link type">${Object.entries(EDGE_TYPES)
            .filter(([k]) => k !== 'temporal')
            .map(([k, t]) => `<option value="${k}">${t.label}</option>`)
            .join('')}</select>
          <button>Link</button>
        </form>
      </div>
      ${(f.violations || []).map((v) => `<div class="alert note trait ${v.severity}"><div class="alert-title"><i class="ndot"></i>Out of character<small class="mword">trait break · ${v.severity}</small></div><p>${esc(v.character)}: “${esc(v.trait)}”</p>${v.suggestion ? `<p class="suggest">${esc(v.suggestion)}</p>` : ''}</div>`).join('')}
      <details><summary>What you said</summary><p class="quote">${esc(f.transcript || '')}</p></details>`;
  }

  // Right pane, bottom half: move the Footstep and tune its Intent Vector.
  function renderModifier() {
    const el = $('#modifier');
    const f = selectedId && fsById(selectedId);
    if (!f) {
      el.innerHTML = '';
      return;
    }
    const data = NSMM.dataAmount(f);
    el.innerHTML = `
      <div class="actions">
        ${f.thread === 'main' ? `<button data-place-after="${esc(f.id)}">Add next idea after this</button><button data-shift="-1" aria-label="Move earlier in the story">↑ Earlier</button><button data-shift="1" aria-label="Move later in the story">↓ Later</button>` : ''}
        ${f.thread !== 'main' ? `<button data-move="main">Bring into main story</button>` : `<button data-move="branch">Make it a side path</button>`}
        <button data-split class="${data > NSMM.SPLIT_AT ? 'primary' : ''}">Split in two</button>
        <button data-move="archived">Set aside</button>
        <button data-delete class="ghost">Delete</button>
      </div>
      <div id="mod-data"></div>
      <div class="iv">
        <div class="iv-title">How it moves the story<small class="mword">intent vector</small></div>
        <div class="iv-wrap"><div id="iv-gauge"></div>
          <div class="sliders">
            <label>How intense<small class="mword">plot intensity</small> <b id="v-pi"></b><input type="range" min="0" max="1" step="0.05" data-iv="plot_intensity" value="${Number(f.plot_intensity)}" /></label>
            <label>Exploring or closing in<small class="mword">intent signal</small> <b id="v-is"></b><input type="range" min="-1" max="1" step="0.1" data-iv="intent_signal" value="${Number(f.intent_signal)}" /><span class="ends"><small>exploring</small><small>closing in</small></span></label>
          </div>
        </div>
        <div id="iv-ranges"></div>
      </div>`;
    updateReadouts(f);
  }

  function updateReadouts(f) {
    const data = NSMM.dataAmount(f);
    $('#mod-data').innerHTML = `<div class="range-row inspect-only"><span>How much it holds<small class="mword">data</small></span><div class="track"><i style="width:${Math.min(100, (100 * data) / NSMM.SPLIT_AT)}%" class="${data > NSMM.SPLIT_AT ? 'over' : ''}"></i></div><b>${data}/${NSMM.SPLIT_AT}</b></div>`;
    $('[data-split]')?.classList.toggle('primary', data > NSMM.SPLIT_AT);
    const m = f.metrics || {};
    const mags = journey.footsteps.filter((x) => x.thread !== 'archived' && x.metrics).map((x) => x.metrics.magnitude);
    const lo = Math.min(...mags);
    const hi = Math.max(...mags);
    const at = (v, a, b) => (b > a ? (100 * (v - a)) / (b - a) : 50);
    const dir = m.direction ?? 0;
    const thr = Number(journey.threshold);
    $('#v-pi').textContent = Number(f.plot_intensity).toFixed(2);
    $('#v-is').textContent = (f.intent_signal >= 0 ? '+' : '') + Number(f.intent_signal).toFixed(1);
    $('#iv-gauge').innerHTML = gauge(m.angle ?? 0);
    const words = $('.iv-words');
    if (words) words.textContent = pullWords(f);
    $('#iv-ranges').innerHTML = `
      <div class="range-row inspect-only"><span>How big a moment<small class="mword">magnitude</small></span><div class="track"><em style="left:${at(m.magnitude ?? 0, lo, hi)}%"></em></div><b>${(m.magnitude ?? 0).toFixed(1)}</b></div>
      <div class="range-labels inspect-only"><small>${lo.toFixed(1)} smallest</small><small>line length</small><small>biggest ${hi.toFixed(1)}</small></div>
      <div class="range-row inspect-only"><span>Pull toward your ending<small class="mword">direction</small></span><div class="track mid"><em style="left:${at(dir, -1, 1)}%"></em></div><b>${dir >= 0 ? '+' : ''}${dir.toFixed(2)}</b></div>
      <div class="range-labels inspect-only"><small>−1 away</small><small>line at ${heading(f).toFixed(0)}°</small><small>toward +1</small></div>
      <div class="range-row inspect-only"><span>Off course<small class="mword">terminancy</small></span><div class="track"><i style="width:${Math.min(100, 100 * (m.terminancy ?? 0))}%" class="${(m.terminancy ?? 0) > thr ? 'over' : ''}"></i><u style="left:${100 * thr}%"></u></div><b>${(m.terminancy ?? 0).toFixed(2)}</b></div>
      <div class="range-labels inspect-only"><small>0 on course</small><small>flag at ${thr.toFixed(2)}</small><small>1 drifting</small></div>`;
  }

  // Semicircle gauge for the Constitution's angle: 0° aligned … 180° contradiction.
  function gauge(angle) {
    const a = Math.max(0, Math.min(180, angle));
    const rad = (a * Math.PI) / 180;
    const x = 60 + 46 * Math.cos(rad);
    const y = 56 - 46 * Math.sin(rad);
    const color = a < 60 ? '#4a8c6a' : a < 120 ? '#e8b547' : '#e06464';
    return `<svg viewBox="0 0 120 64" class="gauge" role="img" aria-label="Direction angle ${a.toFixed(0)} degrees">
      <path d="M14 56 A46 46 0 0 1 106 56" fill="none" stroke="var(--border2-solid)" stroke-width="8" stroke-linecap="round"/>
      <line x1="60" y1="56" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="60" cy="56" r="4" fill="${color}"/>
      <text x="106" y="63" text-anchor="end" class="g-l">0°</text><text x="14" y="63" text-anchor="start" class="g-l">180°</text>
      <text x="60" y="40" text-anchor="middle" class="g-v">${a.toFixed(0)}°</text>
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

  function selectFootstep(id) {
    selectedId = id;
    renderDetail();
    renderModifier();
    if (network && fsById(id)?.thread !== 'archived') network.selectNodes([id]);
    $('#drawer').hidden = false;
    if (inspecting()) showTab('footstep');
  }

  function closeDrawer() {
    selectedId = null;
    network?.unselectAll();
    if (inspecting()) {
      renderDetail();
      renderModifier();
    } else $('#drawer').hidden = true;
  }

  // Inspect docks the moment's pane in the right column as its first tab;
  // Write floats it as a drawer over the map.
  function placeDrawer() {
    const d = $('#drawer');
    if (inspecting()) {
      $('#panel-footstep').appendChild(d);
      d.classList.add('docked');
      d.hidden = false;
      showTab('footstep');
    } else {
      $('.layout').appendChild(d);
      d.classList.remove('docked');
      d.hidden = !selectedId;
      if ($('.tab.active')?.dataset.tab === 'footstep') showTab('notes');
    }
  }

  function inspecting() {
    return document.body.classList.contains('mode-inspect');
  }

  // Write: calm, for writing. Inspect: numbers, sliders and the threshold.
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
    recognizer.onresult = (e) => {
      let finalText = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript + ' ';
        else interim += r[0].transcript;
      }
      $('#transcript').value = baseText + finalText + interim;
    };
    recognizer.onerror = (e) => setStatus('Mic error: ' + e.error + (e.error === 'not-allowed' ? '. Allow microphone access in your browser.' : ''), 'warn');
    recognizer.onend = () => {
      listening = false;
      $('#mic').classList.remove('live');
      $('#mic-label').textContent = 'Speak';
      if ($('#transcript').value.trim()) setStatus('Got it. Fix any words if needed, then press Add to Journey.');
    };
    recognizer.start();
    listening = true;
    $('#mic').classList.add('live');
    $('#mic-label').textContent = 'Listening… tap to stop';
    setStatus('Listening. Speak your story the way you think it.');
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
      setStatus(e.message || String(e), 'err');
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

  // Apply an edit to one of the Footstep's text parameters, then re-score.
  function editFootstep(f, field, value) {
    const lines = (v) => v.split('\n').map((s) => s.trim()).filter(Boolean);
    if (field === 'event') f.event = value.trim() || f.event;
    if (field === 'context') f.context = value.trim();
    if (field === 'subjects') {
      f.subjects = value.split(',').map((s) => s.trim()).filter(Boolean);
      f.subjects.forEach(ensureCharacter);
    }
    if (field === 'promises') f.promises = lines(value);
    if (field === 'world_rules') f.world_rules = lines(value);
    // Not behind the busy lock: a blur from clicking another button fires this
    // change, and that button's own action must still run.
    return (async () => {
      if (['event', 'context', 'subjects'].includes(field)) await reembed(f);
      rescoreAll();
      flagIfHeavy(f);
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
        if (listening) recognizer.stop();
        const text = $('#transcript').value;
        if (!text.trim()) return setStatus('Speak or type a story idea first.', 'warn');
        setStatus(LLM.hasKey() ? 'Understanding where this goes in your story…' : 'Structuring (offline mode)…');
        await addThought(text, null, $('#place').value);
        $('#transcript').value = '';
        $('#place').value = 'AUTO';
      })
    );
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
        save();
        renderAll();
      });
    });
    // Outlines follow the slider live; the drift check runs on release.
    $('#threshold').addEventListener('input', (e) => {
      journey.threshold = Number(e.target.value);
      $('#threshold-val').textContent = journey.threshold.toFixed(2);
      rescoreAll();
      renderGraph();
      renderStats();
    });
    $('#threshold').addEventListener('change', () => {
      rescoreAll();
      checkDrift();
      save();
      renderAll();
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
      if (t.hasAttribute('data-drift')) showTab('notes');
      else if (t.hasAttribute('data-drawer-close')) closeDrawer();
      else if (t.dataset.act) resolveAlert(t.dataset.a, t.dataset.act);
      else if (t.dataset.goto) {
        e.preventDefault();
        selectFootstep(t.dataset.goto);
      } else if (t.dataset.move && f) {
        f.thread = t.dataset.move;
        journey.alerts.filter((a) => a.fsId === f.id && a.kind === 'terminancy').forEach((a) => (a.open = false));
        run(async () => {
          await relabelStages(false);
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
        setStatus('Your next idea will go right after ' + t.dataset.placeAfter + '. Speak or type it now.');
      } else if (t.hasAttribute('data-split') && f) {
        run(() => splitFootstep(f.id));
      } else if (t.hasAttribute('data-delete') && f) {
        if (!confirm(`Delete ${f.id}? This cannot be undone.`)) return;
        removeFootstep(f.id);
        run(async () => {
          await relabelStages(false);
          save();
          renderAll();
        });
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
    $('#characters').addEventListener('change', (e) => {
      const c = charView && character(charView);
      if (!c || !e.target.classList.contains('trait-level')) return;
      c.traits[e.target.dataset.ti].level = e.target.value;
      save();
    });
    $('#characters').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      const c = charView && character(charView);
      if (e.target.classList.contains('add-char')) {
        ensureCharacter(text);
        charView = text;
      } else if (e.target.classList.contains('add-trait') && c) c.traits.push({ text, level: 'strict' });
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
      const from = e.target.elements.from?.value;
      if (!f || !from) return;
      journey.edges.push({ from, to: f.id, type: e.target.elements.type.value });
      save();
      renderGraph();
      renderDetail();
    });

    // intent vector sliders: live readouts while dragging, graph on release
    $('#modifier').addEventListener('input', (e) => {
      const f = fsById(selectedId);
      if (!f || !e.target.dataset.iv) return;
      f[e.target.dataset.iv] = Number(e.target.value);
      rescoreAll();
      updateReadouts(f);
    });
    $('#modifier').addEventListener('change', (e) => {
      if (!e.target.dataset.iv) return;
      save();
      renderGraph();
      renderStats();
      renderDetail();
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
          const j = normalize(JSON.parse(txt));
          if (!j) throw new Error('That file is not a Kahyo Journey.');
          journey = { ...j, id: uid(), embedder: null };
          await ensureEmbedder();
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
    $('#theme-btn').addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
    $('#settings-btn').addEventListener('click', openSettings);
    $('#m-settings').addEventListener('click', openSettings);
    $('#settings-save').addEventListener('click', () => {
      saveSettings({ apiKey: $('#api-key').value.trim(), model: $('#model').value.trim() });
      $('#settings').close();
      renderBadge();
      if (!journey) return;
      run(async () => {
        await ensureEmbedder();
        rescoreAll();
        save();
        renderAll();
        setStatus(LLM.hasKey() ? 'Gemini connected. Kahyo will now extract Footsteps with AI.' : 'Offline mode. Footsteps are split by sentence.', 'ok');
      });
    });
    $('#settings-clear').addEventListener('click', () => {
      $('#api-key').value = '';
    });
  }

  function openSettings() {
    const s = LLM.settings();
    $('#api-key').value = s.apiKey || '';
    $('#model').value = s.model && !/gemini-2\./.test(s.model) ? s.model : '';
    $('#settings').showModal();
  }

  // ---------- init ----------

  function init() {
    migrate();
    $('#legend').innerHTML =
      '<span class="legend-geo">Line angle = direction · line length = magnitude · circle size = data · click a link to delete it</span>' +
      Object.values(EDGE_TYPES)
        .map((t) => `<span><i style="background:${t.color}"></i>${t.label}</span>`)
        .join('') +
      '<span><i class="ring over"></i>Past threshold</span><span><i class="ring branch"></i>Branch</span><span><i class="ring heavy"></i>Heavy, split it</span><span><i class="ring broken"></i>Trait break</span>';
    if (!SR) $('#mic-note').textContent = 'Voice needs Chrome or Edge. Typing works everywhere.';
    let mode = 'write';
    try {
      mode = localStorage.getItem('kahyo.mode') || 'write';
    } catch {}
    setMode(mode);
    bind();
    route();
    document.fonts?.ready.then(() => journey && renderGraph());
  }

  document.addEventListener('DOMContentLoaded', init);
})();
