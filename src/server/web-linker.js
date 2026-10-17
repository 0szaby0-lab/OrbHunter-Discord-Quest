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
  <title>OrbHunter — Biztonságos QR Csatlakozás</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0e14;
      --card-bg: rgba(22, 27, 34, 0.92);
      --border: rgba(88, 101, 242, 0.35);
      --accent: #5865f2;
      --accent-glow: rgba(88, 101, 242, 0.5);
      --accent-pink: #eb459e;
      --text: #f2f3f5;
      --text-muted: #949ba4;
      --success: #23a55a;
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
      max-width: 460px;
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
      width: 68px;
      height: 68px;
      border-radius: 20px;
      background: rgba(88, 101, 242, 0.16);
      border: 1px solid rgba(88, 101, 242, 0.35);
      font-size: 34px;
      margin-bottom: 18px;
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
      margin-bottom: 24px;
    }
    .steps-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: left;
      margin-bottom: 24px;
    }
    .step-box {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 14px;
      padding: 14px 16px;
      transition: border-color 0.2s;
    }
    .step-box:hover {
      border-color: rgba(88, 101, 242, 0.4);
    }
    .step-num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      flex-shrink: 0;
      margin-top: 2px;
    }
    .step-content h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
      color: var(--text);
    }
    .step-content p {
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.4;
    }
    .step-code {
      display: inline-block;
      background: rgba(88, 101, 242, 0.2);
      border: 1px solid rgba(88, 101, 242, 0.4);
      padding: 2px 6px;
      border-radius: 6px;
      color: #fff;
      font-family: monospace;
      font-weight: 600;
      font-size: 12px;
    }
    .pulse-status {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: rgba(88, 101, 242, 0.12);
      border: 1px solid rgba(88, 101, 242, 0.28);
      border-radius: 14px;
      padding: 14px 18px;
      margin-top: 10px;
      font-size: 13.5px;
      color: #cfd3ff;
      font-weight: 500;
    }
    .pulse-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
      animation: pulseAnim 1.8s ease-in-out infinite;
    }
    @keyframes pulseAnim {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.35; transform: scale(0.85); }
    }
    .success-box {
      display: none;
      background: rgba(35, 165, 90, 0.16);
      border: 1px solid var(--success);
      border-radius: 16px;
      padding: 24px;
      margin-top: 16px;
      text-align: center;
    }
    .success-box h2 {
      font-size: 20px;
      color: #57f287;
      margin-bottom: 8px;
    }
    .success-box p {
      font-size: 14px;
      color: #dbdee1;
      line-height: 1.5;
    }
    .footer-note {
      margin-top: 24px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.38);
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge-icon">⚡</div>
    <h1>OrbHunter QR Csatlakozás</h1>
    <p class="subtitle">A Discord védelmi rendszere miatt a belépés közvetlenül a saját otthoni internetedről történik (100% biztonságos, nincs captcha).</p>

    <div id="stepsArea">
      <div class="steps-container">
        <div class="step-box">
          <div class="step-num">1</div>
          <div class="step-content">
            <h3>Indítsd el a gépeden</h3>
            <p>A letöltött mappádban kattints duplán a <span class="step-code">login.bat</span> fájlra (vagy írd be a terminálba: <span class="step-code">.\\login.bat</span>).</p>
          </div>
        </div>

        <div class="step-box">
          <div class="step-num">2</div>
          <div class="step-content">
            <h3>Olvasd be a telefonoddal</h3>
            <p>Felugrik a hivatalos Discord QR-kód. A mobilappban nyisd meg a <b>Profil ➔ QR-kód beolvasása</b> menüt.</p>
          </div>
        </div>

        <div class="step-box">
          <div class="step-num">3</div>
          <div class="step-content">
            <h3>Hagyd jóvá a belépést</h3>
            <p>Koppints az <b>"Igen, bejelentkezem"</b> gombra. A fiókod azonnal összekapcsolódik a felhővel!</p>
          </div>
        </div>
      </div>

      <div class="pulse-status" id="waitingStatus">
        <div class="pulse-dot"></div>
        <span>Várakozás a helyi QR-kód jóváhagyására...</span>
      </div>
    </div>

    <div class="success-box" id="successArea">
      <div style="font-size: 40px; margin-bottom: 12px;">🎉</div>
      <h2 id="successUser">Sikeres Csatlakozás!</h2>
      <p>A Discord fiókodat sikeresen összekapcsoltuk az OrbHunterrel.<br>A bot a háttérben mostantól automatikusan csinálja a küldetéseidet. Visszatérhetsz a Discordba!</p>
    </div>

    <p class="footer-note">🔒 Saját IP hitelesítés • Az adataid AES-256 titkosítással védve a felhőben tárolódnak.</p>
  </div>

  <script>
    var sessionId = '${session.id}';
    var checkInterval = setInterval(function() {
      fetch('/api/connect/status?id=' + encodeURIComponent(sessionId))
        .then(function(r) { return r.json(); })
        .then(function(res) {
          if (res.linked) {
            clearInterval(checkInterval);
            document.getElementById('stepsArea').style.display = 'none';
            var succ = document.getElementById('successArea');
            succ.style.display = 'block';
            if (res.username) {
              document.getElementById('successUser').innerText = 'Üdv, ' + res.username + '!';
            }
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
        <p style="color:#949ba4;">Indíts új bejelentkezést a Discord felületén a <code>/login</code> paranccsal.</p>
      </body></html>`);
      return true;
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
    }));
    return true;
  }
  // Route 3: POST /api/auth/sync (Direct sync from local login)
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

        // Notify active web sessions so browser turns green automatically
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
