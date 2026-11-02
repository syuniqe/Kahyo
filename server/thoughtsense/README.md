# ThoughtSense Engine: read me

ThoughtSense is Kāhyo's shared maths layer. It turns thoughts into numbers that can be compared. It does **not** decide what those numbers mean: each NSMM does that. Wordwalk and a future Reason can read the same direction number with different rules.

Exact formulas and their tests are in the private maths doc. This file explains what each part does.

## Files

| File | What it does |
| --- | --- |
| `vectors.js` | Basic vector maths: dot product, length, cosine, clamp, median. Also cleans vectors from the browser (bad numbers become "no vector") and unpacks the compact base64 form. |
| `words.js` | Text to content words: drops filler ("um", "basically"), stop words and repeats, and trims word endings. Makes offline vectors when no embedding service is set. |
| `signals.js` | Signals of one Footstep: **magnitude** (how much happens), **intensity** (how big it is, 0 to 1) and **repetition** (does it say again what an earlier one said). |
| `thread.js` | Signals against a line of thought: its **heading**, its typical **spread**, its main side-to-side **axis**, and the signed **direction** of a new Footstep in degrees. |
| `index.js` | Re-exports all of the above. |

## Step by step: what ThoughtSense works out for a new Footstep

1. **Meaning vector.** The Footstep's text arrives as a vector (from the writer's AI provider, or offline from `words.js`).
2. **Magnitude.** Count the distinct content words, plus each character, setup and place it names. More happening means a bigger magnitude.
3. **Intensity.** Use the AI's or writer's rating. Without one, read it from heavy words (die, betray, escape and so on).
4. **The thread so far.** From the earlier Footsteps on the same line, work out where the line is heading (its whole history blended with its recent Footsteps), how spread out it usually is, and its main side-to-side axis.
5. **Direction.** Measure how far the new Footstep sits from that heading, compared with the usual spread. Normal variation reads 0°. Further than usual becomes a turn in degrees, signed by which side of the axis it falls.
6. **Repetition.** Compare its words and meaning with every earlier Footstep and name the closest one if they are nearly the same.

The model then takes these numbers and applies its own rules.

## Two ways to use the thread

- `thread()` and `deviation()` judge one Footstep against a list. Simple, used in tests.
- `threadState()`, `addToThread()` and `deviationFrom()` give the same answers but keep running totals, so scoring a whole Journey costs one pass. The live app uses these.
