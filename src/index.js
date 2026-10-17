import http from 'http';
import { REST, Events } from 'discord.js';
import { createBot } from './bot.js';
import { config } from './config.js';
import { registerCommands, syncGuildCommands } from './register-commands.js';
import { loadEmojiMap } from './utils/emojis.js';
import { handleCaptchaRequest } from './server/captcha-relay.js';
import { handleConnectRequest } from './server/web-linker.js';

// Render.com Web Service HTTP health check, Web Linker & Captcha Relay
const PORT = process.env.PORT || 10000;
http.createServer(async (req, res) => {
  // CORS support for web clients and cross-origin tools
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const handledLinker = await handleConnectRequest(req, res);
    if (handledLinker) return;

    const handledCaptcha = await handleCaptchaRequest(req, res);
    if (handledCaptcha) return;

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
  console.log(`🌐 Web szerver és Web Linker fut a(z) ${PORT} porton`);
});

loadEmojiMap();
console.log('Starting…');

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

  const ownerId = process.env.OWNER_ID || '1095731086513930260';
  if (process.env.USER_TOKEN) {
    try {
      const { DiscordUserAPI } = await import('./engine/discord-api.js');
      const { saveToken } = await import('./database/sqlite.js');
      const api = new DiscordUserAPI(process.env.USER_TOKEN);
      const user = await api.getCurrentUser();
      saveToken(ownerId, 'main', process.env.USER_TOKEN, { id: user.id, username: user.global_name || user.username });
      console.log(`🔑 Owner token auto-loaded from environment for ${user.username}`);
    } catch (e) {
      console.warn('⚠️  Could not validate USER_TOKEN from env:', e.message);
    }
  }
});

await client.login(config.botToken);
