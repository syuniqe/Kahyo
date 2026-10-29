// The browser side of the ThoughtSense Engine. The maths runs on Kahyo's server
// (the Cloudflare Worker); this file only names the stages, keeps the offline
// word vectors, and asks the server to score a Journey.

(function (root) {
  const STAGES = ['Origin', 'Pandiculation', 'Maxspan', 'Convergence', 'Conclusion'];
  // Older Journeys and models may still say Climax.
  const STAGE_ALIASES = { Climax: 'Conclusion' };
  const stageName = (s) => STAGE_ALIASES[s] || s;

  const DEFAULT_PLANNED_LENGTH = 60;

  // Keeps stage labels in story order: a stage never goes back to an earlier one.
  function monotonicStages(labels) {
    let best = 0;
    return labels.map((s) => {
      const i = STAGES.indexOf(stageName(s));
      if (i > best) best = i;
      return STAGES[best];
    });
  }

  // Offline word vectors for when no embedding key is set: hashed bag of word stems.
  const STOP = new Set(
    'a an the and or but of to in on at for with from by as is was were be been are it its this that these those he she they them his her their i we you our your then than so into over under out up down not no yes just very can will would could should has have had do does did who whom what when where why how there here all any some'.split(
      ' '
    )
  );
  const FILLER = new Set('um uh umm hmm like basically yeah okay ok actually really literally kind sort know mean well right also again'.split(' '));

  function localEmbedding(text, dim = 256) {
    const v = new Array(dim).fill(0);
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !FILLER.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, ''))
      .forEach((w) => {
        let h = 2166136261;
        for (let i = 0; i < w.length; i++) {
          h ^= w.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        v[Math.abs(h) % dim] += h & 1 ? 1 : -1;
      });
    const n = Math.hypot(...v) || 1;
    return v.map((x) => x / n);
  }

  // Vectors go to the server as base64 float32: a third of the size, same results.
  function pack(e) {
    if (!Array.isArray(e) || !e.length) return null;
    const bytes = new Uint8Array(Float32Array.from(e).buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function call(body) {
    let res;
    try {
      res = await fetch('/api/engine', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error('Kahyo could not reach its server. Check your connection; your Journey is saved in this browser.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Kahyo's server said ${res.status}.`);
    return data;
  }

  // What the server needs from each Footstep, packed once per change.
  const packed = new WeakMap();
  function wire(f) {
    const e = packed.get(f.embedding || f);
    const e64 = e !== undefined ? e : pack(f.embedding);
    if (e === undefined) packed.set(f.embedding || f, e64);
    return {
      id: f.id,
      thread: f.thread,
      stage: f.stage || null,
      pathStart: f.pathStart || null,
      event: f.event,
      context: f.context || '',
      subjects: f.subjects || [],
      promises: f.promises || [],
      environment: f.environment || [],
      intensity: Number.isFinite(f.intensity) ? f.intensity : null,
      e64,
    };
  }

  // Only Footsteps from the first one that changed since the last score are re-scored;
  // the ones before it just rebuild the thread on the server.
  const lastSent = new WeakMap();
  const pick = (m) => ({ direction: m.direction, magnitude: m.magnitude, judged: m.judged, usual: m.usual, pathDirection: m.pathDirection });
  // j: { footsteps: [...with pathStart], tf, plannedLength, stage } → { metrics: {id: …}, info }
  async function score(j, { full = false } = {}) {
    const items = j.footsteps.map(wire);
    // A stage change only moves the limit, which the server redoes anyway, so it is left out.
    const sig = items.map(({ stage, ...x }) => JSON.stringify(x));
    const key = j.key || j;
    const prev = lastSent.get(key);
    // The factors (TF, planned length) only change statuses, which the
    // server redoes for every Footstep, so they never force a full re-score.
    let from = 0;
    if (!full && prev) {
      while (from < sig.length && from < prev.sig.length && sig[from] === prev.sig[from] && j.footsteps[from].metrics && 'usual' in j.footsteps[from].metrics) from++;
    }
    const out = await call({
      op: 'score',
      tf: j.tf,
      plannedLength: j.plannedLength,
      stage: j.stage,
      from,
      footsteps: items.map((x, i) => (i < from ? { ...x, known: pick(j.footsteps[i].metrics) } : x)),
    });
    lastSent.set(key, { sig });
    return out;
  }

  // → { after: how many main Footsteps before stages are labelled, labels: by position }
  function stages(count, plannedLength) {
    return call({ op: 'stages', count, plannedLength });
  }

  root.NSMM = { STAGES, stageName, DEFAULT_PLANNED_LENGTH, monotonicStages, localEmbedding, score, stages };
})(window);
