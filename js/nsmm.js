// The browser side of the ThoughtSense Engine. The maths runs on Kahyo's server
// (the Cloudflare Worker); this file only names the stages, keeps the offline
// word vectors, and asks the server to score a Journey.

(function (root) {
  const STAGES = ['Origin', 'Pandiculation', 'Maxspan', 'Convergence', 'Conclusion'];
  // Older Journeys and models may still say Climax.
  const STAGE_ALIASES = { Climax: 'Conclusion' };
  const stageName = (s) => STAGE_ALIASES[s] || s;

  const DEFAULT_PLANNED_LENGTH = 60;
  const DEFAULT_BRANCH_SHARE = 0.45;

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

  // Vectors go to the server rounded: smaller requests, same results.
  const slim = (e) => (Array.isArray(e) ? e.map((x) => Math.round(x * 1e5) / 1e5) : null);

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

  // journey: { footsteps: [...with pathStart], tf, plannedLength, branchShare, stage } → { metrics: {id: …}, info }
  function score(j) {
    return call({
      op: 'score',
      tf: j.tf,
      plannedLength: j.plannedLength,
      branchShare: j.branchShare,
      stage: j.stage,
      footsteps: j.footsteps.map((f) => ({
        id: f.id,
        thread: f.thread,
        stage: f.stage,
        pathStart: f.pathStart,
        event: f.event,
        context: f.context,
        subjects: f.subjects,
        promises: f.promises,
        environment: f.environment,
        intensity: f.intensity,
        embedding: slim(f.embedding),
      })),
    });
  }

  // → { after: how many main Footsteps before stages are labelled, labels: by position }
  function stages(count, plannedLength) {
    return call({ op: 'stages', count, plannedLength });
  }

  root.NSMM = { STAGES, stageName, DEFAULT_PLANNED_LENGTH, DEFAULT_BRANCH_SHARE, monotonicStages, localEmbedding, score, stages };
})(window);
