// Kahyo's Cloudflare Worker: serves the app and runs the ThoughtSense Engine and
// the prompts, so neither ever reaches the browser.
//   POST /api/engine  { op: 'score' | 'stages', ... }   → engine results
//   POST /api/ai      { task, data, provider, model, baseUrl } + header X-Kahyo-Key → { result, model }
// Everything else is the static app in dist/.

import { scoreJourney, stagesFor } from './thoughtsense.js';
import { TASKS } from './prompts.js';
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

async function engine(request) {
  const body = await readJSON(request);
  if (body.op === 'score') return reply(scoreJourney(body));
  if (body.op === 'stages') return reply(stagesFor(body));
  return reply({ error: 'Unknown engine call.' }, 400);
}

async function ai(request) {
  const body = await readJSON(request);
  const make = TASKS[body.task];
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
