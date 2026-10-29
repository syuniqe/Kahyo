// AI client. Works with any of: Google Gemini (native), or any OpenAI-compatible
// chat API (Groq, OpenAI, OpenRouter, or a custom base URL).
// Keys live only in this browser's localStorage and are sent only to the provider.
// Embeddings come from Gemini (the main key, or a separate embedding key when the
// chat provider has no embeddings, like Groq); without one Kahyo uses offline ones.

(function (root) {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const EMBED_MODEL = 'gemini-embedding-001';
  const EMBED_DIM = 768;
  const DEFAULT_MODEL = 'gemini-3.8-flash';

  const PROVIDERS = {
    gemini: { label: 'Gemini', base: GEMINI, model: DEFAULT_MODEL, keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
    groq: { label: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyHint: 'gsk_…', keyUrl: 'https://console.groq.com/keys' },
    openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
    openrouter: { label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct', keyHint: 'sk-or-…', keyUrl: 'https://openrouter.ai/keys' },
    custom: { label: 'Custom', base: '', model: '', keyHint: 'key', keyUrl: '' },
  };

  function settings() {
    try {
      return JSON.parse(localStorage.getItem('kahyo.settings') || '{}');
    } catch {
      return {};
    }
  }

  function remember(patch) {
    try {
      localStorage.setItem('kahyo.settings', JSON.stringify({ ...settings(), ...patch }));
    } catch {}
  }

  function provider() {
    const p = settings().provider;
    return PROVIDERS[p] ? p : 'gemini';
  }

  function providerLabel() {
    return PROVIDERS[provider()].label;
  }

  function hasKey() {
    const s = settings();
    return Boolean(s.apiKey) && (provider() !== 'custom' || Boolean(s.baseUrl));
  }

  // The key used for embeddings: the Gemini chat key, or the separate embedding key.
  function embedKey() {
    const s = settings();
    return provider() === 'gemini' ? s.apiKey || '' : s.embedKey || '';
  }

  function hasEmbedKey() {
    return Boolean(embedKey());
  }

  function textModel() {
    return settings().model || PROVIDERS[provider()].model;
  }

  function isRetired(status, msg) {
    return status === 404 || /no longer available|not found|is not supported|deprecated|decommissioned|does not exist/i.test(msg);
  }

  async function failure(res, model) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const err = await res.json();
      msg = err.error?.message || err.message || msg;
    } catch {}
    if (res.status === 429) msg = 'Rate limit reached. Wait a minute and try again. (' + msg + ')';
    if (res.status === 401 || res.status === 403) msg = `${providerLabel()} refused the key. Check it in Settings. (${msg})`;
    const err = new Error(msg);
    err.status = res.status;
    err.model = model;
    return err;
  }

  // ---------- Gemini ----------

  // Google retires models for new users from time to time. When the saved
  // model is refused, pick the newest Flash model this key can use, remember
  // it, and let the caller retry.
  async function pickNewestFlash() {
    const res = await fetch(GEMINI.replace(/models\/$/, 'models?pageSize=200'), { headers: { 'x-goog-api-key': settings().apiKey } });
    if (!res.ok) return null;
    const { models = [] } = await res.json();
    const version = (name) => Number((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const best = models
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash$/.test(n))
      .sort((a, b) => version(b) - version(a))[0];
    if (best) remember({ model: best });
    return best || null;
  }

  async function gemini(model, method, body, key) {
    if (!key) throw new Error('No Gemini key set. Open Settings to add one.');
    const res = await fetch(`${GEMINI}${model}:${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await failure(res, model);
    return res.json();
  }

  async function geminiGenerate(body) {
    const key = settings().apiKey;
    try {
      return await gemini(textModel(), 'generateContent', body, key);
    } catch (e) {
      if (!isRetired(e.status, e.message)) throw e;
      const next = await pickNewestFlash();
      if (!next || next === e.model) throw e;
      return gemini(next, 'generateContent', body, key);
    }
  }

  const geminiText = (data) => data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join('') || '';

  // ---------- OpenAI-compatible (Groq, OpenAI, OpenRouter, custom) ----------

  function baseUrl() {
    const s = settings();
    return (provider() === 'custom' ? s.baseUrl || '' : PROVIDERS[provider()].base).replace(/\/+$/, '');
  }

  // When a model is retired, pick a capable chat model this key can use.
  async function pickChatModel() {
    const res = await fetch(baseUrl() + '/models', { headers: { Authorization: 'Bearer ' + settings().apiKey } });
    if (!res.ok) return null;
    const { data = [] } = await res.json();
    const ids = data.map((m) => m.id).filter((id) => !/whisper|tts|guard|embed|vision|audio|image/i.test(id));
    const prefer = [/gpt-oss-120b/, /70b/, /llama-4/, /gpt-4\.1-mini|gpt-5-mini/, /llama/, /./];
    for (const re of prefer) {
      const hit = ids.find((id) => re.test(id));
      if (hit) {
        remember({ model: hit });
        return hit;
      }
    }
    return null;
  }

  async function chat(messages, opts = {}) {
    const { apiKey } = settings();
    if (!hasKey()) throw new Error('No AI key set. Open Settings to add one.');
    const send = async (model) => {
      const res = await fetch(baseUrl() + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.3,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (!res.ok) throw await failure(res, model);
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    };
    try {
      return await send(textModel());
    } catch (e) {
      if (!isRetired(e.status, e.message)) throw e;
      const next = await pickChatModel();
      if (!next || next === e.model) throw e;
      return send(next);
    }
  }

  // ---------- the app's calls ----------

  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      const m = String(text).match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('The model returned something that was not JSON. Try again.');
    }
  }

  async function generateJSON(prompt, schemaHint) {
    const full = prompt + '\n\nReturn JSON only, matching:\n' + schemaHint;
    if (provider() === 'gemini') {
      const data = await geminiGenerate({
        contents: [{ role: 'user', parts: [{ text: full }] }],
        generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
      });
      return parseJSON(geminiText(data));
    }
    return parseJSON(await chat([{ role: 'user', content: full }], { json: true, temperature: 0.2 }));
  }

  async function generateText(prompt, opts = {}) {
    if (provider() === 'gemini') {
      const data = await geminiGenerate({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: opts.temperature ?? 0.3, thinkingConfig: { thinkingLevel: 'low' } },
      });
      return geminiText(data);
    }
    return chat([{ role: 'user', content: prompt }], opts);
  }

  // The batch endpoint takes at most 100 texts per call.
  async function embed(texts) {
    const key = embedKey();
    const out = [];
    for (let i = 0; i < texts.length; i += 100) {
      const data = await gemini(
        EMBED_MODEL,
        'batchEmbedContents',
        {
          requests: texts.slice(i, i + 100).map((t) => ({
            model: 'models/' + EMBED_MODEL,
            content: { parts: [{ text: t }] },
            taskType: 'SEMANTIC_SIMILARITY',
            outputDimensionality: EMBED_DIM,
          })),
        },
        key
      );
      out.push(...data.embeddings.map((e) => e.values));
    }
    return out;
  }

  root.LLM = { PROVIDERS, settings, provider, providerLabel, hasKey, hasEmbedKey, generateJSON, generateText, embed, EMBED_DIM, DEFAULT_MODEL };
})(window);
