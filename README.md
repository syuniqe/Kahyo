# Kahyo — voice-first storytelling demo

Speak your story. Kahyo turns spoken fragments into **Footsteps**, maps them on a living **Journey** graph, warns when an idea drifts (**Terminancy**) or a character breaks their **traits**, and renders the main thread as a prose draft.

This is a working demo of the Narrative Storyline Mapping Model (NSMM). It costs nothing to run:

| Part | Free option used |
| --- | --- |
| Hosting | GitHub Pages (static site, no server) |
| Voice to text | Browser speech recognition (Chrome / Edge; English India, US, UK, Hindi) |
| AI extraction, continuity checks, prose | Google Gemini free tier, with your own key stored only in your browser |
| Embeddings | Gemini `gemini-embedding-001` free tier, or an offline fallback (text model defaults to `gemini-3.8-flash` and switches to the newest Flash automatically if Google retires it) |
| Storage | Your browser (localStorage), plus JSON export / import |

Without a key the app still works in **offline mode**: one Footstep per sentence, simple local embeddings, and an outline instead of prose.

## Try it

1. Open the site (see *Deploy* below), or run it locally:
   ```sh
   python3 -m http.server 8000
   # open http://localhost:8000
   ```
2. **Menu → Load sample story** to see a finished Journey (*The Salt Road*) with one drifting branch and one trait break.
3. For AI mode: **Settings** → get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → paste → Save.
4. Press **Speak**, think out loud, then **Add to Journey**. Ctrl/⌘ + Enter also adds.
5. New ideas continue the story by default. To slot one in earlier, pick a spot in **Place it**, or select a Footstep and press **Add next idea after this**. With a Gemini key, Kahyo also works out the spot from what you say ("before the king...", "back at the start"). **↑ Earlier / ↓ Later** reorder a Footstep.

## Deploy (free)

**Private repo → Netlify.** Sign up at app.netlify.com with GitHub → *Add new site → Import an existing project → GitHub* → pick this repo → leave the build command empty, set the publish directory to `.` → *Deploy*. Every push to `main` redeploys automatically.

**Public repo → GitHub Pages.** *Settings → Pages → Source: Deploy from a branch → `main` / `(root)` → Save.*

## How it maps to the NSMM docs

| Concept | Where |
| --- | --- |
| Footstep packet (Event, Subject, Context, Intent Vector, Seeds) plus promises and world rules | `js/app.js` → `addThought` |
| Typed edges: causal, temporal, character arc, setup → resolution, thematic | `EDGE_TYPES` in `js/app.js` |
| Magnitude = slot intensity × semantic density × stage multiplier | `js/nsmm.js` → `magnitude` |
| Direction = 0.6 · semantic alignment + 0.4 · intent signal | `js/nsmm.js` → `scoreFootstep` |
| Journey Intent Vector (magnitude-weighted mean embedding) | `js/nsmm.js` → `journeyIntent` |
| Terminancy distance, threshold 0.35 (adjustable slider) | `js/nsmm.js` → `scoreFootstep` |
| Constitution angle: 0° aligned, 180° contradiction (≥150° triggers review) | gauge in the Footstep panel |
| Trait levels: strict / moderate / flexible / off | Subjects & traits panel |
| Decrumbing: branch candidates can be kept or archived | Alerts panel |
| Branching is off in Origin and until 3 main Footsteps exist; offline, only an explicit what-if branches | `addThought` in `js/app.js` |
| Journey Mapping rail: Origin → Pandiculation → Maxspan → Convergence → Climax | header rail and Stage selector |

Two deliberate simplifications, noted in the code:

- **Semantic density.** The docs use `‖embedding‖`, but modern embedding APIs return unit vectors. The demo uses a log-damped word-count proxy instead.
- **Direction alignment.** Directions are scalars in [-1, 1], so alignment is `1 − |d₁ − d₂| / 2`, which keeps the docs' [0, 1] scale.

Offline mode has no AI, so its Footsteps are thin (no promises, little context). Mixing them with AI-extracted Footsteps makes Terminancy over-flag. Use one mode per Journey for a fair reading.

## Files

```
index.html          page layout
css/style.css       styles
js/nsmm.js          NSMM math (also runs in Node for tests)
js/llm.js           Gemini client
js/app.js           app logic, graph, speech, UI
js/sample.js        the sample Journey
vendor/             vis-network graph library (MIT)
tests/              node --test tests/nsmm.test.js
```

## Privacy

Your Journey and API key stay in your browser. When a key is set, transcripts are sent to Google's Gemini API for processing. On the free tier, Google may use that data to improve its products, so don't paste anything confidential.

## Journey view (v2)

- **Home** lists every Journey saved in this browser (no sign-in yet: accounts need the Phase 4 backend).
- **Graph geometry**: each line's angle is the Footstep's direction (up = toward the story's intent, flat = neutral, down = away, max ±60°), its length is the magnitude, and a circle's size is how much data the Footstep holds. Above 60 data points Kahyo suggests splitting it in two.
- **Stages** are not labelled until 12 main Footsteps. Then Gemini reads the whole Journey and labels each moment (every 3 new Footsteps); offline, labels follow position within the planned length.
- **Left pane**: speak and correct, then a character list (recurrence %, traits with strictness, physical features picked from the story).
- **Right pane**: Footstep (five editable parameters), Alerts, helper Draft; below it the Footstep modifier with Intent Vector sliders and ranges.
- **Theme**: light (white and greys, deep purple) and dark (deep violet, yellow), Fraunces headings with Manrope text, flat pill buttons. While Kahyo works, the logo scribbles itself.
- **Graph labels** show only the Footstep id and keep their size when you zoom; stages and the planned length sit under the graph, the Terminancy threshold above it. Characters open as a pop-up from a bar under Think out loud.
