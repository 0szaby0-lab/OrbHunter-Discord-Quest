import 'dotenv/config';
import http from 'http';
import QRCode from 'qrcode';
import { writeFileSync, unlinkSync } from 'fs';
import { exec } from 'child_process';
import path from 'path';
import { RemoteAuthSession } from '../src/engine/remote-auth.js';
import { DiscordUserAPI } from '../src/engine/discord-api.js';
import { saveToken } from '../src/database/sqlite.js';
import { config } from '../src/config.js';

const RENDER_BASE_URL = process.env.RENDER_EXTERNAL_URL || 'https://orbhunter-discord-quest.onrender.com';

console.clear();
console.log('==============================================================');
console.log('       OrbHunter — Helyi Biztonságos QR-kód Bejelentkezés    ');
console.log('==============================================================\n');
console.log('⏳ Kapcsolódás a Discord hivatalos átjárójához a saját netedről...\n');

const session = new RemoteAuthSession({ proxyUrl: null });

session.on('qr', async ({ url, buffer }) => {
  const qrImagePath = path.join(process.cwd(), 'discord-login-qr.png');
  writeFileSync(qrImagePath, buffer);

  // Auto open image on Windows
  if (process.platform === 'win32') {
    exec(`start "" "${qrImagePath}"`);
  }

  // Also print directly in terminal
  QRCode.toString(url, { type: 'terminal', small: true }, (err, str) => {
    if (!err && str) {
      console.log(str);
    }
  });

  console.log('--------------------------------------------------------------');
  console.log('📱 1. Nyisd meg a Discord mobilappot a telefonodon.');
  console.log('⚙️  2. Jobb alsó sarok: Profilkép -> "QR-kód beolvasása".');
  console.log('📷 3. Olvasd be a fenti QR-kódot (vagy a felugrott képet)!');
  console.log('--------------------------------------------------------------');
  console.log('⏳ Várakozás a beolvasásra...\n');
});

session.on('scanned', ({ user }) => {
  const name = user?.username || 'Fiókod';
  console.log(`\n👁️  ${name} beolvasta a kódot!`);
  console.log('👉 Kérlek, koppints a telefonodon a "Bejelentkezés megerősítése" gombra!\n');
});

session.on('finish', async ({ token }) => {
  console.log('⚡ Bejelentkezés elfogadva! Adatok feldolgozása...\n');

  try {
    const api = new DiscordUserAPI(token);
    const user = await api.getCurrentUser();
    const username = user.global_name || user.username;

    // Save locally
    const uid = config.ownerId || user.id;
    saveToken(uid, 'main', token, { id: user.id, username });

    console.log(`✅ Helyi ellenőrzés sikeres: ${username} (${user.id})`);
    console.log('☁️  Szinkronizálás a Render felhőszerverre...\n');

    // Sync to Render cloud server
    const syncRes = await fetch(`${RENDER_BASE_URL}/api/auth/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: config.encryptionKey,
        uid,
        label: 'main',
        token,
      }),
    });

    const syncData = await syncRes.json();

    if (!syncRes.ok || !syncData.success) {
      throw new Error(syncData.error || `HTTP ${syncRes.status}`);
    }

    console.log('==============================================================');
    console.log(`🎉 SIKERES CSATLAKOZÁS: ${username}!`);
    console.log('==============================================================');
    console.log('✅ A fiókodat a Renderen futó szerver sikeresen elmentette.');
    console.log('🚀 A botod mostantól 24/7 automatikusan végzi a küldetéseidet a felhőben!');
    console.log('💻 Ezt a terminál ablakot és a gépedet most már nyugodtan bezárhatod.\n');

    // Clean up temporary qr image
    try {
      unlinkSync(path.join(process.cwd(), 'discord-login-qr.png'));
    } catch {}

    process.exit(0);
  } catch (err) {
    console.error(`❌ Hiba a szinkronizáció során: ${err.message}`);
    process.exit(1);
  }
});

session.on('captcha_required', async ({ sitekey, rqdata, solve }) => {
  console.log('🛡️  A Discord egy gyors robotellenőrzést (hCaptcha) kér a fiókodhoz!');
  console.log('🌐 Megnyitom a böngésződben a jóváhagyó ablakot...\n');

  const port = 48123;
  let server = null;

  server = http.createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="hu">
<head>
  <meta charset="UTF-8">
  <title>OrbHunter — Discord Hitelesítés</title>
  <script src="https://js.hcaptcha.com/1/api.js" async defer></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      background: radial-gradient(circle at 50% 20%, #1a1e36 0%, #0b0e14 70%);
      color: #f2f3f5;
      font-family: 'Outfit', -apple-system, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid rgba(88, 101, 242, 0.4);
      box-shadow: 0 16px 50px rgba(0,0,0,0.8), 0 0 30px rgba(88, 101, 242, 0.3);
      border-radius: 20px;
      padding: 36px 32px;
      text-align: center;
      max-width: 420px;
      width: 100%;
    }
    h2 { font-size: 22px; margin-bottom: 8px; }
    p { color: #949ba4; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    #widget { display: flex; justify-content: center; margin-bottom: 16px; }
    .status { font-size: 14px; color: #5865f2; font-weight: 600; display: none; }
  </style>
</head>
<body>
  <div class="card" id="card">
    <div style="font-size: 40px; margin-bottom: 12px;">🛡️</div>
    <h2>Discord Ellenőrzés</h2>
    <p>A Discord megerősítést kér a fiókod belépéséhez.<br>Csak pipáld be az alábbi négyzetet:</p>
    <div id="widget"></div>
    <div class="status" id="status">⏳ Ellenőrzés feldolgozása...</div>
  </div>
  <script>
    function renderWidget() {
      if (!window.hcaptcha) return setTimeout(renderWidget, 150);
      hcaptcha.render('widget', {
        sitekey: '${sitekey}',
        ${rqdata ? `rqdata: ${JSON.stringify(rqdata)},` : ''}
        callback: function(token) {
          document.getElementById('status').style.display = 'block';
          fetch('/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, userAgent: navigator.userAgent })
          })
          .then(function(r) { return r.json(); })
          .then(function(res) {
            if (res.success) {
              document.getElementById('card').innerHTML = '<div style="font-size: 48px; margin-bottom: 12px;">🎉</div><h2 style="color:#57f287;">Sikeres ellenőrzés!</h2><p style="color:#f2f3f5;">A fiókod aktiválva lett. Ezt a lapot most már bezárhatod!</p>';
              setTimeout(function() { window.close(); }, 2500);
            } else {
              alert('Hiba: ' + (res.error || 'Ismeretlen hiba'));
            }
          })
          .catch(function(err) {
            alert('Hálózati hiba: ' + err.message);
          });
        }
      });
    }
    renderWidget();
  </script>
</body>
</html>`);
      return;
    }

    if (req.method === 'POST' && req.url === '/submit') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const { token, userAgent } = JSON.parse(body);
          console.log('⚡ Captcha jóváhagyás beérkezett, beküldés a Discordnak...');
          await solve(token, userAgent);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          setTimeout(() => {
            try { server.close(); } catch {}
          }, 1500);
        } catch (err) {
          console.error('❌ Hiba a captcha beküldésekor:', err.message);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`🔗 Ha a böngésző nem nyílt meg, kattints ide a jóváhagyáshoz: ${url}\n`);
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    }
  });
});

session.on('cancel', () => {
  console.log('\n❌ A bejelentkezést megszakították a telefonodon.');
  process.exit(1);
});

session.on('timeout', () => {
  console.log('\n⏳ A QR-kód lejárt. Indítsd újra a programot!');
  process.exit(1);
});

session.on('error', (err) => {
  console.error(`\n❌ Csatlakozási hiba: ${err.message}`);
  process.exit(1);
});

session.start();
