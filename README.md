# Kahyo — voice-first storytelling demo

Speak your story. Kahyo turns spoken fragments into **Footsteps**, maps them on a living **Journey** graph, warns when an idea drifts (**Terminancy**) or a character breaks their **traits**, and renders the main thread as a prose draft.

This is a working demo of the **Wordwalk Model**, a Narrative Storyline Mapping Model (NSMM), using the **ThoughtSense Engine**: the maths layer that turns thoughts and words into vectors and logical operations. It costs nothing to run:

| Part | Free option used |
| --- | --- |
| Hosting | GitHub Pages (static site, no server) |
| Voice to text | Browser speech recognition (Chrome / Edge; English India, US, UK, Hindi) |
| AI extraction, continuity checks, prose | Any AI key (Gemini or Groq free tiers, OpenAI, OpenRouter), stored only in your browser |
| Embeddings | Gemini `gemini-embedding-001` free tier, or an offline fallback (text model defaults to `gemini-3.8-flash` and switches to the newest Flash automatically if Google retires it) |
| Storage | Your browser (localStorage), plus JSON export / import |

Without a key the app still works in **offline mode**: one Footstep per idea, simple local embeddings, and an outline instead of prose. It needs a connection, because the engine runs on the server.

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

Cloudflare Workers static assets: build command `sh build.sh`, deploy command `npx wrangler deploy` (see `wrangler.jsonc`). Every push to `main` redeploys to https://app.kahyo.workers.dev.

## The maths

The ThoughtSense Engine is Kahyo's IP. Its formulas live only in `js/nsmm.js` and the private maths review doc, and they are not described here. They move server-side in the next phase. The shipped copy in `dist/` is minified by `build.sh`.

## Files

```
index.html          page layout
css/style.css       styles
js/nsmm.js          ThoughtSense Engine (also runs in Node for tests)
js/llm.js           AI client (Gemini and OpenAI-compatible providers)
js/app.js           app logic, graph, speech, UI
js/sample.js        the sample Journey
vendor/             vis-network graph library (MIT)
tests/              node --test tests/nsmm.test.js
```

## Privacy

Your Journey and API key stay in your browser. When a key is set, transcripts are sent to that AI provider for processing. On free tiers, providers may use that data to improve their products, so don't paste anything confidential.

## Journey view

- **Home** lists every Journey saved in this browser (no sign-in yet).
- **Write**: speak, the story map (a click only highlights a Footstep), a story-health pill, and the right pane with **Notes** (they stay until you clear them) and **Draft**. The pane folds away with ».
- **Inspect**: the right pane becomes **Footstep** (the selected Footstep, its values and notes) and **Storyline** (terminancy factor, branching share, planned length, stats).
- **Graph**: on course climbs at 35°; each Footstep's line turns from that by its direction, its length is the magnitude, its circle size the intensity. Side paths are dashed.
- **AI**: any provider (Gemini, Groq, OpenAI, OpenRouter or another OpenAI-compatible API). Embeddings come from Gemini, or offline ones.
- While Kahyo works, the logo scribbles itself in the map's bottom-right corner.
