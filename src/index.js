import http from 'http';
import { REST, Events } from 'discord.js';
import { createBot } from './bot.js';
import { config } from './config.js';
import { registerCommands, syncGuildCommands } from './register-commands.js';
import { loadEmojiMap } from './utils/emojis.js';
import { handleCaptchaRequest } from './server/captcha-relay.js';
import { startWarp } from './engine/warp-manager.js';

// Render.com Web Service HTTP health check & Captcha Relay
const PORT = process.env.PORT || 10000;
http.createServer(async (req, res) => {
  try {
    const handled = await handleCaptchaRequest(req, res);
    if (handled) return;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'OrbHunter',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}).listen(PORT, () => {
  console.log(`🌐 Web szerver és Captcha Relay fut a(z) ${PORT} porton`);
});

loadEmojiMap();
console.log('Starting…');

// Start Cloudflare WARP proxy (free residential IP masking)
startWarp().then(ok => {
  if (ok) {
    console.log('🌐 Cloudflare WARP aktív — residential IP a Discord felé');
  } else {
    console.log('⚡ WARP nem elérhető — közvetlen kapcsolat vagy konfigurált proxy');
  }
}).catch(err => {
  console.warn('⚠️  WARP indítás hiba (nem kritikus):', err.message);
});

const rest = new REST({ version: '10' }).setToken(config.botToken);

try {
  await registerCommands(rest);
} catch (err) {
  console.error('❌ Failed to register slash commands:', err.message);
  process.exit(1);
}

const client = createBot(rest);

client.once(Events.ClientReady, async () => {
  try {
    await syncGuildCommands(client, rest);
  } catch (err) {
    console.warn('⚠️  Guild command sync failed:', err.message);
  }
});

await client.login(config.botToken);
