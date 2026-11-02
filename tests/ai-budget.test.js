// The AI relay must answer before Cloudflare's 100-second cut-off (error 524).
const test = require('node:test');
const assert = require('node:assert');

test('a hung provider ends in a clear 504 well before 100 seconds', async (t) => {
  const { runTask } = await import('../server/ai.js');
  const real = globalThis.fetch;
  const realTimeout = AbortSignal.timeout;
  let calls = 0;
  // Scale time down: every timeout fires after 1/1000 of its length.
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('timed out', 'TimeoutError')), Math.max(1, ms / 1000));
    return c.signal;
  };
  globalThis.fetch = (url, init) => {
    calls++;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  };
  t.after(() => { globalThis.fetch = real; AbortSignal.timeout = realTimeout; });
  const start = Date.now();
  await assert.rejects(
    runTask({ provider: 'gemini', key: 'k' }, { prompt: 'hi', schema: '{}' }),
    (e) => e.status === 504 && /took too long/.test(e.message)
  );
  assert.equal(calls, 1);
  assert.ok(Date.now() - start < 2000);
});

test('a busy provider stops retrying when the budget runs out', async (t) => {
  const { runTask } = await import('../server/ai.js');
  const real = globalThis.fetch;
  const realNow = Date.now;
  let clock = realNow(), calls = 0;
  Date.now = () => clock;
  globalThis.fetch = async (url) => {
    calls++;
    clock += 25000; // every call burns 25 s of the budget
    if (String(url).includes('models?')) return new Response(JSON.stringify({ models: [] }));
    return new Response(JSON.stringify({ error: { message: 'high demand' } }), { status: 503 });
  };
  t.after(() => { globalThis.fetch = real; Date.now = realNow; });
  await assert.rejects(runTask({ provider: 'gemini', key: 'k' }, { prompt: 'hi' }), (e) => e.status === 503 || e.status === 504);
  assert.ok(calls <= 3, 'calls ' + calls);
});
