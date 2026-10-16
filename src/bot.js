import { Client, GatewayIntentBits, Events, ActivityType, REST } from 'discord.js';
import { config } from './config.js';
import { commands, handlers, handlePanelButton, handlePanelModal } from './commands/index.js';
import { syncSingleGuild } from './register-commands.js';
import { err } from './utils/embeds.js';

export function createBot(rest = null) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, (c) => {
    console.log(`Online: ${c.user.tag}`);
    c.user.setActivity('quests | /panel', { type: ActivityType.Watching });
  });

  client.on(Events.GuildCreate, async (guild) => {
    if (config.guildId) return;
    try {
      await syncSingleGuild(guild.id, guild.name, rest);
    } catch (e) {
      console.warn(`Sync failed for ${guild.name}:`, e.message);
    }
  });

  client.on(Events.InteractionCreate, async (ix) => {
    if (ix.isModalSubmit()) {
      try {
        await handlePanelModal(ix);
      } catch (e) {
        console.error(`[Modal:${ix.customId}]`, e);
        const payload = { embeds: [err('Hiba', e.message || 'Hiba történt a felugró űrlap feldolgozásakor.')], ephemeral: true };
        if (ix.deferred || ix.replied) await ix.editReply(payload).catch(() => {});
        else await ix.reply(payload).catch(() => {});
      }
      return;
    }

    if (ix.isButton()) {
      try {
        await handlePanelButton(ix);
      } catch (e) {
        console.error(`[Button:${ix.customId}]`, e);
        const payload = { embeds: [err('Hiba', e.message || 'Hiba történt a gomb megnyomásakor.')], ephemeral: true };
        if (ix.deferred || ix.replied) await ix.editReply(payload).catch(() => {});
        else await ix.reply(payload).catch(() => {});
      }
      return;
    }

    if (!ix.isChatInputCommand()) return;
    const handler = handlers.get(ix.commandName);
    if (!handler) return;

    try {
      await handler(ix);
    } catch (e) {
      console.error(`[${ix.commandName}]`, e);
      const payload = { embeds: [err('Error', e.message || 'Something went wrong.')], ephemeral: true };
      if (ix.deferred || ix.replied) await ix.editReply(payload).catch(() => {});
      else await ix.reply(payload).catch(() => {});
    }
  });

  return client;
}

export { commands };
