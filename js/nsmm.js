// NSMM math: Intent Vector, Journey aggregation, Terminancy distance.
// Formulas follow the NSMM Technical Documentation (sections 03 and 05).
// Works in the browser (window.NSMM) and in Node (module.exports) for tests.

(function (root) {
  const STAGES = ['Origin', 'Pandiculation', 'Maxspan', 'Convergence', 'Climax'];

  const STAGE_MULTIPLIER = {
    Origin: 0.6,
    Pandiculation: 1.0,
    Maxspan: 1.2,
    Convergence: 1.5,
    Climax: 2.0,
  };

  const SLOT_WEIGHTS = { plot: 0.35, char: 0.25, setup: 0.25, env: 0.15 };

  const DEFAULT_THRESHOLD = 0.35;

  function dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }

  function norm(a) {
    return Math.sqrt(dot(a, a));
  }

  function cosine(a, b) {
    const n = norm(a) * norm(b);
    return n === 0 ? 0 : dot(a, b) / n;
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  // slot_intensity_sum = 0.35·plot.intensity + 0.25·|actors| + 0.25·|promises| + 0.15·|world_rules|
  function slotIntensitySum(fs) {
    return (
      SLOT_WEIGHTS.plot * clamp(fs.plot_intensity ?? 0.5, 0, 1) +
      SLOT_WEIGHTS.char * (fs.subjects?.length ?? 0) +
      SLOT_WEIGHTS.setup * (fs.promises?.length ?? 0) +
      SLOT_WEIGHTS.env * (fs.world_rules?.length ?? 0)
    );
  }

  // The docs use ||embedding|| as "semantic density". Modern embedding APIs
  // return unit-length vectors (norm = 1), so we use a length-based proxy on
  // a similar scale to the docs, log-damped so short spoken sentences are not
  // treated as outliers.
  function semanticDensity(fs) {
    const text = [fs.event, fs.context].filter(Boolean).join(' ');
    const words = text.split(/\s+/).filter(Boolean).length;
    return Math.max(1, 4 * Math.log(1 + words));
  }

  function magnitude(fs, stage) {
    const mult = STAGE_MULTIPLIER[stage] ?? 1.0;
    return slotIntensitySum(fs) * semanticDensity(fs) * mult;
  }

  // journey_direction_embedding = Σ (m_i / mean_m) · e_i / n
  function journeyIntent(footsteps) {
    const withEmb = footsteps.filter((f) => f.embedding && f.metrics);
    if (withEmb.length === 0) return null;
    const mags = withEmb.map((f) => f.metrics.magnitude);
    const meanMag = mags.reduce((a, b) => a + b, 0) / mags.length;
    const dim = withEmb[0].embedding.length;
    const sum = new Array(dim).fill(0);
    withEmb.forEach((f) => {
      const w = meanMag === 0 ? 1 : f.metrics.magnitude / meanMag;
      for (let i = 0; i < dim; i++) sum[i] += w * f.embedding[i];
    });
    const embedding = sum.map((x) => x / withEmb.length);
    const meanDirection =
      withEmb.reduce((a, f) => a + f.metrics.direction, 0) / withEmb.length;
    return { magnitude: meanMag, embedding, direction: meanDirection, count: withEmb.length };
  }

  // Scores a new Footstep against the Journey as it stood before it arrived.
  // Returns magnitude, direction ∈ [-1, 1], angle in degrees (Constitution:
  // 0° = aligned, 180° = contradiction), and terminancy distance.
  function scoreFootstep(fs, priorFootsteps, stage, threshold = DEFAULT_THRESHOLD) {
    const mag = magnitude(fs, stage);
    const intentSignal = clamp(fs.intent_signal ?? 0, -1, 1);
    const journey = journeyIntent(priorFootsteps);

    // The first Footstep defines the Journey's direction, so it is aligned by definition.
    if (!journey || !fs.embedding) {
      const direction = 0.6 * 1 + 0.4 * intentSignal;
      return {
        magnitude: mag,
        semantic_alignment: 1,
        direction,
        angle: 0,
        terminancy: 0,
        is_branch_candidate: false,
        contradiction_review: false,
      };
    }

    const semanticAlignment = cosine(fs.embedding, journey.embedding);
    const direction = 0.6 * semanticAlignment + 0.4 * intentSignal;

    // Directions are scalars in [-1, 1]; we map their distance onto the
    // [0, 1] alignment scale the docs define (1 = same, 0 = opposite).
    const directionAlignment = 1 - Math.abs(direction - journey.direction) / 2;
    const magDelta = Math.abs(mag - journey.magnitude);
    const magRatio = journey.magnitude === 0 ? 0 : magDelta / journey.magnitude;
    const terminancy = Math.sqrt(
      magRatio * magRatio * 0.5 + (1 - directionAlignment) * (1 - directionAlignment) * 0.5
    );
    const angle = (Math.acos(clamp(semanticAlignment, -1, 1)) * 180) / Math.PI;

    return {
      magnitude: mag,
      semantic_alignment: semanticAlignment,
      direction,
      angle,
      terminancy,
      is_branch_candidate: terminancy > threshold,
      contradiction_review: angle >= 150,
    };
  }

  // Offline embedding for when no API key is set: hashed bag of word stems.
  // Much weaker than a real embedding model, but free and deterministic.
  const STOP = new Set(
    'a an the and or but of to in on at for with from by as is was were be been are it its this that these those he she they them his her their i we you our your then than so into over under out up down not no yes just very can will would could should has have had do does did who whom what when where why how there here all any some'.split(
      ' '
    )
  );

  function localEmbedding(text, dim = 256) {
    const v = new Array(dim).fill(0);
    const words = (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, ''));
    words.forEach((w) => {
      let h = 2166136261;
      for (let i = 0; i < w.length; i++) {
        h ^= w.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dim;
      v[idx] += h & 1 ? 1 : -1;
    });
    const n = norm(v) || 1;
    return v.map((x) => x / n);
  }

  const api = {
    STAGES,
    STAGE_MULTIPLIER,
    DEFAULT_THRESHOLD,
    cosine,
    slotIntensitySum,
    semanticDensity,
    magnitude,
    journeyIntent,
    scoreFootstep,
    localEmbedding,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NSMM = api;
})(typeof window !== 'undefined' ? window : globalThis);
