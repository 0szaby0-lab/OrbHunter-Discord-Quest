import crypto from 'crypto';

// Memory store for active captcha solving sessions
const activeSessions = new Map();

// Session timeout: 5 minutes
const SESSION_TTL_MS = 5 * 60 * 1000;

export function getPublicBaseUrl() {
  const url = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || 'https://orbhunter-discord-quest.onrender.com';
  return url.replace(/\/+$/, '');
}

export function createCaptchaSession({ sitekey, rqdata, rqtoken, onSolved }) {
  const id = crypto.randomUUID();
  const session = {
    id,
    sitekey,
    rqdata: rqdata || '',
    rqtoken: rqtoken || '',
    onSolved,
    createdAt: Date.now(),
  };

  activeSessions.set(id, session);

  // Auto cleanup
  setTimeout(() => {
    activeSessions.delete(id);
  }, SESSION_TTL_MS);

  return id;
}

export function getCaptchaSession(id) {
  const session = activeSessions.get(id);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    activeSessions.delete(id);
    return null;
  }
  return session;
}

export function renderCaptchaPage(session) {
  const safeSitekey = JSON.stringify(session.sitekey);
  const safeRqdata = JSON.stringify(session.rqdata || '');

  return `<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OrbHunter — Discord Hitelesítés</title>
  <script src="https://js.hcaptcha.com/1/api.js?render=explicit" async defer></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0e14;
      --card-bg: rgba(22, 27, 34, 0.85);
      --border: rgba(88, 101, 242, 0.25);
      --accent: #5865f2;
      --accent-glow: rgba(88, 101, 242, 0.4);
      --text: #f2f3f5;
      --text-muted: #949ba4;
      --success: #23a55a;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at 50% 20%, #1a1e36 0%, var(--bg) 70%);
      color: var(--text);
      font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: var(--card-bg);
      backdrop-filter: blur(16px);
      border: 1px solid var(--border);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 30px var(--accent-glow);
      border-radius: 20px;
      padding: 36px 32px;
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
      background: linear-gradient(90deg, #5865f2, #eb459e, #fee75c, #5865f2);
      background-size: 300% 100%;
      animation: gradientMove 4s linear infinite;
    }
    @keyframes gradientMove {
      0% { background-position: 0% 50%; }
      100% { background-position: 300% 50%; }
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: rgba(88, 101, 242, 0.15);
      border: 1px solid rgba(88, 101, 242, 0.3);
      font-size: 28px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.3px;
      margin-bottom: 8px;
    }
    p {
      color: var(--text-muted);
      font-size: 14px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .captcha-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 82px;
      margin-bottom: 20px;
    }
    .status-box {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-muted);
      transition: all 0.3s ease;
      min-height: 24px;
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.3);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo-badge">🛡️</div>
    <h1>Discord Hitelesítés</h1>
    <p>A Discord felhős biztonsági ellenőrzést kér a fiókodhoz. Kattints az alábbi dobozra a bejelentkezés véglegesítéséhez!</p>

    <div class="captcha-container">
      <div id="hcaptcha-widget" data-host="discord.com"></div>
    </div>

    <div id="status" class="status-box">⏳ Várakozás a captcha kitöltésére...</div>
    <div class="footer">OrbHunter • Biztonságos felhős hitelesítő híd</div>
  </div>

  <script>
    window.onload = function() {
      if (typeof hcaptcha === 'undefined') {
        document.getElementById('status').innerText = 'Nem sikerült betölteni a hCaptcha szkriptet.';
        return;
      }

      hcaptcha.render('hcaptcha-widget', {
        sitekey: ${safeSitekey},
        rqdata: ${safeRqdata},
        host: 'discord.com',
        theme: 'dark',
        callback: function(token) {
          var status = document.getElementById('status');
          status.innerHTML = '⚡ <em>Jóváhagyás küldése a Discordnak...</em>';

          fetch('/api/captcha/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: '${session.id}',
              token: token,
              userAgent: navigator.userAgent
            })
          })
          .then(function(r) { return r.json(); })
          .then(function(res) {
            if (res.success) {
              status.innerHTML = '<span style="color: var(--success); font-size: 16px;">🎉 Sikeres feloldás! A fiókod bejelentkezett. Visszatérhetsz a Discordba.</span>';
              var widget = document.getElementById('hcaptcha-widget');
              if (widget) widget.style.display = 'none';
            } else {
              status.innerHTML = '<span style="color: #ed4245;">❌ Hiba: ' + (res.error || 'Nem sikerült a bejelentkezés') + '</span>';
            }
          })
          .catch(function(err) {
            status.innerHTML = '<span style="color: #ed4245;">❌ Hálózati hiba: ' + err.message + '</span>';
          });
        }
      });
    };
  </script>
</body>
</html>`;
}

export async function handleCaptchaRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Route 1: GET /captcha/:id
  if (req.method === 'GET' && url.pathname.startsWith('/captcha/')) {
    const id = url.pathname.replace('/captcha/', '').trim();
    const session = getCaptchaSession(id);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><body style="background:#0b0e14;color:#f2f3f5;font-family:sans-serif;text-align:center;padding:50px;">
        <h2>❌ A captcha munkamenet lejárt vagy érvénytelen.</h2>
        <p style="color:#949ba4;">Indíts új bejelentkezést a Discord felületén a <code>/login</code> paranccsal vagy a vezérlőpult gombjával.</p>
      </body></html>`);
      return true;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(renderCaptchaPage(session));
    return true;
  }

  // Route 2: POST /api/captcha/solve
  if (req.method === 'POST' && url.pathname === '/api/captcha/solve') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { id, token, userAgent } = JSON.parse(body);
        const session = getCaptchaSession(id);
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'A munkamenet lejárt.' }));
          return;
        }

        if (!token) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Hiányzó captcha token.' }));
          return;
        }

        // Execute solve callback with token and matching userAgent
        await session.onSolved(token, userAgent);
        activeSessions.delete(id);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
    });
    return true;
  }

  return false;
}
