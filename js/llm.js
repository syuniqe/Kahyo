// AI client. Works with Google Gemini or any OpenAI-compatible chat API (Groq,
// OpenAI, OpenRouter, or a custom base URL). The prompts live on Kahyo's server:
// the app sends a task name and story data, the server relays it to the provider.
// Keys live only in this browser's localStorage; the server uses one per call and never stores it.
// Embeddings come from Gemini (the main key, or a separate embedding key when the
// chat provider has no embeddings, like Groq); without one Kahyo uses offline ones.

(function (root) {
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const EMBED_MODEL = 'gemini-embedding-001';
  const EMBED_DIM = 768;
  const DEFAULT_MODEL = 'gemini-3.8-flash';

  const PROVIDERS = {
    gemini: { label: 'Gemini', base: GEMINI, model: DEFAULT_MODEL, keyHint: 'AIza…', keyUrl: 'https://aistudio.google.com/apikey' },
    claude: { label: 'Claude', base: '', model: 'claude-opus-5-5', keyHint: 'sk-ant-…', keyUrl: 'https://platform.claude.com/settings/keys' },
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

  function busy(status, msg) {
    return status === 503 || status === 529 || /high demand|overloaded|unavailable|try again later/i.test(msg || '');
  }

  // Runs one AI task on Kahyo's server, which holds the prompts and calls the
  // writer's provider with their key (sent for this call only, never stored).
  async function run(task, data) {
    if (!hasKey()) throw new Error('No AI key set. Open Settings to add one.');
    const s = settings();
    let res;
    try {
      res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Kahyo-Key': s.apiKey },
        body: JSON.stringify({ task, data, provider: provider(), model: s.model || '', baseUrl: s.baseUrl || '' }),
      });
    } catch {
      throw new Error('Kahyo could not reach its server. Check your connection and try again.');
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(out.error || `Kahyo's server said ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    // The model was retired and the server found its successor: remember it.
    if (out.model) remember({ model: out.model });
    return out.result;
  }

  // Embeddings go straight to Gemini: they carry no Kahyo maths.
  async function gemini(model, method, body, key) {
    if (!key) throw new Error('No Gemini key set. Open Settings to add one.');
    for (let i = 0; ; i++) {
      const res = await fetch(`${GEMINI}${model}:${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
      if (res.ok) return res.json();
      let msg = `${res.status} ${res.statusText}`;
      try {
        const err = await res.json();
        msg = err.error?.message || msg;
      } catch {}
      if (i < 2 && busy(res.status, msg)) {
        await new Promise((r) => setTimeout(r, i ? 5000 : 2000));
        continue;
      }
      if (res.status === 401 || res.status === 403) msg = `Gemini refused the embedding key. Check it in Settings. (${msg})`;
      throw new Error(msg);
    }
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

  root.LLM = { PROVIDERS, settings, provider, providerLabel, hasKey, hasEmbedKey, run, embed, EMBED_DIM, DEFAULT_MODEL };
})(window);
