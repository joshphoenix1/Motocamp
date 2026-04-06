/* ===== User Auth & Data Sync via Supabase ===== */
const Auth = {
  SUPABASE_URL: 'https://ouvontpojtaygamephte.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_s3sS4j1G-nHHEyaArio5dQ_UBtglZxL',

  _client: null,
  _user: null,

  // Initialize Supabase client
  init() {
    if (this.SUPABASE_URL.includes('YOUR_PROJECT')) {
      console.log('[Auth] Supabase not configured — running in local-only mode');
      this._renderAuthUI();
      return;
    }

    if (typeof supabase === 'undefined') {
      console.warn('[Auth] Supabase JS not loaded');
      return;
    }

    this._client = supabase.createClient(this.SUPABASE_URL, this.SUPABASE_ANON_KEY);

    // Check for existing session
    this._client.auth.getSession().then(({ data }) => {
      if (data.session) {
        this._user = data.session.user;
        this._onLogin();
      }
      this._renderAuthUI();
    });

    // Listen for auth changes
    this._client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        this._user = session.user;
        this._onLogin();
      } else if (event === 'SIGNED_OUT') {
        this._user = null;
        this._onLogout();
      }
      this._renderAuthUI();
    });
  },

  // ===== Auth Actions =====

  async signUp(email, password) {
    if (!this._client) return { error: 'Auth not configured' };
    const { data, error } = await this._client.auth.signUp({ email, password });
    if (error) return { error: error.message };
    return { data, message: 'Check your email for a confirmation link.' };
  },

  async signIn(email, password) {
    if (!this._client) return { error: 'Auth not configured' };
    const { data, error } = await this._client.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message };
    return { data };
  },

  async signInWithGoogle() {
    if (!this._client) return;
    await this._client.auth.signInWithOAuth({ provider: 'google' });
  },

  async signOut() {
    if (!this._client) return;
    await this._client.auth.signOut();
  },

  isLoggedIn() {
    return !!this._user;
  },

  getUser() {
    return this._user;
  },

  // ===== Data Sync =====

  async saveRoute(route) {
    if (!this._client || !this._user) {
      // Save locally only
      const saved = JSON.parse(localStorage.getItem('motorcamp-routes') || '[]');
      saved.push(route);
      localStorage.setItem('motorcamp-routes', JSON.stringify(saved));
      return;
    }

    await this._client.from('routes').insert({
      user_id: this._user.id,
      name: route.name,
      data: route,
      created_at: new Date().toISOString(),
    });
  },

  async getRoutes() {
    if (!this._client || !this._user) {
      return JSON.parse(localStorage.getItem('motorcamp-routes') || '[]');
    }

    const { data } = await this._client
      .from('routes')
      .select('*')
      .eq('user_id', this._user.id)
      .order('created_at', { ascending: false });

    return (data || []).map(r => r.data);
  },

  async saveFavourite(lat, lon, name, type) {
    if (!this._client || !this._user) {
      const favs = JSON.parse(localStorage.getItem('motorcamp-favourites') || '[]');
      favs.push({ lat, lon, name, type, savedAt: Date.now() });
      localStorage.setItem('motorcamp-favourites', JSON.stringify(favs));
      return;
    }

    await this._client.from('favourites').insert({
      user_id: this._user.id,
      lat, lon, name, type,
      created_at: new Date().toISOString(),
    });
  },

  async getFavourites() {
    if (!this._client || !this._user) {
      return JSON.parse(localStorage.getItem('motorcamp-favourites') || '[]');
    }

    const { data } = await this._client
      .from('favourites')
      .select('*')
      .eq('user_id', this._user.id)
      .order('created_at', { ascending: false });

    return data || [];
  },

  async savePreferences(prefs) {
    if (!this._client || !this._user) {
      localStorage.setItem('motorcamp-prefs', JSON.stringify(prefs));
      return;
    }

    await this._client.from('preferences').upsert({
      user_id: this._user.id,
      data: prefs,
      updated_at: new Date().toISOString(),
    });
  },

  async getPreferences() {
    if (!this._client || !this._user) {
      return JSON.parse(localStorage.getItem('motorcamp-prefs') || '{}');
    }

    const { data } = await this._client
      .from('preferences')
      .select('data')
      .eq('user_id', this._user.id)
      .single();

    return data?.data || {};
  },

  // ===== Lifecycle hooks =====

  _onLogin() {
    console.log('[Auth] Logged in:', this._user.email);
    // Sync local data up to cloud on first login
    this._syncLocalToCloud();
  },

  _onLogout() {
    console.log('[Auth] Logged out');
  },

  async _syncLocalToCloud() {
    // Push any locally-saved routes to the cloud
    const localRoutes = JSON.parse(localStorage.getItem('motorcamp-routes') || '[]');
    if (localRoutes.length > 0 && this._client && this._user) {
      for (const route of localRoutes) {
        await this._client.from('routes').insert({
          user_id: this._user.id,
          name: route.name,
          data: route,
          created_at: new Date(route.timestamp || Date.now()).toISOString(),
        });
      }
      localStorage.removeItem('motorcamp-routes');
      console.log(`[Auth] Synced ${localRoutes.length} local routes to cloud`);
    }
  },

  // ===== UI =====

  _renderAuthUI() {
    const container = document.getElementById('auth-section');
    if (!container) return;

    if (this._user) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <div style="min-width:0">
            <div style="font-size:0.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              <i class="fas fa-user-circle" style="color:var(--accent)"></i> ${this._user.email}
            </div>
          </div>
          <button onclick="Auth.signOut()" class="btn btn-sm" style="flex-shrink:0;font-size:0.7rem">Sign out</button>
        </div>
      `;
    } else if (!this._client) {
      // Not configured — show nothing or a subtle note
      container.innerHTML = '';
    } else {
      container.innerHTML = `
        <div id="auth-form">
          <input type="email" id="auth-email" placeholder="Email" autocomplete="email"
                 style="width:100%;padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-tertiary);color:var(--text-primary);font-size:0.82rem;margin-bottom:6px">
          <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password"
                 style="width:100%;padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border);background:var(--bg-tertiary);color:var(--text-primary);font-size:0.82rem;margin-bottom:8px">
          <div id="auth-error" style="font-size:0.72rem;color:#ff5252;margin-bottom:6px;display:none"></div>
          <div style="display:flex;gap:6px">
            <button onclick="Auth._doSignIn()" class="btn btn-sm btn-primary" style="flex:1;font-size:0.78rem">Sign in</button>
            <button onclick="Auth._doSignUp()" class="btn btn-sm" style="flex:1;font-size:0.78rem">Sign up</button>
          </div>
          <button onclick="Auth.signInWithGoogle()" class="btn btn-sm" style="width:100%;margin-top:6px;font-size:0.75rem">
            <i class="fab fa-google"></i> Continue with Google
          </button>
        </div>
      `;
    }
  },

  async _doSignIn() {
    const email = document.getElementById('auth-email')?.value;
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) return;

    const result = await this.signIn(email, password);
    if (result.error) {
      const errEl = document.getElementById('auth-error');
      if (errEl) { errEl.textContent = result.error; errEl.style.display = 'block'; }
    }
  },

  async _doSignUp() {
    const email = document.getElementById('auth-email')?.value;
    const password = document.getElementById('auth-password')?.value;
    if (!email || !password) return;

    const result = await this.signUp(email, password);
    const errEl = document.getElementById('auth-error');
    if (result.error) {
      if (errEl) { errEl.textContent = result.error; errEl.style.display = 'block'; }
    } else if (result.message) {
      if (errEl) { errEl.textContent = result.message; errEl.style.display = 'block'; errEl.style.color = '#00c853'; }
    }
  },
};
