# Kahyo server: read me

Everything clever in Kahyo lives in this folder. It runs only inside the Cloudflare Worker (and in Node for tests). The browser never receives any of it: it sends Footsteps in and gets results back.

## The layers

| Layer | Folder | Job |
| --- | --- | --- |
| Worker | `worker.js` | Receives the app's calls, picks the Journey's model, returns results. |
| ThoughtSense Engine | `thoughtsense/` | The shared maths. Turns words into vectors and calculates signals (direction, magnitude, intensity, repetition). Means nothing on its own. |
| NSMMs | `models/` | One module per kind of work (Wordwalk, Rhyme, Reason, Juris). Each decides what the signals mean, and owns its flow and its AI prompts. |
| AI relay | `ai.js` | Passes a prompt to the writer's AI provider with their key, for one call, and never stores the key. |

## What happens on each call

1. The app sends `POST /api/engine` or `POST /api/ai`, naming the Journey's model as `nsmm` (Wordwalk when left out).
2. `worker.js` looks the model up in `models/index.js`. A model that is still coming soon answers "coming soon" (409).
3. **Engine calls** (`score`, `stages`) run the model's rules, which use ThoughtSense for the maths.
4. **AI calls** build the model's prompt on the server and send it through `ai.js`.
5. `op: 'models'` returns only each model's id, name, one-line purpose and status, for the New Journey picker.

## Rules for this folder

- Nothing here is ever copied to `dist/`, so it is never served. `build.sh` only ships the app.
- No formula, threshold or prompt may move into `js/`.
- A change to ThoughtSense or Wordwalk's rules must keep `node --test tests/*.test.js` passing, and the maths doc must be updated with it.

## Where to read next

- [`thoughtsense/README.md`](thoughtsense/README.md): the shared engine, step by step.
- [`models/README.md`](models/README.md): what an NSMM is and how to add one.
- [`models/wordwalk/README.md`](models/wordwalk/README.md): the live model, step by step.
