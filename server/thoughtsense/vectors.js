// ThoughtSense core · vectors
// Plain vector maths shared by every model: dot products, length, cosine,
// clamping, medians, and the cleaning of vectors that arrive from the browser.
// Server only.

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

function unit(v) {
  const n = norm(v) || 1;
  return v.map((x) => x / n);
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const round2 = (x) => Math.round(x * 100) / 100;

// The browser sends vectors as base64 float32 (`e64`): about a third of the JSON size.
function decodeVector(raw) {
  if (typeof raw.e64 === 'string' && raw.e64) {
    try {
      const bin = atob(raw.e64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Array.from(new Float32Array(bytes.buffer, 0, bytes.length >> 2));
    } catch {
      return null;
    }
  }
  return raw.embedding;
}

// Clean inputs: a vector with a bad number, or no length, counts as no vector.
function cleanVector(e) {
  if (!Array.isArray(e) || !e.length) return null;
  let n = 0;
  for (let k = 0; k < e.length; k++) {
    const x = e[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    n += x * x;
  }
  if (n < 1e-18) return null;
  n = Math.sqrt(n);
  const u = new Float64Array(e.length);
  for (let k = 0; k < e.length; k++) u[k] = e[k] / n;
  return u;
}

function dotF(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

const num = (x, fallback) => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? fallback : Number(x));

const list = (xs) => (Array.isArray(xs) ? xs.filter((x) => x !== null && x !== undefined).map(String) : typeof xs === 'string' && xs ? [xs] : []);

export { dot, norm, cosine, clamp, unit, median, round2, decodeVector, cleanVector, dotF, num, list };
