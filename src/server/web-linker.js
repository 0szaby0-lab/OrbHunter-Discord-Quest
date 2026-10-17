import crypto from 'crypto';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { saveToken } from '../database/sqlite.js';

// Memory store for active account linking sessions (TTL: 15 minutes)
const activeConnectSessions = new Map();
const SESSION_TTL_MS = 15 * 60 * 1000;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

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
  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrbHunter — Discord Bejelentkezés</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0e14;
      --card-bg: rgba(22, 27, 34, 0.9);
      --border: rgba(88, 101, 242, 0.32);
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
      padding: 44px 36px;
      width: 100%;
      max-width: 440px;
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
      margin-bottom: 20px;
    }
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
      letter-spacing: -0.3px;
    }
    .subtitle {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 28px;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 16px;
      text-align: left;
    }
    .input-label {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 6px;
      display: block;
    }
    .input-wrap {
      position: relative;
    }
    .input-field {
      width: 100%;
      background: rgba(0, 0, 0, 0.4);
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 12px;
      padding: 13px 16px;
      color: var(--text);
      font-family: inherit;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.3);
    }
    .eye-btn {
      position: absolute;
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 18px;
      padding: 4px;
    }
    .submit-btn {
      width: 100%;
      background: linear-gradient(135deg, #5865f2 0%, #4752c4 100%);
      color: #fff;
      font-family: inherit;
      font-size: 16px;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      padding: 14px 20px;
      cursor: pointer;
      margin-top: 10px;
      transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
      box-shadow: 0 6px 20px rgba(88, 101, 242, 0.4);
    }
    .submit-btn:hover {
      box-shadow: 0 8px 24px rgba(88, 101, 242, 0.55);
    }
    .submit-btn:active {
      transform: scale(0.98);
    }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status-msg {
      margin-top: 20px;
      font-size: 14px;
      border-radius: 12px;
      padding: 14px;
      line-height: 1.5;
      display: none;
      text-align: left;
    }
    .status-msg.success {
      display: block;
      background: rgba(35, 165, 90, 0.16);
      border: 1px solid var(--success);
      color: #57f287;
    }
    .status-msg.error {
      display: block;
      background: rgba(237, 66, 69, 0.16);
      border: 1px solid var(--error);
      color: #ff7b72;
    }
    .footer-note {
      margin-top: 26px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.35);
      line-height: 1.4;
    }
    #mfaSection {
      display: none;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge-icon">🎮</div>
    <h1>OrbHunter Discord Belépés</h1>
    <p class="subtitle">Jelentkezz be a fiókoddal az automatikus küldetéskezelő aktiválásához.</p>

    <!-- Step 1: Email & Password -->
    <form id="loginForm" class="form-group" onsubmit="handleLoginSubmit(event)">
      <div>
        <label class="input-label" for="loginEmail">E-mail cím vagy telefonszám</label>
        <div class="input-wrap">
          <input type="text" id="loginEmail" class="input-field" placeholder="pelda@email.com" autocomplete="username" required>
        </div>
      </div>

      <div>
        <label class="input-label" for="loginPassword">Jelszó</label>
        <div class="input-wrap">
          <input type="password" id="loginPassword" class="input-field" placeholder="••••••••••••" autocomplete="current-password" required>
          <button type="button" class="eye-btn" onclick="togglePasswordEye()">👁️</button>
        </div>
      </div>

      <button type="submit" id="submitBtn" class="submit-btn">🔒 Bejelentkezés</button>
    </form>

    <!-- Step 2: 2FA / TOTP (Shown if account has MFA) -->
    <form id="mfaForm" class="form-group" onsubmit="handleMfaSubmit(event)" style="display: none;">
      <div style="background: rgba(88, 101, 242, 0.1); border: 1px solid rgba(88, 101, 242, 0.3); border-radius: 12px; padding: 14px; margin-bottom: 8px;">
        <p style="font-size: 13px; color: var(--text);">🔐 <b>Kétlépcsős azonosítás (2FA) szükséges</b><br><span style="color: var(--text-muted); font-size: 12px;">Nyisd meg a hitelesítő appodat (Authy, Google Authenticator) vagy az SMS-eidet, és írd be a 6 jegyű kódot:</span></p>
      </div>

      <div>
        <label class="input-label" for="mfaCode">6 jegyű hitelesítő kód</label>
        <div class="input-wrap">
          <input type="text" id="mfaCode" class="input-field" placeholder="123456" maxlength="8" autocomplete="one-time-code" required>
        </div>
      </div>

      <button type="submit" id="mfaSubmitBtn" class="submit-btn" style="background: #23a55a;">✅ Kód Megerősítése</button>
    </form>

    <div id="statusMsg" class="status-msg"></div>

    <p class="footer-note">🔒 Biztonságos kapcsolat • Az adataid AES-256 titkosítással védve a saját szervereden tárolódnak.</p>
  </div>

  <script>
    var currentTicket = null;

    function togglePasswordEye() {
      var input = document.getElementById('loginPassword');
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    function handleLoginSubmit(e) {
      e.preventDefault();
      var email = document.getElementById('loginEmail').value.trim();
      var password = document.getElementById('loginPassword').value;
      var btn = document.getElementById('submitBtn');
      var status = document.getElementById('statusMsg');

      if (!email || !password) return;

      btn.disabled = true;
      btn.innerText = 'Bejelentkezés folyamatban...';
      status.style.display = 'none';

      fetch('/api/connect/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '${session.id}',
          email: email,
          password: password
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          document.getElementById('loginForm').style.display = 'none';
          status.className = 'status-msg success';
          status.innerHTML = '🎉 <b>Sikeres bejelentkezés!</b><br>Üdvözöllek, <b>' + (res.username || 'Felhasználó') + '</b>!<br>A fiókod sikeresen csatlakoztatva lett az OrbHunterhez. Visszatérhetsz a Discordba!';
        } else if (res.mfa) {
          // Show 2FA form
          currentTicket = res.ticket;
          document.getElementById('loginForm').style.display = 'none';
          document.getElementById('mfaForm').style.display = 'flex';
          setTimeout(function() { document.getElementById('mfaCode').focus(); }, 100);
        } else {
          status.className = 'status-msg error';
          status.innerHTML = '❌ <b>Hiba:</b> ' + (res.error || 'Hibás e-mail vagy jelszó.');
          btn.disabled = false;
          btn.innerText = '🔒 Bejelentkezés';
        }
      })
      .catch(function(err) {
        status.className = 'status-msg error';
        status.innerHTML = '❌ <b>Hálózati hiba:</b> ' + err.message;
        btn.disabled = false;
        btn.innerText = '🔒 Bejelentkezés';
      });
    }

    function handleMfaSubmit(e) {
      e.preventDefault();
      var code = document.getElementById('mfaCode').value.trim();
      var btn = document.getElementById('mfaSubmitBtn');
      var status = document.getElementById('statusMsg');

      if (!code || !currentTicket) return;

      btn.disabled = true;
      btn.innerText = 'Ellenőrzés...';
      status.style.display = 'none';

      fetch('/api/connect/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '${session.id}',
          ticket: currentTicket,
          code: code
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          document.getElementById('mfaForm').style.display = 'none';
          status.className = 'status-msg success';
          status.innerHTML = '🎉 <b>Sikeres bejelentkezés!</b><br>Üdvözöllek, <b>' + (res.username || 'Felhasználó') + '</b>!<br>A fiókod sikeresen csatlakoztatva lett az OrbHunterhez. Visszatérhetsz a Discordba!';
        } else {
          status.className = 'status-msg error';
          status.innerHTML = '❌ <b>Hiba:</b> ' + (res.error || 'Érvénytelen 2FA kód.');
          btn.disabled = false;
          btn.innerText = '✅ Kód Megerősítése';
        }
      })
      .catch(function(err) {
        status.className = 'status-msg error';
        status.innerHTML = '❌ <b>Hálózati hiba:</b> ' + err.message;
        btn.disabled = false;
        btn.innerText = '✅ Kód Megerősítése';
      });
    }
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
        <p style="color:#949ba4;">Indíts új bejelentkezést a Discord felületén a <code>/login</code> paranccsal.</p>
      </body></html>`);
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderConnectPage(session));
    return true;
  }

  // Route 2: POST /api/connect/login (Discord Email + Password authentication)
  if (req.method === 'POST' && url.pathname === '/api/connect/login') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, email, password } = JSON.parse(body);
        const session = getConnectSession(id);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A munkamenet lejárt. Kérj új linket a /login paranccsal.' }));
          return;
        }

        if (!email || !password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'E-mail és jelszó megadása kötelező.' }));
          return;
        }

        // Send login to Discord API
        const discordRes = await fetch('https://discord.com/api/v9/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_UA,
          },
          body: JSON.stringify({
            login: email.trim(),
            password: password,
            undelete: false,
            login_source: null,
            gift_code_sku_id: null,
          }),
        });

        const data = await discordRes.json();

        // Case 1: MFA required
        if (data.mfa && data.ticket) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            mfa: true,
            ticket: data.ticket,
          }));
          return;
        }

        // Case 2: Direct success (token returned)
        if (data.token) {
          const api = new DiscordUserAPI(data.token);
          const user = await api.getCurrentUser();
          const savedUsername = user.global_name || user.username;

          saveToken(session.uid, session.label || 'main', data.token, {
            id: user.id,
            username: savedUsername,
          });

          if (typeof session.onLinked === 'function') {
            try {
              await session.onLinked({ user, token: data.token });
            } catch (e) {
              console.warn('[WebLinker] onLinked error:', e.message);
            }
          }

          activeConnectSessions.delete(id);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            username: savedUsername,
          }));
          return;
        }

        // Case 3: Error from Discord
        const errMsg = data.message || (data.errors ? JSON.stringify(data.errors) : 'Hibás e-mail vagy jelszó.');
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: errMsg,
        }));
      } catch (err) {
        console.error('[WebLinker] Login error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
        }));
      }
    });
    return true;
  }

  // Route 3: POST /api/connect/mfa (Submit 2FA / TOTP code)
  if (req.method === 'POST' && url.pathname === '/api/connect/mfa') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, ticket, code } = JSON.parse(body);
        const session = getConnectSession(id);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A munkamenet lejárt.' }));
          return;
        }

        if (!ticket || !code) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Hiányzó 2FA kód vagy ticket.' }));
          return;
        }

        const discordRes = await fetch('https://discord.com/api/v9/auth/mfa/totp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': BROWSER_UA,
          },
          body: JSON.stringify({
            code: code.trim(),
            ticket: ticket,
            login_source: null,
            gift_code_sku_id: null,
          }),
        });

        const data = await discordRes.json();

        if (data.token) {
          const api = new DiscordUserAPI(data.token);
          const user = await api.getCurrentUser();
          const savedUsername = user.global_name || user.username;

          saveToken(session.uid, session.label || 'main', data.token, {
            id: user.id,
            username: savedUsername,
          });

          if (typeof session.onLinked === 'function') {
            try {
              await session.onLinked({ user, token: data.token });
            } catch (e) {
              console.warn('[WebLinker] onLinked error:', e.message);
            }
          }

          activeConnectSessions.delete(id);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            username: savedUsername,
          }));
          return;
        }

        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: data.message || 'Érvénytelen 2FA kód.',
        }));
      } catch (err) {
        console.error('[WebLinker] MFA error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: err.message,
        }));
      }
    });
    return true;
  }

  // Route 4: POST /api/auth/sync (Direct sync from local login)
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
