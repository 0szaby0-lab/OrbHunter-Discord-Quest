import { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { createConnectSession, getPublicBaseUrl } from '../server/web-linker.js';
import { saveToken, getDecryptedToken, removeToken, listTokens } from '../database/sqlite.js';
import { ok, warn, err, ui, E } from '../utils/embeds.js';
import { maskToken } from '../utils/crypto.js';
import { parseAllQuests } from '../engine/quest-parser.js';
import { config } from '../config.js';
import { buildAccountsView } from './panel.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Biztonságos felhős fiókcsatlakozás (mobilon és számítógépen)')
    .addStringOption(o => o.setName('label').setDescription('Címke (alapértelmezett: main)')),

  new SlashCommandBuilder()
    .setName('token')
    .setDescription('Fiókcsatlakozás és hitelesítés kezelése')
    .addSubcommand(s => s.setName('login').setDescription('Biztonságos felhős fiókcsatlakozás')
      .addStringOption(o => o.setName('label').setDescription('Címke (alapértelmezett: main)')))
    .addSubcommand(s => s.setName('add').setDescription('Fiók közvetlen csatlakoztatása kulccsal (token)')
      .addStringOption(o => o.setName('token').setDescription('Discord fiók-kulcs').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Címke (alapértelmezett: main)')))
    .addSubcommand(s => s.setName('check').setDescription('Csatlakoztatott fiók ellenőrzése és küldetések lekérése')
      .addStringOption(o => o.setName('label').setDescription('Címke')))
    .addSubcommand(s => s.setName('list').setDescription('Csatlakoztatott profilok listája'))
    .addSubcommand(s => s.setName('remove').setDescription('Fiók leválasztása az adatbázisból')
      .addStringOption(o => o.setName('label').setDescription('Címke').setRequired(true))),
];

export async function handleQrLogin(ix, label = 'main') {
  await ix.deferReply({ flags: MessageFlags.Ephemeral });
  const uid = ix.user.id;
  const username = ix.user.globalName || ix.user.username;

  const sessionId = createConnectSession({
    uid,
    username,
    label,
    onLinked: async ({ user, label: linkedLabel }) => {
      const targetLabel = linkedLabel || label || 'main';
      let questCountText = '';
      try {
        const api = new DiscordUserAPI(getDecryptedToken(uid, targetLabel));
        const quests = parseAllQuests(await api.fetchAllQuests());
        const active = quests.filter(q => !q.completed).length;
        questCountText = `\n${E.radar()} **${active}** aktív küldetés elérhető a fiókon.`;
      } catch {
        /* fallback */
      }

      const embed = ok('Fiók Sikeresen Összekapcsolva!', [
        `${E.check()} **${user.global_name || user.username}** fiók elmentve (\`${targetLabel}\`)!`,
        questCountText,
        '',
        `🚀 Most már futtathatod a vezérlőpulton a **Turbo Start** vagy **Minden Quest** gombot!`,
      ].filter(Boolean).join('\n'));

      await ix.editReply({
        embeds: [embed],
        files: [],
        components: [],
      }).catch(() => {});
    },
  });

  const connectUrl = `${getPublicBaseUrl()}/connect/${sessionId}`;

  const buttonRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('🌐 Csatlakozási Oldal Megnyitása')
      .setStyle(ButtonStyle.Link)
      .setURL(connectUrl)
  );

  const embed = ui('OrbHunter — Fiók Csatlakoztatása', [
    `${E.spark()} **Kapcsold össze a Discord profilodat az OrbHunterrel!**`,
    '',
    '🌐 **1. Csatlakozás a Weben:**',
    'Kattints az alábbi gombra! A weboldalon 1 kattintással (vagy a kulcsod beillesztésével) azonnal aktiválhatod a fiókodat.',
    '',
    '💬 **2. Vagy közvetlenül a Discordban:**',
    'Használd a `/panel` parancsot, és kattints a zöld **🔑 Csatlakozás** gombra!',
    '',
    `⏳ *A link 15 percig érvényes.* Mentési címke: \`${label}\``,
  ].join('\n'), config.brand.accent);

  await ix.editReply({
    embeds: [embed],
    components: [buttonRow],
    files: [],
  }).catch(() => {});
}

export const handlers = {
  login: async (ix) => {
    const label = ix.options?.getString('label') || 'main';
    return handleQrLogin(ix, label);
  },

  token: async (ix) => {
    const sub = ix.options.getSubcommand();
    const uid = ix.user.id;

    if (sub === 'login') {
      const label = ix.options.getString('label') || 'main';
      return handleQrLogin(ix, label);
    }

    if (sub === 'add') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const token = ix.options.getString('token').trim().replace(/["']/g, '');
      const label = ix.options.getString('label') || 'main';
      try {
        const api = new DiscordUserAPI(token);
        const user = await api.getCurrentUser();
        saveToken(uid, label, token, { id: user.id, username: user.global_name || user.username });
        return ix.editReply({ embeds: [ok('Fiók Elmentve', `${E.check()} **${user.global_name || user.username}** fiókod sikeresen csatlakoztatva lett (\`${label}\`)!`)] });
      } catch (err) {
        return ix.editReply({ embeds: [err('Érvénytelen Kulcs', `${E.cross()} Nem sikerült a hitelesítés: ${err.message}`)] });
      }
    }

    if (sub === 'remove') {
      const label = ix.options.getString('label');
      const removed = removeToken(uid, label);
      return ix.reply({
        embeds: [removed ? ok('Eltávolítva', `${E.check()} A(z) \`${label}\` fiók sikeresen le lett választva.`) : warn('Nem található', `Nincs elmentve ilyen címkéjű fiók: \`${label}\``)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'check') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const label = ix.options.getString('label') || 'main';
      const token = getDecryptedToken(uid, label) || getDecryptedToken(uid, 'default');
      if (!token) return ix.editReply({ embeds: [warn('Nincs Fiók', `${E.key()} Még nem csatlakoztattál fiókot. Használd a \`/login\` parancsot vagy a vezérlőpult gombját!`)] });

      try {
        const api = new DiscordUserAPI(token);
        const user = await api.getCurrentUser();
        const quests = parseAllQuests(await api.fetchAllQuests());
        const active = quests.filter(q => !q.completed).length;
        return ix.editReply({
          embeds: [ok('Érvényes Fiók', [
            `${E.check()} Felhasználó: **${user.global_name || user.username}**`,
            `${E.radar()} **${active}** aktív küldetés elérhető`,
            `${E.key()} Állapot: Csatlakoztatva és aktív`,
          ].join('\n'))],
        });
      } catch {
        return ix.editReply({ embeds: [err('Lejárt', `${E.skull()} A munkamenet lejárt. Kérlek csatlakoztasd újra a fiókodat a \`/login\` paranccsal.`)] });
      }
    }

    if (sub === 'list') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const view = await buildAccountsView(uid);
      return ix.editReply(view);
    }
  },
};
