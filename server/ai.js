// Relays one task to the writer's own AI provider with their key. The key comes
// in a request header, is used for this call only and is never stored or logged.
// Gemini (native) or any OpenAI-compatible chat API (Groq, OpenAI, OpenRouter, custom).

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const PROVIDERS = {
  gemini: { label: 'Gemini', base: GEMINI, model: DEFAULT_MODEL },
  groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct' },
  custom: { label: 'Custom', base: '', model: '' },
};

function isRetired(status, msg) {
  return status === 404 || /no longer available|not found|is not supported|deprecated|decommissioned|does not exist/i.test(msg);
}

// A busy model (503, "high demand", overloaded) usually clears in seconds.
function isBusy(status, msg) {
  return status === 503 || status === 529 || /high demand|overloaded|unavailable|try again later/i.test(msg || '');
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry a busy call twice (after about 2 s and 5 s), then let the caller try another model.
async function patient(call) {
  for (let i = 0; ; i++) {
    try {
      return await call();
    } catch (e) {
      if (!isBusy(e.status, e.message) || i >= 2) throw e;
      await wait(i ? 5000 : 2000);
    }
  }
}

async function failure(res, model, label) {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const err = await res.json();
    msg = err.error?.message || err.message || msg;
  } catch {}
  if (isBusy(res.status, msg)) msg = `${model} is busy right now (high demand). Kahyo tried again and tried another model; wait a minute and press Add again. (${msg})`;
  else if (res.status === 429) msg = 'Rate limit reached. Wait a minute and try again. (' + msg + ')';
  if (res.status === 401 || res.status === 403) msg = `${label} refused the key. Check it in Settings. (${msg})`;
  const err = new Error(msg);
  err.status = res.status;
  err.model = model;
  return err;
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error('The model returned something that was not JSON. Try again.');
  }
}

// ---------- Gemini ----------

async function flashModels(key) {
  const res = await fetch(GEMINI.replace(/models\/$/, 'models?pageSize=200'), { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return [];
  const { models = [] } = await res.json();
  const version = (name) => Number((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  return models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n))
    .sort((a, b) => version(b) - version(a) || a.length - b.length);
}

async function gemini(model, body, key) {
  const res = await fetch(`${GEMINI}${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await failure(res, model, 'Gemini');
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join('') || '';
}

// Returns { text, model }: model is set when Kahyo had to switch for good (retired).
async function geminiRun(cfg, body) {
  const model = cfg.model || DEFAULT_MODEL;
  try {
    return { text: await patient(() => gemini(model, body, cfg.key)) };
  } catch (e) {
    if (isRetired(e.status, e.message)) {
      const next = (await flashModels(cfg.key)).find((n) => !/-lite$/.test(n));
      if (!next || next === model) throw e;
      return { text: await gemini(next, body, cfg.key), model: next };
    }
    if (!isBusy(e.status, e.message)) throw e;
    // Busy: try two other Flash models once each, without changing the saved choice.
    for (const alt of (await flashModels(cfg.key)).filter((n) => n !== model).slice(0, 2)) {
      try {
        return { text: await gemini(alt, body, cfg.key) };
      } catch (e2) {
        if (!isBusy(e2.status, e2.message)) throw e2;
      }
    }
    throw e;
  }
}

// ---------- OpenAI-compatible ----------

async function chatModel(cfg) {
  const res = await fetch(cfg.base + '/models', { headers: { Authorization: 'Bearer ' + cfg.key } });
  if (!res.ok) return null;
  const { data = [] } = await res.json();
  const ids = data.map((m) => m.id).filter((id) => !/whisper|tts|guard|embed|vision|audio|image/i.test(id));
  for (const re of [/gpt-oss-120b/, /70b/, /llama-4/, /gpt-4\.1-mini|gpt-5-mini/, /llama/, /./]) {
    const hit = ids.find((id) => re.test(id));
    if (hit) return hit;
  }
  return null;
}

async function chatRun(cfg, prompt, opts) {
  const send = async (model) => {
    const res = await fetch(cfg.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: opts.temperature ?? 0.3,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) throw await failure(res, model, cfg.label);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  };
  const model = cfg.model || PROVIDERS[cfg.provider].model;
  try {
    return { text: await patient(() => send(model)) };
  } catch (e) {
    if (!isRetired(e.status, e.message)) throw e;
    const next = await chatModel(cfg);
    if (!next || next === model) throw e;
    return { text: await send(next), model: next };
  }
}

// cfg: { provider, model, baseUrl, key }. task: { prompt, schema?, temperature? }.
export async function runTask(cfg, task) {
  const provider = PROVIDERS[cfg.provider] ? cfg.provider : 'gemini';
  if (!cfg.key) throw Object.assign(new Error('No AI key set. Open Settings to add one.'), { status: 400 });
  const json = Boolean(task.schema);
  const prompt = json ? task.prompt + '\n\nReturn JSON only, matching:\n' + task.schema : task.prompt;
  let out;
  if (provider === 'gemini') {
    out = await geminiRun(
      { ...cfg, provider },
      {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: json
          ? { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
          : { temperature: task.temperature ?? 0.3, thinkingConfig: { thinkingLevel: 'low' } },
      }
    );
  } else {
    const base = (provider === 'custom' ? cfg.baseUrl || '' : PROVIDERS[provider].base).replace(/\/+$/, '');
    if (!/^https:\/\//.test(base)) throw Object.assign(new Error('Set an https base URL for the custom provider in Settings.'), { status: 400 });
    out = await chatRun({ ...cfg, provider, base, label: PROVIDERS[provider].label }, prompt, { json, temperature: json ? 0.2 : task.temperature });
  }
  return { result: json ? parseJSON(out.text) : out.text, model: out.model || null };
}
