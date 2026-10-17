import { SlashCommandBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { createConnectSession, getPublicBaseUrl } from '../server/web-linker.js';
import { saveToken, getDecryptedToken, removeToken, listTokens } from '../database/sqlite.js';
import { ok, warn, err, ui, E } from '../utils/embeds.js';
import { maskToken } from '../utils/crypto.js';
import { parseAllQuests } from '../engine/quest-parser.js';
import { config } from '../config.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Log in securely via Discord QR Code or Web (no token copy required)')
    .addStringOption(o => o.setName('label').setDescription('Label (default: main)')),

  new SlashCommandBuilder()
    .setName('token')
    .setDescription('Manage your account authentication')
    .addSubcommand(s => s.setName('login').setDescription('Log in securely via Discord QR Code or Web')
      .addStringOption(o => o.setName('label').setDescription('Label (default: main)')))
    .addSubcommand(s => s.setName('add').setDescription('Save token manually')
      .addStringOption(o => o.setName('token').setDescription('Discord token').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Label (default: main)')))
    .addSubcommand(s => s.setName('remove').setDescription('Remove token')
      .addStringOption(o => o.setName('label').setDescription('Label').setRequired(true)))
    .addSubcommand(s => s.setName('check').setDescription('Verify token')
      .addStringOption(o => o.setName('label').setDescription('Label')))
    .addSubcommand(s => s.setName('list').setDescription('List saved tokens')),
];

export async function handleQrLogin(ix, label = 'main') {
  await ix.deferReply({ flags: MessageFlags.Ephemeral });
  const uid = ix.user.id;
  const username = ix.user.globalName || ix.user.username;

  const sessionId = createConnectSession({
    uid,
    username,
    label,
    onLinked: async ({ user }) => {
      let questCountText = '';
      try {
        const api = new DiscordUserAPI(getDecryptedToken(uid, label));
        const quests = parseAllQuests(await api.fetchAllQuests());
        const active = quests.filter(q => !q.completed).length;
        questCountText = `\n${E.radar()} **${active}** aktív küldetés elérhető a fiókon.`;
      } catch {
        /* fallback */
      }

      const embed = ok('Fiók Sikeresen Összekapcsolva!', [
        `${E.check()} **${user.global_name || user.username}** fiók elmentve (\`${label}\`)`,
        questCountText,
        '',
        `🚀 Most már futtathatod: \`/quests all\` vagy \`/quests auto\``,
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
      .setLabel('🌐 Fiók Összekapcsolása (Kattints ide)')
      .setStyle(ButtonStyle.Link)
      .setURL(connectUrl)
  );

  const embed = ui('OrbHunter — Fiók Csatlakoztatása', [
    `${E.spark()} **Kapcsold össze a Discord profilodat az OrbHunterrel a weboldalon keresztül!**`,
    '',
    '👉 **1.** Kattints az alábbi gombra a csatlakozási oldal megnyitásához.',
    '⚡ **2.** A felületen válaszd az **1-Kattintásos Csatlakozás** gombot, vagy add meg közvetlenül a fiókodat.',
    '✅ **3.** Az összekapcsolás után a bot automatikusan aktiválja a küldetéseket!',
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
      const token = ix.options.getString('token');
      const label = ix.options.getString('label') || 'main';
      try {
        const api = new DiscordUserAPI(token);
        const user = await api.getCurrentUser();
        saveToken(uid, label, token, { id: user.id, username: user.global_name || user.username });
        return ix.editReply({ embeds: [ok('Saved', `${E.check()} **${user.global_name || user.username}** → \`${label}\``)] });
      } catch {
        return ix.editReply({ embeds: [err('Invalid', `${E.cross()} Token failed auth.`)] });
      }
    }

    if (sub === 'remove') {
      const label = ix.options.getString('label');
      const removed = removeToken(uid, label);
      return ix.reply({
        embeds: [removed ? ok('Removed', `${E.check()} \`${label}\``) : warn('Not found', `\`${label}\``)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'check') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const label = ix.options.getString('label') || 'main';
      const token = getDecryptedToken(uid, label) || getDecryptedToken(uid, 'default');
      if (!token) return ix.editReply({ embeds: [warn('Missing', `${E.key()} \`/login\` vagy \`/token add\``)] });

      try {
        const api = new DiscordUserAPI(token);
        const user = await api.getCurrentUser();
        const quests = parseAllQuests(await api.fetchAllQuests());
        const active = quests.filter(q => !q.completed).length;
        return ix.editReply({
          embeds: [ok('Valid', [
            `${E.check()} **${user.global_name || user.username}**`,
            `${E.radar()} **${active}** quest(s) found`,
            `${E.key()} \`${maskToken(token)}\``,
          ].join('\n'))],
        });
      } catch {
        return ix.editReply({ embeds: [err('Dead', `${E.skull()} Token expired.`)] });
      }
    }

    if (sub === 'list') {
      const tokens = listTokens(uid);
      if (!tokens.length) return ix.reply({ embeds: [warn('Empty', `${E.key()} \`/login\` vagy \`/token add\``)], flags: MessageFlags.Ephemeral });
      const lines = tokens.map((t, i) => `${E.key()} \`${t.label}\` — **${t.discord_username || '?'}**`);
      return ix.reply({ embeds: [ok('Tokens', lines.join('\n'))], flags: MessageFlags.Ephemeral });
    }
  },
};
