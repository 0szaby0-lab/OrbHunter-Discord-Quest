import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright-core';
import { DiscordUserAPI } from '../src/engine/discord-api.js';
import { saveToken } from '../src/database/sqlite.js';
import { config } from '../src/config.js';

const RENDER_BASE_URL = process.env.RENDER_EXTERNAL_URL || 'https://orbhunter-discord-quest.onrender.com';

function getBrowserPath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    (process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Microsoft\\Edge\\Application\\msedge.exe') : null),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

async function main() {
  console.clear();
  console.log('==============================================================');
  console.log('       OrbHunter — Helyi Biztonságos Discord Bejelentkezés    ');
  console.log('==============================================================\n');

  const browserPath = getBrowserPath();
  if (!browserPath) {
    console.error('❌ Nem található sem Google Chrome, sem Microsoft Edge a gépeden.');
    console.error('Kérlek telepítsd a Google Chrome-ot a bejelentkezéshez.');
    process.exit(1);
  }

  console.log('🌐 Megnyitom a hivatalos Discord bejelentkező ablakot...\n');
  console.log('📱 1. Olvasd be a felugró ablakban megjelenő QR-kódot a telefonoddal (vagy lépj be).');
  console.log('⚡ 2. A jóváhagyás után ez az ablak azonnal és automatikusan aktiválja a botodat!\n');
  console.log('⏳ Várakozás a bejelentkezésre...\n');

  const userDataDir = path.join(process.cwd(), '.chromium_profile');

  const browser = await chromium.launchPersistentContext(userDataDir, {
    executablePath: browserPath,
    headless: false,
    viewport: { width: 950, height: 720 },
    args: [
      '--app=https://discord.com/login',
      '--window-size=950,720',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = browser.pages()[0] || await browser.newPage();

  let resolvedToken = null;

  async function handleCapturedToken(token) {
    if (resolvedToken) return;
    resolvedToken = token;

    console.log('⚡ Bejelentkezés sikeresen észlelve! Adatok feldolgozása...\n');

    try {
      await browser.close().catch(() => {});
    } catch {}

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
      console.log('💻 Ezt a parancssor ablakot most már nyugodtan bezárhatod.\n');

      process.exit(0);
    } catch (err) {
      console.error(`❌ Hiba a szinkronizáció során: ${err.message}`);
      process.exit(1);
    }
  }

  // Intercept authorization header from any API request on discord.com
  page.on('request', async req => {
    const auth = req.headers()['authorization'];
    if (auth && !auth.startsWith('Bot ') && auth.length > 40) {
      await handleCapturedToken(auth);
    }
  });

  // Also poll localStorage in case page already authenticated
  const pollInterval = setInterval(async () => {
    if (resolvedToken) {
      clearInterval(pollInterval);
      return;
    }
    try {
      const token = await page.evaluate(() => {
        try {
          const iframe = document.createElement('iframe');
          document.body.appendChild(iframe);
          const t = iframe.contentWindow.localStorage.token;
          iframe.remove();
          return t ? t.replace(/"/g, '') : null;
        } catch {
          return null;
        }
      });
      if (token && token.length > 40) {
        clearInterval(pollInterval);
        await handleCapturedToken(token);
      }
    } catch {}
  }, 1000);

  // If user closes window manually before login
  browser.on('close', () => {
    if (!resolvedToken) {
      console.log('\n❌ A bejelentkező ablakot bezártad a hitelesítés előtt.');
      process.exit(0);
    }
  });
}

main().catch(err => {
  console.error('❌ Hiba történt:', err.message);
  process.exit(1);
});
