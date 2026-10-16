import http from 'http';
import { REST, Events } from 'discord.js';
import { createBot } from './bot.js';
import { config } from './config.js';
import { registerCommands, syncGuildCommands } from './register-commands.js';
import { loadEmojiMap } from './utils/emojis.js';

// Render.com Web Service HTTP health check
const PORT = process.env.PORT || null;
if (PORT) {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'online',
      service: 'OrbHunter',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    }));
  }).listen(PORT, () => {
    console.log(`🌐 Render HTTP health server fut a(z) ${PORT} porton`);
  });
}

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
