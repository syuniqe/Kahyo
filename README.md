# Kahyo — voice-first storytelling demo

Speak your story. Kahyo turns spoken fragments into **Footsteps**, maps them on a living **Journey** graph, warns when an idea drifts (**Terminancy**) or a character breaks their **traits**, and renders the main thread as a prose draft.

This is a working demo of the **Wordwalk Model**, a Narrative Storyline Mapping Model (NSMM), using the **ThoughtSense Engine**: the maths layer that turns thoughts and words into vectors and logical operations. It costs nothing to run:

| Part | Free option used |
| --- | --- |
| Hosting | GitHub Pages (static site, no server) |
| Voice to text | Browser speech recognition (Chrome / Edge; English India, US, UK, Hindi) |
| AI extraction, continuity checks, prose | Any AI key (Gemini or Groq free tiers, Claude, OpenAI, OpenRouter), stored only in your browser |
| Embeddings | Gemini `gemini-embedding-001` free tier, or an offline fallback (text model defaults to `gemini-3.8-flash` and switches to the newest Flash automatically if Google retires it) |
| Storage | Your browser (localStorage), plus JSON export / import |

Without a key the app still works in **offline mode**: one Footstep per idea, simple local embeddings, and an outline instead of prose. It needs a connection, because the engine runs on the server.

## Try it

1. Open the site (see *Deploy* below), or run it locally:
   ```sh
   python3 -m http.server 8000
   # open http://localhost:8000
   ```
2. **Menu → Load sample story** to see a finished Journey (*The Salt Road*) that shows every feature: a side path at its limit, an off-course turn, a Footstep holding three events, a Jump, a Crawl, a repeat and a trait break.
3. For AI mode: **Settings** → get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) → paste → Save.
4. Press **Speak**, think out loud, then **Add to Journey**. Ctrl/⌘ + Enter also adds.
5. New ideas continue the story by default. To slot one in earlier, pick a spot in **Place it**, or select a Footstep and press **Add next idea after this**. With a Gemini key, Kahyo also works out the spot from what you say ("before the king...", "back at the start"). **↑ Earlier / ↓ Later** reorder a Footstep.

## Deploy (free)

Cloudflare Workers static assets: build command `sh build.sh`, deploy command `npx wrangler deploy` (see `wrangler.jsonc`). Every push to `main` redeploys to https://app.kahyo.workers.dev.

## The maths

The ThoughtSense Engine is Kahyo's IP. Its formulas live only in `server/thoughtsense.js` (run by the Cloudflare Worker, never sent to the browser) and the private maths review doc. `js/nsmm.js` is only the browser shim that asks the server to score a Journey.

## Files

```
index.html          page layout
css/style.css       styles
js/nsmm.js          Browser shim: stage names, offline word vectors, calls /api/engine
server/thoughtsense.js  ThoughtSense Engine (server only; also runs in Node for tests)
js/llm.js           AI client (Gemini, Claude and OpenAI-compatible providers, relayed by the server)
js/app.js           app logic, graph, speech, UI
js/sample.js        the sample Journey
vendor/             vis-network graph library (MIT)
tests/              node --test tests/nsmm.test.js
```

## Privacy

Your Journeys and API key are stored in your browser. When a key is set, Kahyo's server passes it with each AI call to your provider and never stores it, and transcripts are sent to that provider for processing. On free tiers, providers may use that data to improve their products, so don't paste anything confidential.

## Journey view

- **Home** lists every Journey saved in this browser (no sign-in yet).
- **Write**: speak, the story map (a click only highlights a Footstep), a story-health pill, and the right pane with **Notes** (they stay until you clear them) and **Draft**. The pane folds away with ».
- **Learn**: learn.html, a guide with annotated screenshots of every part (Menu → Learn, or Learn on the home page). Screenshots live in assets/learn/.
- **Inspect**: the right pane becomes **Footstep** (the selected Footstep, its values and notes) and **Storyline** (terminancy factor, planned length, stats and the side-path limit).
- **Graph**: on course climbs at 35°; each Footstep's line turns from that by its direction, its length is the magnitude, its circle size the intensity. Side paths are dashed.
- **AI**: any provider (Gemini, Claude, Groq, OpenAI, OpenRouter or another OpenAI-compatible API). Claude runs through the official Anthropic SDK on the server. Claude has no embeddings, so embeddings come from Gemini (an optional second key), or offline ones.
- **Model**: direction alone gives each Footstep's status (on course, wandering, drifting, off course) against the stage limit. The intent vector (direction plus half-weighted magnitude) suggests branching, on the main story or on a side path (a sub-path). Terminancy belongs to side paths only: the sector they open against the main story (½·L²·Δθ) against a limit of three usual steps at TF×180°. Side paths fade as the sector grows, and one note sits at the path's last Footstep. A side path can rejoin the main story (a dashed amber 'Rejoins the story' link from its last Footstep): the AI sets it when a side path's character or thread returns, No-AI mode asks, and Inspect has a 'Meets the main story at' picker. A rejoined path stops fading and gets no terminancy notes.
- While Kahyo works, the logo scribbles itself in the map's bottom-right corner.
