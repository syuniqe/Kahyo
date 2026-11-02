// Kahyo's Cloudflare Worker: serves the app and runs the ThoughtSense Engine, the
// NSMMs and their prompts, so none of them ever reaches the browser.
//   POST /api/engine  { op: 'models' }                         → the model list for the picker
//   POST /api/engine  { op: 'score' | 'stages', nsmm?, ... }   → engine results
//   POST /api/ai      { task, data, nsmm?, provider, model, baseUrl } + header X-Kahyo-Key → { result, model }
// `nsmm` names the Journey's model (wordwalk when left out); `model` is the AI model.
// Everything else is the static app in dist/. See README.md in this folder.

import { getModel, publicModels } from './models/index.js';
import { runTask } from './ai.js';

const MAX_BODY = 4 * 1024 * 1024;

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function readJSON(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw Object.assign(new Error('This Journey is too large to send in one go.'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('This Journey is too large to send in one go.'), { status: 413 });
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw Object.assign(new Error('Bad request.'), { status: 400 });
  }
}

// The Journey's model, or an error the app can show.
function modelFor(body) {
  const nsmm = getModel(body.nsmm);
  if (!nsmm) throw Object.assign(new Error('Unknown model.'), { status: 400 });
  if (!nsmm.engine) throw Object.assign(new Error(`${nsmm.name} is coming soon.`), { status: 409 });
  return nsmm;
}

async function engine(request) {
  const body = await readJSON(request);
  if (body.op === 'models') return reply({ models: publicModels() });
  if (body.op === 'score') return reply(modelFor(body).engine.score(body));
  if (body.op === 'stages') return reply(modelFor(body).engine.stages(body));
  return reply({ error: 'Unknown engine call.' }, 400);
}

async function ai(request) {
  const body = await readJSON(request);
  const make = modelFor(body).tasks[body.task];
  if (!make) return reply({ error: 'Unknown AI task.' }, 400);
  const out = await runTask(
    { provider: body.provider, model: body.model, baseUrl: body.baseUrl, key: request.headers.get('X-Kahyo-Key') || '' },
    make(body.data || {})
  );
  return reply(out);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      if (request.method !== 'POST') return reply({ error: 'Use POST.' }, 405);
      try {
        if (pathname === '/api/engine') return await engine(request);
        if (pathname === '/api/ai') return await ai(request);
        return reply({ error: 'Not found.' }, 404);
      } catch (e) {
        // Upstream status codes (401, 429, 503…) pass through so the app can explain them.
        const status = e.status >= 400 && e.status < 600 ? e.status : 500;
        return reply({ error: e.message || 'Something went wrong.', status }, status);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
