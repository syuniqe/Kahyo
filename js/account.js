// Kāhyo accounts (beta). Talks only to Kāhyo's Worker (/api/account, /api/journeys),
// which talks to Supabase. Keeps the session in this browser and renews it before it
// runs out, so a writer stays logged in until they log out.

(function (root) {
  const KEY = 'kahyo.session';
  let enabled = null; // null until the server says whether accounts are on
  let state = load();
  const listeners = [];

  // Remember me: the session is kept in this browser until logging out. Without it,
  // it lasts only until the browser is closed. Passwords are never stored by Kāhyo;
  // the browser's own password manager offers to save them.
  const REMEMBER = 'kahyo.remember';
  let remember = true;
  try {
    remember = localStorage.getItem(REMEMBER) !== 'no';
  } catch {}

  function load() {
    for (const box of [() => localStorage, () => sessionStorage]) {
      try {
        const s = JSON.parse(box().getItem(KEY));
        if (s && s.session && s.user) return s;
      } catch {}
    }
    return null;
  }

  function store(next) {
    state = next;
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
      if (next) (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(next));
    } catch {}
    listeners.forEach((fn) => fn(state && state.user));
  }

  async function post(path, body, token) {
    let res;
    try {
      res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(body),
      });
    } catch {
      throw Object.assign(new Error('Kāhyo is offline. Check your connection.'), { offline: true });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
    return data;
  }

  async function config() {
    if (enabled !== null) return enabled;
    try {
      enabled = Boolean((await post('/api/account', { op: 'config' })).accounts);
    } catch {
      // Offline: if this browser was logged in, keep working from its saved copy.
      return Boolean(state);
    }
    return enabled;
  }

  function signedIn(data) {
    if (!data.session) return null;
    store({ user: data.user, session: data.session });
    return data.user;
  }

  let renewing = null;
  async function renew() {
    if (!state) throw Object.assign(new Error('Please log in.'), { status: 401 });
    if (!renewing)
      renewing = post('/api/account', { op: 'refresh', refresh: state.session.refresh })
        .then((d) => signedIn(d))
        .catch((e) => {
          if (e.status === 401 || e.status === 400) store(null);
          throw e;
        })
        .finally(() => (renewing = null));
    return renewing;
  }

  // A call that needs the person: renews the session first if it is about to end,
  // and once more if the server says it has ended.
  async function authed(path, body) {
    if (!state) throw Object.assign(new Error('Please log in.'), { status: 401 });
    if (state.session.expires - 60000 < Date.now()) await renew();
    try {
      return await post(path, body, state.session.access);
    } catch (e) {
      if (e.status !== 401) throw e;
      await renew();
      return post(path, body, state.session.access);
    }
  }

  // Email links (confirm, reset password) come back as #access_token=…&refresh_token=…&type=…
  async function fromLink() {
    const h = location.hash.replace(/^#/, '');
    if (!/(^|&)(access_token|error)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (p.get('error')) return { error: (p.get('error_description') || 'That link did not work.').replace(/\+/g, ' ') + ' Ask for a new one.' };
    const session = { access: p.get('access_token'), refresh: p.get('refresh_token'), expires: Date.now() + Number(p.get('expires_in') || 3600) * 1000 };
    try {
      const { user } = await post('/api/account', { op: 'me' }, session.access);
      store({ user, session });
      return { type: p.get('type') || 'signup', user };
    } catch (e) {
      return { error: e.message };
    }
  }

  root.Account = {
    config,
    fromLink,
    user: () => state && state.user,
    onChange: (fn) => listeners.push(fn),
    // Remember me, and the last email used to log in on this device.
    remembered() {
      let email = '';
      try {
        email = localStorage.getItem('kahyo.email') || '';
      } catch {}
      return { remember, email };
    },
    setRemember(on, email) {
      remember = Boolean(on);
      try {
        localStorage.setItem(REMEMBER, remember ? 'yes' : 'no');
        if (remember && email) localStorage.setItem('kahyo.email', email);
        else localStorage.removeItem('kahyo.email');
      } catch {}
    },
    async signUp(name, email, password, terms) {
      const d = await post('/api/account', { op: 'signup', name, email, password, terms: Boolean(terms) });
      return { user: signedIn(d), confirm: d.confirm };
    },
    async logIn(email, password) {
      return signedIn(await post('/api/account', { op: 'login', email, password }));
    },
    async logOut() {
      const s = state;
      store(null);
      if (s) await post('/api/account', { op: 'logout' }, s.session.access).catch(() => {});
    },
    reset: (email) => post('/api/account', { op: 'reset', email }),
    async update(patch) {
      const { user } = await authed('/api/account', { op: 'update', ...patch });
      store({ ...state, user });
      return user;
    },
    async deleteAccount() {
      await authed('/api/account', { op: 'delete' });
      store(null);
    },
    cloud: {
      list: () => authed('/api/journeys', { op: 'list' }).then((d) => d.journeys),
      get: (id) => authed('/api/journeys', { op: 'get', id }).then((d) => d.journey),
      put: (journey, summary) => authed('/api/journeys', { op: 'put', journey, summary }),
      remove: (id) => authed('/api/journeys', { op: 'delete', id }),
    },
  };
})(window);
