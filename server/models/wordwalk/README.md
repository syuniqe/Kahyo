# Wordwalk: read me

**Wordwalk** is the NSMM for stories. It helps a writer walk a story from the first idea to a conclusive ending, and tells them when the story turns, jumps, crawls, branches or repeats itself.

| File | Holds |
| --- | --- |
| `model.js` | The definition in plain words (phases, fields, signals, notes). |
| `rules.js` | Stages, limits, statuses, branching and terminancy. |
| `prompts.js` | AI instructions: extract, stages, split, physical, remold, draft. |

## The flow

**Origin → Pandiculation → Maxspan → Convergence → Conclusion.** Stages only move forward. They are labelled once 20% of the planned Footsteps exist (at least 3, at most 20): by the AI when a key is set, by position otherwise. Each later stage allows a smaller turn, so the Conclusion is the strictest.

## Step by step: from a spoken idea to the map

1. **The writer speaks or types an idea.**
2. **Extract (AI, `prompts.js`).** The idea becomes exactly one Footstep in the writer's own words, with who, when, where, promises, links (cause, casual, character arc) and an intensity. The AI also says where it goes: the end of the main story, earlier in it, on a side path, or rejoining from a side path. It records aliases, traits and physical features, and flags trait breaks. If the idea holds more than one event, Kāhyo offers "Split in two"; it never splits on its own.
3. **Signals (ThoughtSense).** Magnitude, intensity, direction against the main story, and repetition.
4. **Direction status.** The turn is compared with the current stage's limit: on course (up to a third of it), wandering, drifting, or off course (past it).
5. **Jump or Crawl.** Twice the usual magnitude is a Jump; half is a Crawl.
6. **Intent vector.** Direction and magnitude together. When it is long enough (a lot, in an unusual direction), Kāhyo suggests making it a side path.
7. **Side paths.** A side-path Footstep is also judged against its own path, so a side path can branch again. Terminancy measures the area a side path opens away from the main story; a drifting path fades, and one note appears when it reaches its limit. A path that rejoins the main story stops fading.
8. **Stages.** Every few Footsteps the stages are relabelled.
9. **The map.** On course climbs at 35°; each line turns by its direction; its length is the magnitude; its circle size is the intensity. Side paths are dashed.
10. **Draft (AI).** On request, a helper draft that uses only the writer's facts and asks questions instead of inventing.

## What stays hidden

The browser gets the results (status, angle, size, notes). The limits, formulas and prompts stay here.
