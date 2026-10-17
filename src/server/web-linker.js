import crypto from 'crypto';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { saveToken } from '../database/sqlite.js';

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
  const apiUrl = `${baseUrl}/api/connect/save`;

  // Bookmarklet code that safely extracts token on discord.com and posts to our bot
  const rawBookmarklet = `javascript:(function(){try{if(typeof window.webpackChunkdiscord_app==='undefined'){alert('⚠️ Figyelem: Ezt a gombot húzd fel a böngésződ felső könyvjelzősávjára (Ctrl+Shift+B mutatja a sávot)!\\n\\nUtána nyisd meg a discord.com/app felületét bejelentkezve, és ott kattints rá!');return;}let token=null;window.webpackChunkdiscord_app.push([[Math.random()],{},function(req){for(const k of Object.keys(req.c)){const m=req.c[k].exports;if(m){if(m.default&&typeof m.default.getToken==='function'){token=m.default.getToken();break;}if(typeof m.getToken==='function'){token=m.getToken();break;}}}}]);if(!token){alert('⚠️ Nem található aktív bejelentkezés! Nyisd meg a discord.com/app oldalt bejelentkezve, és ott kattints erre a könyvjelzőre.');return;}const n=document.createElement('div');n.style.position='fixed';n.style.top='20px';n.style.right='20px';n.style.zIndex='999999';n.style.background='#5865f2';n.style.color='#fff';n.style.padding='14px 20px';n.style.borderRadius='12px';n.style.boxShadow='0 8px 24px rgba(0,0,0,0.5)';n.style.fontFamily='sans-serif';n.style.fontSize='14px';n.innerHTML='⚡ <b>OrbHunter:</b> Fiók összekapcsolása...';document.body.appendChild(n);fetch('${apiUrl}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${session.id}',token:token})}).then(function(r){return r.json();}).then(function(d){if(d.success){n.style.background='#23a55a';n.innerHTML='🎉 <b>Sikeres csatlakozás:</b> '+d.username+'<br>A bot aktiválva van a Discordban!';setTimeout(function(){n.remove();},5000);}else{n.style.background='#ed4245';n.innerHTML='❌ Hiba: '+(d.error||'Ismeretlen hiba');setTimeout(function(){n.remove();},5000);}}).catch(function(e){n.style.background='#ed4245';n.innerHTML='❌ Hálózati hiba: '+e.message;setTimeout(function(){n.remove();},5000);});}catch(e){alert('❌ Hiba: '+e.message);}})();`;

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrbHunter — Fiók Összekapcsolása</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0e14;
      --card-bg: rgba(22, 27, 34, 0.88);
      --border: rgba(88, 101, 242, 0.3);
      --accent: #5865f2;
      --accent-glow: rgba(88, 101, 242, 0.45);
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
      box-shadow: 0 16px 50px rgba(0, 0, 0, 0.65), 0 0 40px var(--accent-glow);
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
      margin-bottom: 28px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .section-title::before, .section-title::after {
      content: '';
      flex: 1;
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
    }
    .bookmark-box {
      background: rgba(88, 101, 242, 0.08);
      border: 1px dashed rgba(88, 101, 242, 0.4);
      border-radius: 16px;
      padding: 20px 16px;
      margin-bottom: 28px;
      transition: all 0.2s;
    }
    .bookmark-box:hover {
      border-color: var(--accent);
      background: rgba(88, 101, 242, 0.14);
    }
    .bookmark-btn {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #5865f2 0%, #4752c4 100%);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      padding: 12px 24px;
      border-radius: 12px;
      text-decoration: none;
      box-shadow: 0 4px 16px rgba(88, 101, 242, 0.4);
      cursor: grab;
      user-select: none;
      transition: transform 0.15s, box-shadow 0.15s;
    }
    .bookmark-btn:active {
      cursor: grabbing;
      transform: scale(0.97);
    }
    .bookmark-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 12px;
      line-height: 1.4;
    }
    .manual-box {
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-align: left;
    }
    .input-wrap {
      position: relative;
    }
    .input-field {
      width: 100%;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 12px;
      padding: 12px 16px;
      padding-right: 44px;
      color: var(--text);
      font-family: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(88, 101, 242, 0.25);
    }
    .eye-btn {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 16px;
      padding: 4px;
    }
    .submit-btn {
      background: #23a55a;
      color: #fff;
      font-family: inherit;
      font-size: 15px;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      padding: 12px 20px;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
      box-shadow: 0 4px 14px rgba(35, 165, 90, 0.35);
    }
    .submit-btn:hover {
      background: #219653;
    }
    .submit-btn:active {
      transform: scale(0.98);
    }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status-msg {
      margin-top: 18px;
      font-size: 14px;
      border-radius: 10px;
      padding: 12px;
      display: none;
    }
    .status-msg.success {
      display: block;
      background: rgba(35, 165, 90, 0.15);
      border: 1px solid var(--success);
      color: #57f287;
    }
    .status-msg.error {
      display: block;
      background: rgba(237, 66, 69, 0.15);
      border: 1px solid var(--error);
      color: #ff7b72;
    }
    .footer-note {
      margin-top: 24px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.35);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge-icon">🌐</div>
    <h1>OrbHunter Fiók Csatlakoztatás</h1>
    <p class="subtitle">Kapcsold össze a Discord profilodat az OrbHunter bottal a küldetések automatizálásához.</p>

    <!-- Option 1: Bookmarklet -->
    <div class="section-title">1. Módszer: 1-Kattintásos Csatlakozás</div>
    <div class="bookmark-box">
      <a class="bookmark-btn" href="${rawBookmarklet}" title="Húzd fel a könyvjelzősávra!" onclick="if(location.hostname!=='discord.com'){alert('⚠️ Ez a gomb a könyvjelzősávra való!\\n\\n1. Húzd fel ezt a kék gombot a felső könyvjelzőid közé (Ctrl+Shift+B mutatja a sávot).\\n2. Menj a discord.com/app felületére bejelentkezve.\\n3. Kattints ott a könyvjelzőre!\\n\\nVAGY használd a lenti 2. módszert a közvetlen beillesztéshez.'); return false;}">
        <span>⚡</span> OrbHunter Csatlakozás
      </a>
      <p class="bookmark-hint">
        <b>1.</b> Fogd meg a fenti kék gombot és <b>húzd fel a böngésződ könyvjelzősávjára</b> (Ctrl+Shift+B).<br>
        <b>2.</b> Menj a <a href="https://discord.com/app" target="_blank" style="color: #5865f2; text-decoration: none;">discord.com/app</a> felületére bejelentkezve.<br>
        <b>3.</b> Kattints a könyvjelzőre, és 1 másodperc alatt összekapcsolja a fiókodat!
      </p>
    </div>

    <!-- Option 2: Direct Form -->
    <div class="section-title">2. Módszer: Közvetlen Megadás</div>
    <form id="connectForm" class="manual-box" onsubmit="handleManualSubmit(event)">
      <div class="input-wrap">
        <input type="password" id="tokenInput" class="input-field" placeholder="Illeszd be ide a tokenedet..." autocomplete="off" required>
        <button type="button" class="eye-btn" onclick="toggleEye()">👁️</button>
      </div>
      <button type="submit" id="submitBtn" class="submit-btn">Mentés és Csatlakoztatás</button>
      <div style="font-size: 12px; color: #949ba4; line-height: 1.5; background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06);">
        💡 <b>Nem tudod a tokenedet? 10 másodperc megszerezni:</b><br>
        1. Nyisd meg a Discordot a böngésződben és nyomj <b>F12</b>-t (Console fül).<br>
        2. Másold be ezt az egy sort és üss Entert:<br>
        <code style="display:block; background:#000; padding:6px 8px; border-radius:6px; margin:6px 0; color:#57f287; font-size:11px; word-break:break-all; user-select:all;">(webpackChunkdiscord_app.push([[''],{},e=>{m=e.c}]),Object.values(m).find(m=>m?.exports?.default?.getToken).exports.default.getToken())</code>
        3. A zölden megjelenő tokent másold ide a mezőbe és nyomj a zöld Mentés gombra!
      </div>
    </form>

    <div id="statusMsg" class="status-msg"></div>

    <p class="footer-note">🔒 Titkosított kapcsolat • Az adataid védve vannak és a saját szervereden tárolódnak.</p>
  </div>

  <script>
    function toggleEye() {
      const input = document.getElementById('tokenInput');
      input.type = input.type === 'password' ? 'text' : 'password';
    }

    function handleManualSubmit(e) {
      e.preventDefault();
      const token = document.getElementById('tokenInput').value.trim();
      const btn = document.getElementById('submitBtn');
      const status = document.getElementById('statusMsg');

      if (!token) return;

      btn.disabled = true;
      btn.innerText = 'Ellenőrzés folyamatban...';
      status.className = 'status-msg';
      status.style.display = 'none';

      fetch('/api/connect/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: '${session.id}',
          token: token
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(res) {
        if (res.success) {
          status.className = 'status-msg success';
          status.innerHTML = '🎉 <b>Sikeres csatlakozás!</b> Üdvözöllek, <b>' + (res.username || 'Felhasználó') + '</b>!<br>A fiókod aktiválva van a botban. Visszatérhetsz a Discordba.';
          document.getElementById('tokenInput').value = '';
          btn.innerText = '✅ Csatlakoztatva';
        } else {
          status.className = 'status-msg error';
          status.innerHTML = '❌ <b>Hiba:</b> ' + (res.error || 'A token érvénytelen vagy elutasította a Discord.');
          btn.disabled = false;
          btn.innerText = 'Újrapróbálás';
        }
      })
      .catch(function(err) {
        status.className = 'status-msg error';
        status.innerHTML = '❌ <b>Hálózati hiba:</b> ' + err.message;
        btn.disabled = false;
        btn.innerText = 'Mentés és Csatlakoztatás';
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
        <p style="color:#949ba4;">Indíts új csatlakozást a Discord felületén a <code>/login</code> paranccsal.</p>
      </body></html>`);
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderConnectPage(session));
    return true;
  }

  // Route 2: POST /api/connect/save
  if (req.method === 'POST' && url.pathname === '/api/connect/save') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, token } = JSON.parse(body);
        const session = getConnectSession(id);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A munkamenet lejárt. Kérj új linket a /login paranccsal.' }));
          return;
        }

        if (!token || !token.trim()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Hiányzó token.' }));
          return;
        }

        const cleanToken = token.trim().replace(/^"(.*)"$/, '$1');

        // Verify token with Discord API
        const api = new DiscordUserAPI(cleanToken);
        const user = await api.getCurrentUser();

        // Save token to database
        const savedUsername = user.global_name || user.username;
        saveToken(session.uid, session.label || 'main', cleanToken, {
          id: user.id,
          username: savedUsername,
        });

        // Trigger session onLinked callback (updates Discord interaction in real time)
        if (typeof session.onLinked === 'function') {
          try {
            await session.onLinked({ user, token: cleanToken });
          } catch (e) {
            console.warn('[WebLinker] onLinked callback error:', e.message);
          }
        }

        // Clean up session
        activeConnectSessions.delete(id);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          username: savedUsername,
          userId: user.id,
        }));
      } catch (err) {
        console.error('[WebLinker] Failed to link token:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: 'Érvénytelen token vagy nem sikerült hitelesíteni a Discorddal (' + err.message + ')',
        }));
      }
    });
    return true;
  }

  return false;
}
