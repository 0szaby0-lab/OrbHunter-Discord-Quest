import 'dotenv/config';
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
