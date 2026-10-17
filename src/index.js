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
});

await client.login(config.botToken);
