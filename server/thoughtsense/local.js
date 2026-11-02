// ThoughtSense core · local thread
// The same heading and signed direction as thread.js, for any group of Footsteps
// (a song's theme, one phase of a paper, a case), grown one Footstep at a time.
// Server only.

import { dotF } from './vectors.js';
import { MIN_TO_JUDGE, threadState, addToThread, deviationFrom } from './thread.js';

// A group that grows: judge(e) measures a vector against the group as it stands,
// add(e) puts it in. Vectors of another size are skipped (offline and AI vectors never mix).
function localThread() {
  let st = null;
  let dim = null;
  return {
    get size() {
      return st ? st.X.length : 0;
    },
    judge(e) {
      if (!e || !st || e.length !== dim || st.kept.length < MIN_TO_JUDGE) return { degrees: 0, judged: false, stray: 0, z: 0 };
      const dots = st.X.map((x) => dotF(x, e));
      return { ...deviationFrom(st, e, dots), judged: true };
    },
    add(e) {
      if (!e) return;
      if (!st) {
        st = threadState();
        dim = e.length;
      }
      if (e.length !== dim) return;
      addToThread(st, e, st.X.map((x) => dotF(x, e)));
    },
  };
}

// Status bands shared by every model: on up to X/3, wandering up to 2X/3, drifting up to X, off past X.
function band(degrees, limit, judged) {
  if (!judged) return 'on';
  const r = Math.abs(degrees) / limit;
  return r > 1 ? 'off' : r > 2 / 3 ? 'drifting' : r > 1 / 3 ? 'wander' : 'on';
}

export { localThread, band };
