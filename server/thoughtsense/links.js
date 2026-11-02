// ThoughtSense core · links
// Which Footsteps reach a root through their links, how far, and which rely on one.
// Server only.

// parentOf: id → parent id (or the root). Returns id → hops to the root, or Infinity.
function depthToRoot(ids, parentOf, root) {
  const depth = {};
  const walk = (id, seen) => {
    if (id === root) return 0;
    if (depth[id] !== undefined) return depth[id];
    if (seen.has(id)) return Infinity;
    seen.add(id);
    const p = parentOf[id];
    const d = p === undefined || p === null ? Infinity : walk(p, seen) + 1;
    depth[id] = d;
    return d;
  };
  ids.forEach((id) => walk(id, new Set()));
  return depth;
}

// Everything that grew from id (children, their children…).
function descendants(id, parentOf) {
  const kids = {};
  Object.entries(parentOf).forEach(([c, p]) => (kids[p] = kids[p] || []).push(c));
  const out = new Set();
  const stack = [...(kids[id] || [])];
  while (stack.length) {
    const c = stack.pop();
    if (out.has(c)) continue;
    out.add(c);
    stack.push(...(kids[c] || []));
  }
  return out;
}

// Footsteps that rely on id through typed links (from → to means `to` relies on `from`).
function dependents(id, edges, types) {
  return edges.filter((e) => e.from === id && (!types || types.includes(e.type))).map((e) => e.to);
}

export { depthToRoot, descendants, dependents };
