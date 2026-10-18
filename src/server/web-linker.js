import crypto from 'crypto';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { saveToken, setActiveLabel } from '../database/sqlite.js';

// Memory store for active account linking sessions (TTL: 15 minutes)
const activeConnectSessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;

export function getPublicBaseUrl() {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || 'https://orbhunter-discord-quest.onrender.com';
  return url.replace(/\/+$/, '');
}

export function createConnectSession({ uid, username, label = 'main', onLinked }) {
  const id = crypto.randomUUID();
  const session = {
    id,
    uid,
    username: username || 'Felhasználó',
    label,
    onLinked,
    createdAt: Date.now(),
  };

  activeConnectSessions.set(id, session);

  // Auto cleanup
  setTimeout(() => {
    activeConnectSessions.delete(id);
  }, SESSION_TTL_MS);

  return id;
}

export function getConnectSession(id) {
  const session = activeConnectSessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    activeConnectSessions.delete(id);
    return null;
  }
  return session;
}

export function renderConnectPage(session) {
  const baseUrl = getPublicBaseUrl();
  const bookmarkletCode = `javascript:(function(){try{var t=null;try{var f=document.createElement('iframe');document.body.appendChild(f);t=JSON.parse(f.contentWindow.localStorage.token);f.remove();}catch(e){}if(!t){try{t=(webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken();}catch(e){}}if(!t){alert('Nem sikerült azonosítani a munkamenetet! Kérlek lépj be a Discordba a böngésződben (discord.com/app)!');return;}var l=prompt('Fiók Címke / Elnevezés (pl. main, alt):', '${session.label || 'main'}')||'${session.label || 'main'}';window.location.href='${baseUrl}/connect/${session.id}?token='+encodeURIComponent(t)+'&label='+encodeURIComponent(l);}catch(err){alert('Hiba: '+err.message);}})();`;

  const isAlreadyLinked = !!session.linkedUser;
  const username = session.linkedUser || session.username;

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrbHunter — Fiók Csatlakoztatása</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0e14;
      --card-bg: rgba(22, 27, 34, 0.94);
      --border: rgba(88, 101, 242, 0.35);
      --accent: #5865f2;
      --accent-glow: rgba(88, 101, 242, 0.5);
      --accent-pink: #eb459e;
      --text: #f2f3f5;
      --text-muted: #949ba4;
      --success: #23a55a;
      --error: #ed4245;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 15%, #181c38 0%, var(--bg) 75%);
      color: var(--text);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(20px);
      border: 1px solid var(--border);
      box-shadow: 0 16px 50px rgba(0, 0, 0, 0.7), 0 0 40px var(--accent-glow);
      border-radius: 24px;
      padding: 40px 32px;
      width: 100%;
      max-width: 480px;
      text-align: center;
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--accent), var(--accent-pink), #fee75c, var(--accent));
      background-size: 300% 100%;
      animation: gradientMove 4s linear infinite;
    }
    @keyframes gradientMove {
      0% { background-position: 0% 50%; }
      100% { background-position: 300% 50%; }
    }
    .badge-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      border-radius: 20px;
      background: rgba(88, 101, 242, 0.16);
      border: 1px solid rgba(88, 101, 242, 0.35);
      font-size: 32px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 6px;
      letter-spacing: -0.3px;
    }
    .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .tab-container {
      display: flex;
      gap: 8px;
      background: rgba(0, 0, 0, 0.3);
      padding: 4px;
      border-radius: 12px;
      margin-bottom: 20px;
    }
    .tab-btn {
      flex: 1;
      padding: 10px;
      border-radius: 8px;
      border: none;
      background: transparent;
      color: var(--text-muted);
      font-family: inherit;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--accent);
      color: #fff;
      box-shadow: 0 2px 10px rgba(88, 101, 242, 0.4);
    }
    .tab-pane {
      display: none;
      text-align: left;
    }
    .tab-pane.active {
      display: block;
    }
    .bookmarklet-box {
      background: rgba(88, 101, 242, 0.1);
      border: 1px dashed rgba(88, 101, 242, 0.4);
      border-radius: 14px;
      padding: 20px;
      text-align: center;
      margin-bottom: 16px;
    }
    .bookmarklet-link {
      display: inline-block;
      background: linear-gradient(135deg, #5865f2 0%, #4752c4 100%);
      color: #fff !important;
      text-decoration: none;
      font-weight: 700;
      font-size: 15px;
      padding: 12px 24px;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(88, 101, 242, 0.4);
      cursor: grab;
      margin-bottom: 12px;
    }
    .bookmarklet-link:active {
      cursor: grabbing;
    }
    .instructions-list {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.6;
      padding-left: 18px;
      margin-bottom: 16px;
    }
    .instructions-list li {
      margin-bottom: 6px;
    }
    .instructions-list b {
      color: var(--text);
    }
    .input-label {
      font-size: 12.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
      display: block;
    }
    .input-wrap {
      position: relative;
      margin-bottom: 14px;
    }
    .input-field {
      width: 100%;
      background: rgba(0, 0, 0, 0.45);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 13px 16px;
      color: var(--text);
      font-family: inherit;
      font-size: 14.5px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.3);
    }
    .submit-btn {
      display: block;
      width: 100%;
      background: linear-gradient(135deg, #5865f2 0%, #4752c4 100%);
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      padding: 13px 20px;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      box-shadow: 0 4px 15px rgba(88, 101, 242, 0.35);
    }
    .submit-btn:hover {
      box-shadow: 0 6px 20px rgba(88, 101, 242, 0.5);
    }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .guide-box {
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 14px;
      margin-top: 14px;
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.5;
    }
    .guide-box summary {
      cursor: pointer;
      font-weight: 600;
      color: var(--accent);
      outline: none;
      margin-bottom: 6px;
    }
    .status-msg {
      margin-top: 16px;
      font-size: 13.5px;
      border-radius: 12px;
      padding: 12px 14px;
      line-height: 1.4;
      display: none;
      text-align: left;
    }
    .status-msg.error {
      display: block;
      background: rgba(237, 66, 69, 0.16);
      border: 1px solid var(--error);
      color: #ff7b72;
    }
    .success-card {
      background: rgba(35, 165, 90, 0.16);
      border: 1px solid var(--success);
      border-radius: 18px;
      padding: 28px 20px;
      text-align: center;
    }
    .success-card h2 {
      font-size: 22px;
      color: #57f287;
      margin-bottom: 8px;
    }
    .success-card p {
      font-size: 14px;
      color: #dbdee1;
      line-height: 1.5;
    }
    .footer-note {
      margin-top: 24px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.35);
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge-icon">🎮</div>
    <h1>OrbHunter Csatlakozás</h1>
    <p class="subtitle">Üdv, <b>${session.username}</b>! Csatlakoztasd a fiókodat az automatikus küldetéskezeléshez.</p>

    <div id="connectArea" style="display: ${isAlreadyLinked ? 'none' : 'block'};">
      <div class="tab-container">
        <button type="button" class="tab-btn active" onclick="switchTab('bookmarklet')">⚡ 1-Kattintás (Gép)</button>
        <button type="button" class="tab-btn" onclick="switchTab('direct')">🔑 Közvetlen Belépés</button>
      </div>

      <!-- Tab 1: 1-Click Bookmarklet (Desktop Browsers) -->
      <div id="tabBookmarklet" class="tab-pane active">
        <div class="bookmarklet-box">
          <a class="bookmarklet-link" href="${bookmarkletCode}">⚡ OrbHunter Csatlakozás</a>
          <p style="font-size: 12px; color: var(--text-muted);">Húzd fel ezt a kék gombot a könyvjelzősávodra!</p>
        </div>

        <ol class="instructions-list">
          <li><b>1.</b> Húzd fel a fenti kék gombot a <b>Könyvjelzősávodra</b> (Ctrl+Shift+B ha nem látod).</li>
          <li><b>2.</b> Nyisd meg a Discordot a böngészőben (<code>discord.com/app</code>).</li>
          <li><b>3.</b> Kattints a könyvjelzőre ➔ Azonnal aktiválódik a profilod és ide visszatér!</li>
        </ol>
      </div>

      <!-- Tab 2: Direct Token Input (Universal for Mobile & PC) -->
      <div id="tabDirect" class="tab-pane">
        <form onsubmit="handleDirectSubmit(event)">
          <label class="input-label" for="userTokenInput">Discord Fiók-kulcs (Token) *</label>
          <div class="input-wrap">
            <input type="password" id="userTokenInput" class="input-field" placeholder="Illeszd be ide a fiók-kulcsodat..." autocomplete="off" required>
          </div>

          <label class="input-label" for="accountLabelInput">Fiók Címke / Elnevezés (pl. main, alt, farm)</label>
          <div class="input-wrap">
            <input type="text" id="accountLabelInput" class="input-field" placeholder="pl. main, másodlagos, alt..." value="${session.label || 'main'}">
          </div>

          <button type="submit" id="directSubmitBtn" class="submit-btn">🚀 Fiók Csatlakoztatása</button>
        </form>

        <div id="directStatus" class="status-msg ${session.linkError ? 'error' : ''}">
          ${session.linkError ? '❌ <b>Hiba:</b> ' + session.linkError : ''}
        </div>

        <details class="guide-box">
          <summary>🔍 Hogyan találom meg a kulcsomat 10 másodperc alatt?</summary>
          <p><b>Számítógépen:</b> Nyisd meg a Discordot a böngésződben ➔ Nyomj <code>F12</code>-t (Fejlesztői eszközök) ➔ Menj a <b>Network</b> fülre ➔ Kattints bármelyik sorra ➔ Keresd meg a <b>Headers</b> alatt az <code>authorization</code> mezőt.</p>
          <p style="margin-top:6px;"><b>Biztonság:</b> A kulcsod AES-256 titkosítással tárolódik a saját szervereden. Senki más nem látja.</p>
        </details>
      </div>
    </div>

    <!-- Success View -->
    <div id="successCard" class="success-card" style="display: ${isAlreadyLinked ? 'block' : 'none'};">
      <div style="font-size: 44px; margin-bottom: 12px;">🎉</div>
      <h2 id="successUsername">Üdv, ${username}!</h2>
      <span id="successLabelBadge" style="display:inline-block; background:rgba(88,101,242,0.3); border:1px solid #5865f2; border-radius:8px; padding:4px 12px; font-size:13px; font-weight:600; margin-bottom:12px; color:#f2f3f5;">Címke: ${session.label || 'main'}</span>
      <p>A Discord fiókodat sikeresen összekapcsoltuk az OrbHunterrel.<br><br>A bot készen áll a küldetések automatizálására!</p>
      
      <div style="display:flex; gap:10px; margin-top:20px; justify-content:center; flex-wrap:wrap;">
        <button type="button" class="submit-btn" style="flex:1; min-width:180px; background:#23a55a;" onclick="addAnotherAccount()">➕ Másik Fiók Hozzáadása</button>
        <a href="https://discord.com/app" class="submit-btn" style="flex:1; min-width:180px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center;">🎮 Vissza a Discordba</a>
      </div>
    </div>

    <p class="footer-note">🔒 Biztonságos felhő • Adataid AES-256 titkosítással védve a Renderen tárolódnak.</p>
  </div>

  <script>
    var sessionId = '${session.id}';

    // Clean sensitive token param from browser address bar immediately
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(function(b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-pane').forEach(function(p) { p.classList.remove('active'); });
      if (tab === 'direct') {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('tabDirect').classList.add('active');
      } else {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('tabBookmarklet').classList.add('active');
      }
    }

    function showSuccess(username, label) {
      document.getElementById('connectArea').style.display = 'none';
      var succ = document.getElementById('successCard');
      succ.style.display = 'block';
      if (username) {
        document.getElementById('successUsername').innerText = 'Üdv, ' + username + '!';
      }
      if (label) {
        var badge = document.getElementById('successLabelBadge');
        if (badge) {
          badge.innerText = 'Címke: ' + label;
          badge.style.display = 'inline-block';
        }
      }
    }

    function addAnotherAccount() {
      document.getElementById('successCard').style.display = 'none';
      document.getElementById('connectArea').style.display = 'block';
      var tokenInput = document.getElementById('userTokenInput');
      if (tokenInput) tokenInput.value = '';
      var labelInput = document.getElementById('accountLabelInput');
      if (labelInput) labelInput.value = 'alt' + Math.floor(Math.random() * 89 + 10);
      var btn = document.getElementById('directSubmitBtn');
      if (btn) {
        btn.disabled = false;
        btn.innerText = '🚀 Fiók Csatlakoztatása';
      }
    }

    function handleDirectSubmit(e) {
      e.preventDefault();
      var input = document.getElementById('userTokenInput');
      var labelInput = document.getElementById('accountLabelInput');
      var token = input.value.trim().replace(/^"(.*)"$/, '$1');
      var label = labelInput ? labelInput.value.trim() : 'main';
      var btn = document.getElementById('directSubmitBtn');
      var status = document.getElementById('directStatus');

      if (!token) return;

      btn.disabled = true;
      btn.innerText = 'Csatlakoztatás folyamatban...';
      status.style.display = 'none';

      fetch('/api/connect/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sessionId, token: token, label: label })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          showSuccess(res.username, res.label);
        } else {
          status.className = 'status-msg error';
          status.style.display = 'block';
          status.innerHTML = '❌ <b>Hiba:</b> ' + (res.error || 'Érvénytelen kulcs.');
          btn.disabled = false;
          btn.innerText = '🚀 Fiók Csatlakoztatása';
        }
      })
      .catch(function(err) {
        status.className = 'status-msg error';
        status.style.display = 'block';
        status.innerHTML = '❌ <b>Hálózati hiba:</b> ' + err.message;
        btn.disabled = false;
        btn.innerText = '🚀 Fiók Csatlakoztatása';
      });
    }

    // Live polling: if linked via bookmarklet or in-Discord
    var checkInterval = setInterval(function() {
      fetch('/api/connect/status?id=' + encodeURIComponent(sessionId))
        .then(function(r) { return r.json(); })
        .then(function(res) {
          if (res.linked) {
            clearInterval(checkInterval);
            showSuccess(res.username, res.label);
          }
        })
        .catch(function() {});
    }, 2000);
  </script>
</body>
</html>`;
}

export async function handleConnectRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Route 1: GET /connect/:id
  if (req.method === 'GET' && url.pathname.startsWith('/connect/')) {
    const id = url.pathname.replace('/connect/', '').trim();
    const session = getConnectSession(id);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body style="background:#0b0e14;color:#f2f3f5;font-family:sans-serif;text-align:center;padding:50px;">
        <h2>❌ A csatlakozási munkamenet lejárt vagy érvénytelen.</h2>
        <p style="color:#949ba4;">Indíts új bejelentkezést a Discord felületén a <code>/login</code> paranccsal vagy a vezérlőpult gombjával.</p>
      </body></html>`);
      return true;
    }

    // Handle token supplied via bookmarklet navigation (?token=...&label=...)
    const tokenParam = url.searchParams.get('token');
    const labelParam = url.searchParams.get('label');
    if (tokenParam && !session.linkedUser) {
      try {
        const cleanToken = tokenParam.trim().replace(/^"(.*)"$/, '$1');
        const targetLabel = (labelParam?.trim() || session.label || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main';
        const api = new DiscordUserAPI(cleanToken);
        const user = await api.getCurrentUser();
        const savedUsername = user.global_name || user.username;

        saveToken(session.uid, targetLabel, cleanToken, {
          id: user.id,
          username: savedUsername,
        });
        setActiveLabel(session.uid, targetLabel);

        session.linkedUser = savedUsername;
        session.label = targetLabel;

        if (typeof session.onLinked === 'function') {
          session.onLinked({ user, token: cleanToken, label: targetLabel }).catch(e => console.warn('[WebLinker] onLinked error:', e.message));
        }

        console.log(`[WebLinker] ✅ 1-Kattintásos felhős csatlakozás: ${savedUsername} [${targetLabel}] (${user.id})`);
      } catch (err) {
        console.error('[WebLinker] Token query error:', err.message);
        session.linkError = err.message;
      }
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderConnectPage(session));
    return true;
  }

  // Route 2: GET /api/connect/status?id=... (Live status polling)
  if (req.method === 'GET' && url.pathname === '/api/connect/status') {
    const id = url.searchParams.get('id');
    const session = getConnectSession(id);
    if (!session) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ linked: false, expired: true }));
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      linked: !!session.linkedUser,
      username: session.linkedUser || null,
      label: session.label || 'main',
    }));
    return true;
  }

  // Route 3: POST /api/connect/save (Direct or Bookmarklet web connect)
  if (req.method === 'POST' && url.pathname === '/api/connect/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, token, label } = JSON.parse(body);
        const session = getConnectSession(id);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A munkamenet lejárt. Kérj új linket a /login paranccsal.' }));
          return;
        }

        if (!token || !token.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A kulcs (token) megadása kötelező.' }));
          return;
        }

        const cleanToken = token.trim().replace(/^"(.*)"$/, '$1');
        const targetLabel = (label?.trim() || session.label || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main';
        const api = new DiscordUserAPI(cleanToken);
        const user = await api.getCurrentUser();
        const savedUsername = user.global_name || user.username;

        saveToken(session.uid, targetLabel, cleanToken, {
          id: user.id,
          username: savedUsername,
        });
        setActiveLabel(session.uid, targetLabel);

        session.linkedUser = savedUsername;
        session.label = targetLabel;

        if (typeof session.onLinked === 'function') {
          try {
            await session.onLinked({ user, token: cleanToken, label: targetLabel });
          } catch (e) {
            console.warn('[WebLinker] onLinked error:', e.message);
          }
        }

        console.log(`[WebLinker] ✅ Sikeres felhős csatlakozás: ${savedUsername} [${targetLabel}] (${user.id})`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          username: savedUsername,
          label: targetLabel,
        }));
      } catch (err) {
        console.error('[WebLinker] Connect save error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message || 'Érvénytelen kulcs vagy hálózati hiba.',
        }));
      }
    });
    return true;
  }

  // Route 4: POST /api/auth/sync (Direct API sync)
  if (req.method === 'POST' && url.pathname === '/api/auth/sync') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { secret, uid, label, token } = JSON.parse(body);

        const expectedSecret = process.env.ENCRYPTION_KEY;
        if (!expectedSecret || secret !== expectedSecret) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Érvénytelen szinkronizációs kulcs.' }));
          return;
        }

        if (!token || !token.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Hiányzó token.' }));
          return;
        }

        const cleanToken = token.trim().replace(/^"(.*)"$/, '$1');
        const api = new DiscordUserAPI(cleanToken);
        const user = await api.getCurrentUser();

        const targetUid = uid || process.env.OWNER_ID || user.id;
        const targetLabel = label || 'main';
        const savedUsername = user.global_name || user.username;

        saveToken(targetUid, targetLabel, cleanToken, {
          id: user.id,
          username: savedUsername,
        });

        // Notify active web sessions
        for (const [sId, sess] of activeConnectSessions.entries()) {
          sess.linkedUser = savedUsername;
          if (typeof sess.onLinked === 'function') {
            try {
              await sess.onLinked({ user, token: cleanToken });
            } catch (e) {
              console.warn('[WebLinker] onLinked error:', e.message);
            }
          }
        }

        console.log(`[WebLinker] ✅ Helyi szinkronizáció sikeres: ${savedUsername} (${user.id}) elmentve!`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          username: savedUsername,
          userId: user.id,
        }));
      } catch (err) {
        console.error('[WebLinker] Sync error:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
        }));
      }
    });
    return true;
  }

  return false;
}
