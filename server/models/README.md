# NSMMs: read me

An **NSMM** (Narrative Structure Mapping Model) is a model for one kind of work. Each Journey uses exactly one, chosen when the Journey is created, and keeps it.

| Model | For | Map | Status |
| --- | --- | --- | --- |
| [Wordwalk](wordwalk/README.md) | Stories: fiction, novels, plays, screen, TV and film | Rising line | Live |
| [Rhyme](rhyme/README.md) | Poems, lyrics and songs | Top to bottom | Live (beta) |
| [Reason](reason/README.md) | Studies, articles, research papers and theses | Horizontal, left to right | Live (beta) |
| [Juris](juris/README.md) | Lawyers mapping and documenting a case | Mind map of circular nodes around the case | Live (beta) |

## What a model is made of

Every model folder has the same shape:

| File | Holds |
| --- | --- |
| `model.js` | The **definition** in plain words: id, name, status, what it is for, the map layout, its phases, its Footstep fields, what each signal means, and the notes it can raise. |
| `rules.js` | The **rules**: how it turns ThoughtSense's signals into statuses and notes. Live models only. |
| `prompts.js` | The **AI instructions** for this kind of work. Live models only. |
| `index.js` | Joins the three into one object: the definition, plus `engine` and `tasks` (both `null` while coming soon). |
| `README.md` | This model explained step by step. |

`index.js` in this folder is the **registry**: the list of models, the default (Wordwalk, for Journeys made before models existed), and `publicModels()`, the only part the browser sees (id, name, purpose, status).

## How to bring a coming-soon model to life

1. Fill in the "To define" parts of its `model.js`: Footstep fields, signals, notes.
2. Write `rules.js` using ThoughtSense (`../../thoughtsense/`). Do not copy maths into the model; add anything shared to ThoughtSense.
3. Write `prompts.js`.
4. In its `index.js`, set `engine: { score, stages }` and `tasks`, and set `status: 'live'` in `model.js`.
5. Add tests, then teach the app to draw its map layout.
