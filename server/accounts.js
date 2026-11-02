// Accounts and saved Journeys, backed by Supabase (Auth + Postgres). The browser
// only talks to this Worker; the Supabase address and key stay here.
//   POST /api/account  { op, ... }  sign up, log in, refresh, log out, reset, profile, delete
//   POST /api/journeys { op, ... }  list, put, delete; needs header Authorization: Bearer <access token>
// Row level security in Supabase (see supabase/schema.sql) makes sure a person can
// only ever read or change their own Journeys, whatever this file does.

function fail(message, status) {
  return Object.assign(new Error(message), { status });
}

export function configured(env) {
  return Boolean(env && env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
}

// Supabase's own wording is not always kind. These are the ones people will meet.
function friendly(status, data) {
  const raw = (data && (data.msg || data.message || data.error_description || data.error)) || '';
  const code = data && (data.error_code || data.code);
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(raw)) return 'That email and password do not match.';
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(raw)) return 'Please confirm your email first. Check your inbox for the link.';
  if (code === 'user_already_exists' || /already registered/i.test(raw)) return 'An account with this email already exists. Log in instead.';
  if (code === 'weak_password' || /password should/i.test(raw)) return 'Pick a password with at least 8 characters.';
  if (code === 'over_email_send_rate_limit' || status === 429) return 'Too many tries. Wait a minute and try again.';
  if (code === 'refresh_token_not_found' || /refresh token/i.test(raw)) return 'Your session ended. Please log in again.';
  if (status === 401 || status === 403) return 'Your session ended. Please log in again.';
  return raw || 'Something went wrong with your account. Try again.';
}

async function supa(env, path, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + path, {
    method,
    headers: {
      // Works with the new publishable key (sb_publishable_…) and the older anon key:
      // the key goes in apikey; Authorization only carries a signed-in person's token.
      apikey: env.SUPABASE_ANON_KEY,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { message: text };
  }
  if (!res.ok) throw fail(friendly(res.status, data), res.status === 400 || res.status === 422 ? 400 : res.status);
  return data;
}

// What the app keeps about a person: never the raw Supabase objects.
function person(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: (user.user_metadata && user.user_metadata.name) || '', confirmed: Boolean(user.email_confirmed_at || user.confirmed_at) };
}

function session(data) {
  if (!data || !data.access_token) return null;
  return { access: data.access_token, refresh: data.refresh_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 254) throw fail('Enter a valid email address.', 400);
  return e;
}

function cleanPassword(v) {
  const p = String(v || '');
  if (p.length < 8) throw fail('Pick a password with at least 8 characters.', 400);
  if (p.length > 72) throw fail('Keep the password under 72 characters.', 400);
  return p;
}

function bearer(request) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  if (!m) throw fail('Please log in.', 401);
  return m[1];
}

// The user id inside a Supabase access token. Supabase checks the signature on every
// call; this is only used to fill the row's owner, which row level security re-checks.
function tokenUser(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4)));
    if (!json.sub) throw 0;
    return json.sub;
  } catch {
    throw fail('Your session ended. Please log in again.', 401);
  }
}

export async function account(body, request, env) {
  const origin = new URL(request.url).origin;
  const back = encodeURIComponent(origin + '/');
  switch (body.op) {
    case 'signup': {
      const name = String(body.name || '').trim().slice(0, 80);
      const data = await supa(env, `/auth/v1/signup?redirect_to=${back}`, {
        method: 'POST',
        body: { email: cleanEmail(body.email), password: cleanPassword(body.password), data: { name } },
      });
      // With email confirmation on, Supabase sends the link and returns no session yet.
      const s = session(data);
      return { user: person(data.user || data), session: s, confirm: !s };
    }
    case 'login': {
      const data = await supa(env, '/auth/v1/token?grant_type=password', {
        method: 'POST',
        body: { email: cleanEmail(body.email), password: String(body.password || '') },
      });
      return { user: person(data.user), session: session(data) };
    }
    case 'refresh': {
      if (!body.refresh) throw fail('Please log in again.', 401);
      const data = await supa(env, '/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: String(body.refresh) } });
      return { user: person(data.user), session: session(data) };
    }
    case 'me':
      return { user: person(await supa(env, '/auth/v1/user', { token: bearer(request) })) };
    case 'logout':
      await supa(env, '/auth/v1/logout', { method: 'POST', token: bearer(request), body: {} }).catch(() => {});
      return { ok: true };
    case 'reset':
      await supa(env, `/auth/v1/recover?redirect_to=${back}`, { method: 'POST', body: { email: cleanEmail(body.email) } });
      // Same answer whether or not the email has an account, so nobody can probe for one.
      return { ok: true };
    case 'update': {
      const patch = {};
      if (body.name !== undefined) patch.data = { name: String(body.name || '').trim().slice(0, 80) };
      if (body.password !== undefined) patch.password = cleanPassword(body.password);
      return { user: person(await supa(env, '/auth/v1/user', { method: 'PUT', token: bearer(request), body: patch })) };
    }
    case 'delete':
      // supabase/schema.sql: deletes the caller's own account; their Journeys go with it.
      await supa(env, '/rest/v1/rpc/delete_my_account', { method: 'POST', token: bearer(request), body: {} });
      return { ok: true };
    default:
      throw fail('Unknown account call.', 400);
  }
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function journeys(body, request, env) {
  const token = bearer(request);
  switch (body.op) {
    case 'list': {
      // Just the cards; a Journey's full data comes with 'get'.
      const rows = await supa(env, '/rest/v1/journeys?select=id,title,nsmm,summary,updated_at&order=updated_at.desc', { token });
      return { journeys: rows.map((r) => ({ id: r.id, title: r.title, nsmm: r.nsmm, summary: r.summary || {}, updated: Date.parse(r.updated_at) })) };
    }
    case 'get': {
      if (!ID.test(body.id || '')) throw fail('Bad Journey id.', 400);
      const rows = await supa(env, `/rest/v1/journeys?select=data,updated_at&id=eq.${body.id}`, { token });
      if (!rows.length) throw fail('That Journey is not in your account.', 404);
      return { journey: rows[0].data };
    }
    case 'put': {
      const j = body.journey;
      if (!j || typeof j !== 'object' || !ID.test(j.id || '')) throw fail('Bad Journey.', 400);
      const row = {
        user_id: tokenUser(token),
        id: j.id,
        title: String(j.title || 'Untitled Journey').slice(0, 200),
        nsmm: String(j.nsmm || 'wordwalk').slice(0, 40),
        summary: body.summary && typeof body.summary === 'object' ? body.summary : {},
        data: j,
        updated_at: new Date(Number(j.updated) || Date.now()).toISOString(),
      };
      await supa(env, '/rest/v1/journeys?on_conflict=user_id,id', {
        method: 'POST',
        token,
        body: row,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      });
      return { ok: true };
    }
    case 'delete': {
      if (!ID.test(body.id || '')) throw fail('Bad Journey id.', 400);
      await supa(env, `/rest/v1/journeys?id=eq.${body.id}`, { method: 'DELETE', token, headers: { Prefer: 'return=minimal' } });
      return { ok: true };
    }
    default:
      throw fail('Unknown Journey call.', 400);
  }
}
