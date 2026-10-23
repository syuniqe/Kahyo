// Kahyo demo app: voice → Footsteps → Journey graph → continuity checks → draft.

(function () {
  const $ = (sel) => document.querySelector(sel);
  const STORE_KEY = 'kahyo.journey';
  const EDGE_TYPES = {
    causal: { label: 'Causal', color: '#c9a84c' },
    temporal: { label: 'Story order', color: '#7a7a8e' },
    character_arc: { label: 'Character arc', color: '#6db3e0' },
    setup_resolution: { label: 'Setup → resolution', color: '#4a8c6a' },
    thematic: { label: 'Thematic', color: '#b07ad4' },
  };

  let journey = load() || newJourney();
  let network = null;
  let selectedId = null;
  let busy = false;

  // ---------- persistence ----------

  function newJourney(title = 'Untitled Journey') {
    return {
      title,
      stage: 'Origin',
      threshold: NSMM.DEFAULT_THRESHOLD,
      embedder: null,
      footsteps: [],
      edges: [],
      characters: [],
      alerts: [],
      draft: '',
      order: [],
      nextId: 1,
    };
  }

  function load() {
    try {
      const j = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!j || !Array.isArray(j.footsteps)) return null;
      if (!Array.isArray(j.order)) j.order = j.footsteps.filter((f) => f.thread === 'main').map((f) => f.id);
      return j;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(journey));
    } catch (e) {
      console.warn('Could not save journey', e);
    }
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

  function fsText(f) {
    return [f.event, f.context, (f.subjects || []).join(', ')].filter(Boolean).join('. ');
  }

  function setStatus(msg, kind = '') {
    const el = $('#status');
    el.textContent = msg;
    el.className = 'status ' + kind;
  }

  function character(name) {
    return journey.characters.find((c) => c.name.toLowerCase() === String(name).toLowerCase());
  }

  function ensureCharacter(name) {
    if (!name) return null;
    let c = character(name);
    if (!c) {
      c = { name, traits: [] };
      journey.characters.push(c);
    }
    return c;
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
  "violations": [{"footstep": "NEW1", "character": "name", "trait": "exact existing trait text", "severity": "soft|hard", "suggestion": "how the writer could fix or justify it"}]
}`;

  function extractPrompt(transcript) {
    const recent = [
      ...mainInOrder().map((f, i) => `${i + 1}. ${f.id}: ${f.event}`),
      ...journey.footsteps.filter((f) => f.thread === 'branch').map((f) => `   (side branch) ${f.id}: ${f.event}`),
    ]
      .slice(-60)
      .join('\n');
    const traits = journey.characters
      .flatMap((c) => c.traits.filter((t) => t.level !== 'off').map((t) => `- ${c.name}: "${t.text}" (${t.level})`))
      .join('\n');
    return `You are the extraction layer of Kahyo, a voice-first storytelling system based on the Narrative Storyline Mapping Model (NSMM).
A writer just spoke a fragment of their story out loud. Split it into Footsteps: atomic story moments, each one meaningful advancement. Usually 1-4 per fragment. Ignore filler ("um", "so basically").
Writers speak out of order. Decide where the new moments belong in the story's timeline and set place_after. Use END unless the writer signals otherwise (e.g. "before the king...", "earlier,", "at the start", "back in step 2"). Use the context of the story so far to understand pronouns and references.
Link each new Footstep to earlier ones with typed seeds only when there is a real causal, character-arc, setup-resolution or thematic relationship. Story order is tracked separately, so do not add temporal seeds.
Check every new Footstep against the character traits below. Report a violation only when a character clearly acts against a trait. Use "hard" for strict traits.
Only report new_traits the writer explicitly states about a character's lasting nature.

Journey: ${journey.title}
Current stage: ${journey.stage}
Main thread in story order (oldest first):
${recent || '(none yet)'}

Character traits:
${traits || '(none yet)'}

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
      footsteps: sentences.map((s, i) => {
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
        stage_created: journey.stage,
        created_at: Date.now(),
        transcript,
        embedding: vecs[i],
        thread: 'main',
        violations: [],
      };
      if (LLM.hasKey() || preExtracted) fs.subjects.forEach(ensureCharacter);

      const prior = journey.footsteps.filter((f) => f.thread === 'main');
      fs.metrics = NSMM.scoreFootstep(fs, prior, journey.stage, journey.threshold);
      journey.footsteps.push(fs);

      const seeds = (raw.seeds || [])
        .map((s) => ({ from: resolve(s.target), type: EDGE_TYPES[s.type] ? s.type : 'causal' }))
        .filter((s) => s.from && s.from !== fs.id && s.type !== 'temporal');
      seeds.forEach((s) => journey.edges.push({ from: s.from, to: fs.id, type: s.type }));

      // Pruning waits until the Journey has a direction to measure against: not in
      // Origin, not before three main moments, and offline (weak embeddings) only
      // when the writer signals a what-if. An explicit what-if can branch any time.
      const mainCount = storyOrder().length;
      const reliable = LLM.hasKey() || Boolean(preExtracted);
      const canBranch =
        (fs.intent_signal < 0 && mainCount >= 1) || (reliable && journey.stage !== 'Origin' && mainCount >= 3);
      fs.metrics.is_branch_candidate = fs.metrics.is_branch_candidate && canBranch;

      if (fs.metrics.is_branch_candidate) {
        fs.thread = 'branch';
        // A branch hangs off the moment it grew from.
        const root = anchor === 'END' ? storyOrder()[storyOrder().length - 1] : anchor === 'START' ? storyOrder()[0] : anchor;
        if (!seeds.length && root) journey.edges.push({ from: root, to: fs.id, type: 'temporal' });
      } else {
        placeInOrder(fs.id, anchor);
        anchor = fs.id;
      }

      if (fs.metrics.is_branch_candidate) {
        journey.alerts.unshift({
          id: 'a' + Date.now() + i,
          kind: 'terminancy',
          fsId: fs.id,
          text: `${fs.id} drifts from the Journey's intent (terminancy ${fs.metrics.terminancy.toFixed(2)} > ${journey.threshold}). Kahyo moved it to a branch.`,
          open: true,
        });
      } else if (fs.metrics.contradiction_review) {
        journey.alerts.unshift({
          id: 'a' + Date.now() + i,
          kind: 'contradiction',
          fsId: fs.id,
          text: `${fs.id} points ${fs.metrics.angle.toFixed(0)}° away from the Journey, which suggests it contradicts what came before.`,
          open: true,
        });
      }
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
        id: 'a' + Date.now() + Math.random().toString(36).slice(2, 6),
        kind: 'trait',
        fsId: fs.id,
        character: c.name,
        trait: trait.text,
        severity,
        text: `${c.name} breaks "${trait.text}" in ${fs.id}.`,
        suggestion: v.suggestion || '',
        open: true,
      });
    });

    advanceStage();
    save();
    renderAll();
    selectFootstep(newIds[newIds.length - 1]);
    const flagged = journey.alerts.filter((a) => a.open && newIds.includes(a.fsId)).length;
    if (flagged) showTab('alerts');
    setStatus(`Added ${items.length} Footstep${items.length > 1 ? 's' : ''}${flagged ? `, ${flagged} need${flagged > 1 ? '' : 's'} your attention` : ''}.`, flagged ? 'warn' : 'ok');
  }

  // Simple Journey Mapping rail: the stage follows the Journey's size unless
  // the writer sets it by hand.
  function advanceStage() {
    if (journey.stageLocked) return;
    const n = journey.footsteps.filter((f) => f.thread === 'main').length;
    const idx = n >= 40 ? 3 : n >= 20 ? 2 : n >= 4 ? 1 : 0;
    if (NSMM.STAGES.indexOf(journey.stage) < idx) journey.stage = NSMM.STAGES[idx];
  }

  // Re-score every Footstep in order (after a threshold change or edit).
  function rescoreAll() {
    const prior = [];
    journey.footsteps.forEach((f) => {
      f.metrics = NSMM.scoreFootstep(f, prior, f.stage_created || journey.stage, journey.threshold);
      if (f.thread === 'main') prior.push(f);
    });
  }

  // ---------- alert actions ----------

  function resolveAlert(alertId, action) {
    const a = journey.alerts.find((x) => x.id === alertId);
    if (!a) return;
    const fs = fsById(a.fsId);
    if (action === 'keep' && fs) {
      fs.thread = 'main';
      const from = journey.edges.find((e) => e.to === fs.id && storyOrder().includes(e.from));
      placeInOrder(fs.id, from ? from.from : 'END');
    }
    if (action === 'archive' && fs) fs.thread = 'archived';
    if (action === 'relax') {
      const t = character(a.character)?.traits.find((x) => x.text === a.trait);
      if (t) t.level = 'flexible';
    }
    if (action === 'remove' && fs) {
      journey.footsteps = journey.footsteps.filter((f) => f.id !== fs.id);
      journey.edges = journey.edges.filter((e) => e.from !== fs.id && e.to !== fs.id);
      journey.alerts.filter((x) => x.fsId === fs.id).forEach((x) => (x.open = false));
      if (selectedId === fs.id) selectedId = null;
    }
    a.open = false;
    a.resolution = action;
    save();
    renderAll();
  }

  // ---------- draft ----------

  async function renderDraft() {
    const main = mainInOrder();
    if (!main.length) return setStatus('Add some Footsteps first.', 'warn');
    if (!LLM.hasKey()) {
      journey.draft =
        `# ${journey.title}\n\n_Outline from the main thread. Add a free Gemini key in Settings to render full prose._\n\n` +
        main.map((f, i) => `${i + 1}. **${f.event}**${f.context ? ` (${f.context})` : ''}`).join('\n');
    } else {
      setStatus('Rendering draft from the main thread…');
      const traits = journey.characters.flatMap((c) => c.traits.filter((t) => t.level !== 'off').map((t) => `${c.name}: ${t.text}`)).join('\n');
      journey.draft = await LLM.generateText(
        `Write the opening draft of "${journey.title}" as polished literary prose, following these story moments in order. Stay faithful to them; do not add major plot events. Keep characters consistent with their traits. Use Markdown with a title and section breaks. Length: roughly 150-250 words per moment.\n\nTraits:\n${traits || '(none)'}\n\nMoments:\n` +
          main.map((f, i) => `${i + 1}. ${f.event}${f.context ? ` [${f.context}]` : ''}`).join('\n')
      );
    }
    save();
    renderDraftPanel();
    showTab('draft');
    setStatus('Draft ready.', 'ok');
  }

  // ---------- rendering ----------

  function renderAll() {
    $('#journey-title').value = journey.title;
    $('#stage').value = journey.stage;
    $('#threshold').value = journey.threshold;
    $('#threshold-val').textContent = Number(journey.threshold).toFixed(2);
    renderGraph();
    renderStats();
    renderCharacters();
    renderAlerts();
    renderDetail();
    renderDraftPanel();
    $('#mode-badge').textContent = LLM.hasKey() ? 'Gemini' : 'Offline mode';
    $('#mode-badge').className = 'badge ' + (LLM.hasKey() ? 'on' : 'off');
  }

  function renderGraph() {
    const visible = journey.footsteps.filter((f) => f.thread !== 'archived');
    const empty = $('#graph-empty');
    empty.hidden = visible.length > 0;
    const mags = visible.map((f) => f.metrics?.magnitude || 1);
    const maxMag = Math.max(1, ...mags);
    const nodes = visible.map((f) => {
      const hasViolation = f.violations?.some((v) => v);
      const branch = f.thread === 'branch';
      return {
        id: f.id,
        label: f.id + '\n' + (f.event.length > 26 ? f.event.slice(0, 24) + '…' : f.event),
        title: f.event,
        value: 8 + 22 * ((f.metrics?.magnitude || 1) / maxMag),
        shape: 'dot',
        color: {
          background: branch ? '#3a2a12' : hasViolation ? '#3a1616' : '#1c1c30',
          border: branch ? '#d4720a' : hasViolation ? '#e06464' : '#c9a84c',
          highlight: { background: '#2a2a48', border: '#e8c96a' },
        },
        borderWidth: hasViolation || branch ? 3 : 2,
        shapeProperties: { borderDashes: branch ? [6, 4] : false },
        font: { color: '#f0ebe0', size: 12, face: 'Inter, system-ui, sans-serif', multi: false },
      };
    });
    const ids = new Set(visible.map((f) => f.id));
    const order = storyOrder();
    const level = {};
    order.forEach((id, i) => (level[id] = i));
    // Story spine: consecutive main-thread moments, in story order.
    const spine = order.slice(1).map((id, i) => ({ from: order[i], to: id, type: 'temporal' }));
    const typed = journey.edges.filter((e) => !(e.type === 'temporal' && level[e.from] !== undefined && level[e.to] !== undefined));
    // Branches sit one step to the right of the moment they grew from, off the spine.
    visible.forEach((f) => {
      if (level[f.id] !== undefined) return;
      const src = journey.edges.find((e) => e.to === f.id && level[e.from] !== undefined);
      level[f.id] = src ? level[src.from] + 1 : order.length;
    });
    nodes.forEach((n) => (n.level = level[n.id] ?? 0));
    const edges = [...spine, ...typed]
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e, i) => ({
        id: 'e' + i,
        from: e.from,
        to: e.to,
        arrows: 'to',
        color: { color: EDGE_TYPES[e.type]?.color || '#888', opacity: 0.85 },
        dashes: e.type === 'thematic',
        title: EDGE_TYPES[e.type]?.label,
        width: e.type === 'temporal' ? 2.5 : e.type === 'causal' || e.type === 'setup_resolution' ? 2 : 1.2,
        smooth: e.type === 'temporal' ? false : { type: 'curvedCW', roundness: 0.35 },
      }));

    if (typeof vis === 'undefined') {
      $('#graph').innerHTML = '<p class="muted pad">Graph library failed to load.</p>';
      return;
    }
    const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };
    if (!network) {
      network = new vis.Network($('#graph'), data, {
        layout: { hierarchical: { enabled: true, direction: 'LR', levelSeparation: 190, nodeSpacing: 130, sortMethod: 'directed', shakeTowards: 'roots' } },
        physics: false,
        nodes: { scaling: { min: 8, max: 30, label: { enabled: false } } },
        interaction: { hover: true, tooltipDelay: 150 },
      });
      network.on('click', (p) => {
        if (p.nodes.length) selectFootstep(p.nodes[0]);
      });
    } else {
      network.setData(data);
    }
    network.once('afterDrawing', () => network.fit({ animation: false }));
    renderPlaceOptions();
    if (selectedId && ids.has(selectedId)) network.selectNodes([selectedId]);
  }

  function renderPlaceOptions() {
    const sel = $('#place');
    const keep = sel.value || 'AUTO';
    const order = mainInOrder();
    sel.innerHTML =
      `<option value="AUTO">${LLM.hasKey() ? 'Let Kahyo decide' : 'At the end'}</option><option value="START">At the very start</option>` +
      order.map((f, i) => `<option value="${esc(f.id)}">After ${i + 1}. ${esc(f.event.length > 40 ? f.event.slice(0, 38) + '…' : f.event)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : 'AUTO';
  }

  function renderStats() {
    const main = journey.footsteps.filter((f) => f.thread === 'main');
    const ji = NSMM.journeyIntent(main);
    const branches = journey.footsteps.filter((f) => f.thread === 'branch').length;
    const open = journey.alerts.filter((a) => a.open).length;
    $('#stats').innerHTML = `
      <div><span>${main.length}</span>main</div>
      <div><span>${branches}</span>branch</div>
      <div><span>${ji ? ji.magnitude.toFixed(1) : '–'}</span>avg magnitude</div>
      <div><span>${ji ? (ji.direction >= 0 ? '+' : '') + ji.direction.toFixed(2) : '–'}</span>direction</div>
      <div class="${open ? 'warn' : ''}"><span>${open}</span>alerts</div>`;
    const stageIdx = NSMM.STAGES.indexOf(journey.stage);
    $('#rail').innerHTML = NSMM.STAGES.map((s, i) => `<li class="${i < stageIdx ? 'done' : i === stageIdx ? 'now' : ''}">${s}</li>`).join('');
    $('#alert-count').textContent = open ? `(${open})` : '';
  }

  function renderCharacters() {
    const el = $('#characters');
    if (!journey.characters.length) {
      el.innerHTML = '<p class="muted">Characters appear here as you speak. Add traits to have Kahyo guard their consistency.</p>';
      return;
    }
    el.innerHTML = journey.characters
      .map(
        (c, ci) => `
      <div class="char">
        <div class="char-name">${esc(c.name)}</div>
        ${c.traits
          .map(
            (t, ti) => `
          <div class="trait-row">
            <span>${esc(t.text)}</span>
            <select data-ci="${ci}" data-ti="${ti}" class="trait-level" aria-label="Enforcement level">
              ${['strict', 'moderate', 'flexible', 'off'].map((l) => `<option ${l === t.level ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>`
          )
          .join('')}
        <form class="add-trait" data-ci="${ci}">
          <input placeholder="Add trait, e.g. never abandons a friend" aria-label="New trait for ${esc(c.name)}" />
        </form>
      </div>`
      )
      .join('');
  }

  function renderAlerts() {
    const el = $('#alerts');
    const list = journey.alerts.filter((a) => a.open);
    if (!list.length) {
      el.innerHTML = '<p class="muted">No open alerts. Kahyo flags drifting ideas (Terminancy) and characters acting against their traits here.</p>';
      return;
    }
    el.innerHTML = list
      .map((a) => {
        const actions =
          a.kind === 'terminancy'
            ? `<button data-a="${a.id}" data-act="keep">Keep on main thread</button><button data-a="${a.id}" data-act="archive">Archive (decrumb)</button>`
            : a.kind === 'trait'
            ? `<button data-a="${a.id}" data-act="accept">Accept contradiction</button><button data-a="${a.id}" data-act="relax">Relax trait</button><button data-a="${a.id}" data-act="remove">Remove Footstep</button>`
            : `<button data-a="${a.id}" data-act="accept">It's intentional</button><button data-a="${a.id}" data-act="remove">Remove Footstep</button>`;
        const title = a.kind === 'terminancy' ? 'Terminancy' : a.kind === 'trait' ? `Trait break · ${a.severity}` : 'Contradiction review';
        return `<div class="alert ${a.kind} ${a.severity || ''}">
          <div class="alert-title">${title}</div>
          <p>${esc(a.text)} <a href="#" data-goto="${esc(a.fsId)}">View</a></p>
          ${a.suggestion ? `<p class="suggest">${esc(a.suggestion)}</p>` : ''}
          <div class="actions">${actions}</div>
        </div>`;
      })
      .join('');
  }

  function renderDetail() {
    const el = $('#detail');
    const f = selectedId && fsById(selectedId);
    if (!f) {
      el.innerHTML = '<p class="muted">Click a Footstep in the graph to see its packet and Intent Vector.</p>';
      return;
    }
    const m = f.metrics || {};
    const inEdges = journey.edges.filter((e) => e.to === f.id);
    const outEdges = journey.edges.filter((e) => e.from === f.id);
    const list = (arr) => (arr.length ? arr.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="muted">none</li>');
    el.innerHTML = `
      <div class="fs-head"><strong>${esc(f.id)}</strong><span class="pill ${f.thread}">${f.thread}</span><span class="pill">${esc(f.stage_created)}</span></div>
      <h3>${esc(f.event)}</h3>
      <dl>
        <dt>Subject</dt><dd>${esc((f.subjects || []).join(', ') || '—')}</dd>
        <dt>Context</dt><dd>${esc(f.context || '—')}</dd>
        <dt>Promises</dt><dd><ul>${list(f.promises || [])}</ul></dd>
        <dt>World rules</dt><dd><ul>${list(f.world_rules || [])}</ul></dd>
        <dt>Seeds</dt><dd><ul>${list([
          ...inEdges.map((e) => `← ${e.from} (${EDGE_TYPES[e.type]?.label})`),
          ...outEdges.map((e) => `→ ${e.to} (${EDGE_TYPES[e.type]?.label})`),
        ])}</ul></dd>
      </dl>
      <div class="iv">
        <div class="iv-title">Intent Vector</div>
        ${gauge(m.angle ?? 0)}
        <div class="iv-grid">
          <div><span>${(m.magnitude ?? 0).toFixed(1)}</span>magnitude</div>
          <div><span>${(m.angle ?? 0).toFixed(0)}°</span>direction angle</div>
          <div><span>${(m.direction ?? 0).toFixed(2)}</span>direction</div>
          <div class="${m.is_branch_candidate ? 'warn' : ''}"><span>${(m.terminancy ?? 0).toFixed(2)}</span>terminancy</div>
        </div>
        <p class="muted small">Plot intensity ${Number(f.plot_intensity).toFixed(1)} · intent signal ${Number(f.intent_signal).toFixed(1)} · threshold ${Number(journey.threshold).toFixed(2)}</p>
      </div>
      ${(f.violations || []).map((v) => `<div class="alert trait ${v.severity}"><div class="alert-title">Trait break · ${v.severity}</div><p>${esc(v.character)}: “${esc(v.trait)}”</p>${v.suggestion ? `<p class="suggest">${esc(v.suggestion)}</p>` : ''}</div>`).join('')}
      <details><summary>What the writer said</summary><p class="quote">${esc(f.transcript || '')}</p></details>
      <div class="actions">
        ${f.thread === 'main' ? `<button data-place-after="${esc(f.id)}">Add next idea after this</button><button data-shift="-1" aria-label="Move earlier in the story">↑ Earlier</button><button data-shift="1" aria-label="Move later in the story">↓ Later</button>` : ''}
        ${f.thread !== 'main' ? `<button data-move="main">Move to main thread</button>` : `<button data-move="branch">Move to branch</button>`}
        <button data-move="archived">Archive</button>
      </div>`;
  }

  // Semicircle gauge for the Constitution's angle: 0° aligned … 180° contradiction.
  function gauge(angle) {
    const a = Math.max(0, Math.min(180, angle));
    const rad = (a * Math.PI) / 180;
    const x = 60 + 46 * Math.cos(rad);
    const y = 56 - 46 * Math.sin(rad);
    const color = a < 60 ? '#4a8c6a' : a < 120 ? '#d4720a' : '#e06464';
    return `<svg viewBox="0 0 120 64" class="gauge" role="img" aria-label="Direction angle ${a.toFixed(0)} degrees">
      <path d="M14 56 A46 46 0 0 1 106 56" fill="none" stroke="var(--border2-solid)" stroke-width="8" stroke-linecap="round"/>
      <line x1="60" y1="56" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
      <circle cx="60" cy="56" r="4" fill="${color}"/>
      <text x="106" y="63" text-anchor="end" class="g-l">0°</text><text x="14" y="63" text-anchor="start" class="g-l">180°</text>
    </svg>`;
  }

  function renderDraftPanel() {
    const el = $('#draft');
    if (!journey.draft) {
      el.innerHTML = '<p class="muted">Press <strong>Render draft</strong> to turn the main thread into prose. Branches and archived Footsteps are left out.</p>';
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
          return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
        }
        return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
      })
      .join('');
  }

  function selectFootstep(id) {
    selectedId = id;
    renderDetail();
    if (network && fsById(id)?.thread !== 'archived') {
      network.selectNodes([id]);
    }
    showTab('footstep');
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
      if ($('#transcript').value.trim()) setStatus('Got it. Edit if needed, then press Add to Journey.');
    };
    recognizer.start();
    listening = true;
    $('#mic').classList.add('live');
    $('#mic-label').textContent = 'Listening… tap to stop';
    setStatus('Listening. Speak your story the way you think it.');
  }

  // ---------- events ----------

  async function run(fn) {
    if (busy) return;
    busy = true;
    document.body.classList.add('busy');
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setStatus(e.message || String(e), 'err');
    } finally {
      busy = false;
      document.body.classList.remove('busy');
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

  async function loadSample() {
    const S = window.KAHYO_SAMPLE;
    journey = newJourney(S.title);
    journey.stage = S.stage;
    journey.stageLocked = true;
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
    showTab('alerts');
    setStatus('Loaded the sample Journey. Resolve the alerts, or click any Footstep.', 'ok');
  }

  function bind() {
    $('#mic').addEventListener('click', toggleMic);
    $('#add').addEventListener('click', () =>
      run(async () => {
        if (listening) recognizer.stop();
        const text = $('#transcript').value;
        if (!text.trim()) return setStatus('Speak or type a story idea first.', 'warn');
        setStatus(LLM.hasKey() ? 'Structuring your thought into Footsteps…' : 'Structuring (offline mode)…');
        await addThought(text, null, $('#place').value);
        $('#transcript').value = '';
        $('#place').value = 'AUTO';
      })
    );
    $('#transcript').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('#add').click();
    });
    $('#render').addEventListener('click', () => run(renderDraft));
    $('#journey-title').addEventListener('change', (e) => {
      journey.title = e.target.value.trim() || 'Untitled Journey';
      save();
    });
    $('#stage').addEventListener('change', (e) => {
      journey.stage = e.target.value;
      journey.stageLocked = true;
      save();
      renderStats();
    });
    $('#threshold').addEventListener('input', (e) => {
      journey.threshold = Number(e.target.value);
      $('#threshold-val').textContent = journey.threshold.toFixed(2);
    });
    $('#threshold').addEventListener('change', () => {
      rescoreAll();
      save();
      renderAll();
    });

    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    document.body.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act],[data-goto],[data-move],[data-shift],[data-place-after],#copy-draft,#dl-draft');
      if (!t) return;
      if (t.dataset.act) resolveAlert(t.dataset.a, t.dataset.act);
      else if (t.dataset.goto) {
        e.preventDefault();
        selectFootstep(t.dataset.goto);
      } else if (t.dataset.move) {
        const f = fsById(selectedId);
        if (f) {
          f.thread = t.dataset.move;
          journey.alerts.filter((a) => a.fsId === f.id && a.kind === 'terminancy').forEach((a) => (a.open = false));
          save();
          renderAll();
        }
      } else if (t.dataset.shift) {
        moveInOrder(selectedId, Number(t.dataset.shift));
        save();
        renderAll();
      } else if (t.dataset.placeAfter) {
        $('#place').value = t.dataset.placeAfter;
        $('#transcript').focus();
        setStatus('Your next idea will go right after ' + t.dataset.placeAfter + '. Speak or type it now.');
      } else if (t.id === 'copy-draft') {
        navigator.clipboard?.writeText(journey.draft).then(() => setStatus('Draft copied.', 'ok'));
      } else if (t.id === 'dl-draft') {
        download(slug() + '.md', journey.draft, 'text/markdown');
      }
    });

    $('#characters').addEventListener('change', (e) => {
      if (!e.target.classList.contains('trait-level')) return;
      journey.characters[e.target.dataset.ci].traits[e.target.dataset.ti].level = e.target.value;
      save();
    });
    $('#characters').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      const text = input.value.trim();
      if (!text) return;
      journey.characters[e.target.dataset.ci].traits.push({ text, level: 'strict' });
      save();
      renderCharacters();
    });
    $('#add-char').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = e.target.querySelector('input');
      if (input.value.trim()) ensureCharacter(input.value.trim());
      input.value = '';
      save();
      renderCharacters();
    });

    // menu
    $('#menu-btn').addEventListener('click', () => $('#menu').toggleAttribute('hidden'));
    $('#menu').addEventListener('click', (e) => {
      if (e.target.closest('button')) $('#menu').hidden = true;
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#menu, #menu-btn')) $('#menu').hidden = true;
    });
    $('#m-new').addEventListener('click', () => {
      if (journey.footsteps.length && !confirm('Start a new Journey? The current one will be replaced. Export it first if you want to keep it.')) return;
      journey = newJourney();
      selectedId = null;
      save();
      renderAll();
      setStatus('New Journey. Press Speak and tell your story.');
    });
    $('#m-sample').addEventListener('click', () => {
      if (journey.footsteps.length && !confirm('Load the sample Journey? The current one will be replaced.')) return;
      run(loadSample);
    });
    $('#m-export').addEventListener('click', () => {
      const out = { ...journey, footsteps: journey.footsteps.map(({ embedding, ...f }) => f) };
      download(slug() + '.kahyo.json', JSON.stringify(out, null, 2), 'application/json');
    });
    $('#m-import').addEventListener('click', () => $('#import-file').click());
    $('#import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) =>
        run(async () => {
          const j = JSON.parse(txt);
          if (!Array.isArray(j.footsteps)) throw new Error('That file is not a Kahyo Journey.');
          journey = { ...newJourney(), ...j, embedder: null };
          await ensureEmbedder();
          rescoreAll();
          save();
          selectedId = null;
          renderAll();
          setStatus('Imported ' + journey.title + '.', 'ok');
        })
      );
      e.target.value = '';
    });

    // settings
    $('#settings-btn').addEventListener('click', openSettings);
    $('#m-settings').addEventListener('click', openSettings);
    $('#settings-save').addEventListener('click', () => {
      saveSettings({ apiKey: $('#api-key').value.trim(), model: $('#model').value.trim() || 'gemini-2.5-flash' });
      $('#settings').close();
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
    $('#model').value = s.model || 'gemini-2.5-flash';
    $('#settings').showModal();
  }

  // ---------- init ----------

  function init() {
    $('#stage').innerHTML = NSMM.STAGES.map((s) => `<option>${s}</option>`).join('');
    $('#legend').innerHTML =
      Object.values(EDGE_TYPES)
        .map((t) => `<span><i style="background:${t.color}"></i>${t.label}</span>`)
        .join('') + '<span><i class="ring branch"></i>Branch</span><span><i class="ring broken"></i>Trait break</span>';
    if (!SR) $('#mic-note').textContent = 'Voice needs Chrome or Edge. Typing works everywhere.';
    bind();
    renderAll();
    if (!journey.footsteps.length) setStatus('Press Speak and tell your story, or load the sample from the menu.');
    else setStatus('Welcome back to ' + journey.title + '.');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
