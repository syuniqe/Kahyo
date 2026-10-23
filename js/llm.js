// Gemini client (free tier). The key lives only in this browser's localStorage
// and is sent only to Google's API.

(function (root) {
  const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const EMBED_MODEL = 'gemini-embedding-001';
  const EMBED_DIM = 768;

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
      throw new Error(msg);
    }
    return res.json();
  }

  async function generateJSON(prompt, schemaHint) {
    const model = settings().model || 'gemini-2.5-flash';
    const data = await call(model, 'generateContent', {
      contents: [{ role: 'user', parts: [{ text: prompt + '\n\nReturn JSON only, matching:\n' + schemaHint }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
    });
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) return JSON.parse(m[0]);
      throw new Error('The model returned something that was not JSON. Try again.');
    }
  }

  async function generateText(prompt) {
    const model = settings().model || 'gemini-2.5-flash';
    const data = await call(model, 'generateContent', {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8 },
    });
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  }

  async function embed(texts) {
    if (texts.length === 0) return [];
    const data = await call(EMBED_MODEL, 'batchEmbedContents', {
      requests: texts.map((t) => ({
        model: 'models/' + EMBED_MODEL,
        content: { parts: [{ text: t }] },
        taskType: 'SEMANTIC_SIMILARITY',
        outputDimensionality: EMBED_DIM,
      })),
    });
    return data.embeddings.map((e) => e.values);
  }

  root.LLM = { settings, hasKey, generateJSON, generateText, embed, EMBED_DIM };
})(window);
