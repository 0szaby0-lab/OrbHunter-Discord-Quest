import { SlashCommandBuilder, AttachmentBuilder, ButtonBuilder, ActionRowBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { RemoteAuthSession } from '../engine/remote-auth.js';
import { proxyManager } from '../engine/proxy-manager.js';
import { createCaptchaSession, getPublicBaseUrl } from '../server/captcha-relay.js';
import { saveToken, getDecryptedToken, removeToken, listTokens } from '../database/sqlite.js';
import { ok, warn, err, ui, E } from '../utils/embeds.js';
import { maskToken } from '../utils/crypto.js';
import { parseAllQuests } from '../engine/quest-parser.js';
import { config } from '../config.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('login')
    .setDescription('Log in securely via Discord QR Code (no token required)')
    .addStringOption(o => o.setName('label').setDescription('Label (default: main)')),

  new SlashCommandBuilder()
    .setName('token')
    .setDescription('Manage your account authentication')
    .addSubcommand(s => s.setName('login').setDescription('Log in securely via Discord QR Code')
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

  const proxyUrl = await proxyManager.getLoginProxy();
  const session = new RemoteAuthSession({ proxyUrl });

  session.on('qr', async ({ buffer }) => {
    const attachment = new AttachmentBuilder(buffer, { name: 'discord-login-qr.png' });
    const embed = ui('Discord QR Bejelentkezés', [
      `${E.spark()} **Nem szükséges tokent másolnod!**`,
      '',
      '📱 **1.** Nyisd meg a **Discord mobilappot**.',
      '⚙️ **2.** Koppints a jobb alsó **profilképedre** (Beállítások).',
      '📷 **3.** Válaszd a **QR-kód beolvasása** gombot, és olvasd be a lenti kódot.',
      '✅ **4.** A telefonodon erősítsd meg a bejelentkezést.',
      '',
      `⏳ *A kód 2 percig érvényes.* Mentési címke: \`${label}\``,
    ].join('\n'))
      .setImage('attachment://discord-login-qr.png');

    await ix.editReply({
      embeds: [embed],
      files: [attachment],
      components: [],
    }).catch(() => {});
  });

  session.on('scanned', async ({ user }) => {
    const targetUser = user?.username ? `**${user.username}**` : 'Fiókod';
    const embed = ui('QR-kód Beolvasva', [
      `${E.radar()} ${targetUser} beolvasta a kódot!`,
      '',
      '👉 **Koppints a telefonodon a *Bejelentkezés jóváhagyása* gombra a folytatáshoz.**',
    ].join('\n'), config.brand.accent);

    await ix.editReply({
      embeds: [embed],
      files: [],
      components: [],
    }).catch(() => {});
  });

  session.on('captcha_status', async ({ tier, message }) => {
    const embed = ui('🤖 Automatikus Captcha Megoldás', [
      `${E.spark()} **Tier ${tier}:** ${message}`,
      '',
      '⏳ *Ez akár 30-60 másodpercig is tarthat. Kérlek várj...*',
    ].join('\n'), '#f0b232');

    await ix.editReply({
      embeds: [embed],
      files: [],
      components: [],
    }).catch(() => {});
  });

  session.on('captcha_required', async ({ sitekey, rqdata, rqtoken, solve }) => {
    const sessionId = createCaptchaSession({
      sitekey,
      rqdata,
      rqtoken,
      onSolved: async (captchaToken) => {
        try {
          await solve(captchaToken);
        } catch (e) {
          await ix.editReply({
            embeds: [err('Hiba a jóváhagyáskor', `${E.cross()} ${e.message}`)],
            components: [],
            files: [],
          }).catch(() => {});
        }
      },
    });

    const solveUrl = `${getPublicBaseUrl()}/captcha/${sessionId}`;

    const buttonRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('🧩 Captcha Feloldása (Kattints ide)')
        .setStyle(ButtonStyle.Link)
        .setURL(solveUrl)
    );

    const embed = ui('Discord Biztonsági Ellenőrzés — Manuális Feloldás', [
      `${E.warn()} **A Discord captchát kér, és az automatikus megoldás nem elérhető vagy sikertelen volt.**`,
      '',
      '👉 **Kattints az alábbi gombra, és old meg a captchát a böngésződben!**',
      '✅ A megoldás után a bot automatikusan befejezi a bejelentkezést.',
      '',
      `⏳ *A link 5 percig érvényes.*`,
      '',
      '💡 *Tipp: Állítsd be a CAPSOLVER_API_KEY env változót az automatikus megoldáshoz!*',
    ].join('\n'), '#f0b232');

    await ix.editReply({
      embeds: [embed],
      components: [buttonRow],
      files: [],
    }).catch(() => {});
  });

  session.on('finish', async ({ token }) => {
    try {
      const api = new DiscordUserAPI(token);
      const user = await api.getCurrentUser();
      saveToken(uid, label, token, { id: user.id, username: user.global_name || user.username });

      let questCountText = '';
      try {
        const quests = parseAllQuests(await api.fetchAllQuests());
        const active = quests.filter(q => !q.completed).length;
        questCountText = `\n${E.radar()} **${active}** aktív küldetés elérhető a fiókon.`;
      } catch {
        /* quest fetch fallback */
      }

      const embed = ok('Sikeres Bejelentkezés!', [
        `${E.check()} **${user.global_name || user.username}** fiók elmentve (\`${label}\`)`,
        questCountText,
        '',
        `🚀 Most már futtathatod: \`/quests all\` vagy \`/quests list\``,
      ].filter(Boolean).join('\n'));

      await ix.editReply({
        embeds: [embed],
        files: [],
        components: [],
      }).catch(() => {});
    } catch (err) {
      await ix.editReply({
        embeds: [err('Hiba a jóváhagyáskor', `${E.cross()} Nem sikerült a felhasználói adatokat lekérni: ${err.message}`)],
        files: [],
        components: [],
      }).catch(() => {});
    }
  });

  session.on('cancel', async () => {
    await ix.editReply({
      embeds: [warn('Megszakítva', `${E.cross()} A bejelentkezést megszakították a telefonon vagy lejárt a munkamenet.`)],
      files: [],
      components: [],
    }).catch(() => {});
  });

  session.on('timeout', async () => {
    await ix.editReply({
      embeds: [warn('Lejárt a munkamenet', `${E.clock()} A QR-kód érvényessége lejárt. Újraindításhoz futtasd a \`/login\` parancsot.`)],
      files: [],
      components: [],
    }).catch(() => {});
  });

  session.on('error', async (error) => {
    console.error('Remote auth error:', error.message);
    const isCaptcha = error.message && error.message.includes('captcha-required');
    const title = isCaptcha ? 'Discord Felhős Védelem (Captcha)' : 'Csatlakozási hiba';
    const proxyStatus = proxyUrl ? `🛡️ *Használt login proxy:* \`${proxyUrl}\`` : '🌐 *Közvetlen Render IP használatban*';
    const desc = isCaptcha
      ? [
          `${E.warn()} **A Discord felhős IP-ről captchát kért a QR-kódhoz.**`,
          proxyStatus,
          '',
          `👉 **Azonnali megoldás:** Nyomd meg a **🔑 Token Megadása** gombot a panelen vagy futtasd a \`/token add\` parancsot!`,
        ].join('\n')
      : `${E.cross()} Nem sikerült kapcsolódni a Discord Remote Auth átjárójához (${error.message}).`;

    await ix.editReply({
      embeds: [err(title, desc)],
      files: [],
      components: [],
    }).catch(() => {});
  });

  session.start();
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
