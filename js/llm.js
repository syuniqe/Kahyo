// Gemini client (free tier). The key lives only in this browser's localStorage
// and is sent only to Google's API.

(function (root) {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const EMBED_MODEL = 'gemini-embedding-001';
  const EMBED_DIM = 768;
  const DEFAULT_MODEL = 'gemini-3.8-flash';

  function settings() {
    try {
      return JSON.parse(localStorage.getItem('kahyo.settings') || '{}');
    } catch {
      return {};
    }
  }

  function hasKey() {
    return Boolean(settings().apiKey);
  }

  function textModel() {
    return settings().model || DEFAULT_MODEL;
  }

  // Google retires models for new users from time to time. When the saved
  // model is refused, pick the newest Flash model this key can use, remember
  // it, and let the caller retry.
  async function pickNewestFlash() {
    const { apiKey } = settings();
    const res = await fetch(BASE.replace(/models\/$/, 'models?pageSize=200'), { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) return null;
    const { models = [] } = await res.json();
    const version = (name) => Number((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
    const best = models
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash$/.test(n))
      .sort((a, b) => version(b) - version(a))[0];
    if (best) {
      try {
        localStorage.setItem('kahyo.settings', JSON.stringify({ ...settings(), model: best }));
      } catch {}
    }
    return best || null;
  }

  function isRetired(status, msg) {
    return status === 404 || /no longer available|not found|is not supported|deprecated/i.test(msg);
  }

  async function generate(body) {
    try {
      return await call(textModel(), 'generateContent', body);
    } catch (e) {
      if (!isRetired(e.status, e.message)) throw e;
      const next = await pickNewestFlash();
      if (!next || next === e.model) throw e;
      return call(next, 'generateContent', body);
    }
  }

  async function call(model, method, body) {
    const { apiKey } = settings();
    if (!apiKey) throw new Error('No Gemini API key set. Open Settings to add one.');
    const res = await fetch(`${BASE}${model}:${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const err = await res.json();
        msg = err.error?.message || msg;
      } catch {}
      if (res.status === 429) msg = 'Free-tier rate limit reached. Wait a minute and try again. (' + msg + ')';
      const err = new Error(msg);
      err.status = res.status;
      err.model = model;
      throw err;
    }
    return res.json();
  }

  async function generateJSON(prompt, schemaHint) {
    const data = await generate({
      contents: [{ role: 'user', parts: [{ text: prompt + '\n\nReturn JSON only, matching:\n' + schemaHint }] }],
      generationConfig: { responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } },
    });
    const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join('') || '';
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('The model returned something that was not JSON. Try again.');
    }
  }

  async function generateText(prompt, generationConfig) {
    const data = await generate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(generationConfig ? { generationConfig } : {}),
    });
    return data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join('') || '';
  }

  // The batch endpoint takes at most 100 texts per call.
  async function embed(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += 100) {
      const data = await call(EMBED_MODEL, 'batchEmbedContents', {
        requests: texts.slice(i, i + 100).map((t) => ({
          model: 'models/' + EMBED_MODEL,
          content: { parts: [{ text: t }] },
          taskType: 'SEMANTIC_SIMILARITY',
          outputDimensionality: EMBED_DIM,
        })),
      });
      out.push(...data.embeddings.map((e) => e.values));
    }
    return out;
  }

  root.LLM = { settings, hasKey, generateJSON, generateText, embed, EMBED_DIM, DEFAULT_MODEL };
})(window);
