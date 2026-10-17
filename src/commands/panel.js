import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } from 'discord.js';
import { ok, warn, err, E, questListEmbed, statusEmbed, helpEmbed } from '../utils/embeds.js';
import { QuestEngine, getRunState, abortRun } from '../engine/quest-engine.js';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { getSettings, saveSettings, getDecryptedToken, listTokens, removeToken, saveToken } from '../database/sqlite.js';
import { filterRunnableQuests } from '../engine/quest-parser.js';
import { runMode, ctx, fetchParsed } from './quests.js';
import { handleQrLogin } from './token.js';
import { maskToken } from '../utils/crypto.js';

export function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle(`${E.spider()}  ORBHUNTER — VEZÉRLŐPULT`)
    .setDescription([
      '**Üdvözöl a küldetésvezérlő központban!**',
      'Itt minden funkciót közvetlenül gombokkal irányíthatsz, parancsgépelés nélkül.',
      '*A gombok privátak: mindenki a saját Discord fiókját vezérli.*',
      '',
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
    ].join('\n'))
    .addFields(
      {
        name: `${E.fire()}  KÜLDETÉSEK FUTTATÁSA`,
        value: [
          '>>> 🟢 **Turbo Start** — Maximális sebességű párhuzamos darálás',
          '🔵 **Minden Quest** — Normál tempójú, stabil párhuzamos futtatás',
          '⚪ **Sorban Futás** — Küldetések egymás utáni végrehajtása',
          '📊 **Élő Státusz** — Folyamatban lévő futás valós idejű követése',
          '🔴 **Leállítás** — Futó küldetés-folyamat azonnali megszakítása',
        ].join('\n'),
        inline: false,
      },
      {
        name: `${E.gem()}  KEZELÉS & JUTALMAK`,
        value: [
          '>>> 📡 **Quest Radar** — Elérhető küldetések, követelmények és rewardok',
          '✅ **Összes Elfogadása** — Belépés az összes küldetésbe futtatás nélkül',
          '💰 **Jutalmak Átvétele** — Kész küldetések és orbs/nitro jutalmak beváltása',
          '🔄 **Pult Frissítés** — A vezérlőpult újratöltése',
        ].join('\n'),
        inline: false,
      },
      {
        name: `${E.rocket()}  GYORS BEÁLLÍTÁSOK (KAPCSOLÓK)`,
        value: [
          '>>> ⚡ **Turbo Ki/Be** — Alapértelmezett Turbo mód gyorsváltója',
          '🎁 **Auto-Claim Ki/Be** — Kész jutalmak automatikus átvétele',
          '📝 **Auto-Enroll Ki/Be** — Küldetések automatikus elfogadása',
          '⚙️ **Beállítások Info** — Jelenlegi fiókbeállításaid ellenőrzése',
        ].join('\n'),
        inline: false,
      },
      {
        name: `${E.key()}  FIÓK & BEJELENTKEZÉS`,
        value: [
          '>>> 📱 **QR Belépés** — Discord belépés mobil QR kóddal',
          '🔑 **Token Megadása** — Felhős környezetben (Render) a legstabilabb belépés',
          '🔍 **Fiók Info** — Csatlakoztatott profil és aktív küldetésszám',
          '📑 **Fiókjaim Listája** — Elmentett profiljaid megtekintése',
          '🗑️ **Kijelentkezés** — Fiók és token azonnali törlése az adatbázisból',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'OrbHunter v1.0 • Teljes Automatizálás • Kattints egy gombra alább' })
    .setTimestamp();

  // Sor 1: Futtatási funkciók
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_turbo')
      .setLabel('Turbo Start')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_all')
      .setLabel('Minden Quest')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_run')
      .setLabel('Sorban Futás')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_status')
      .setLabel('Élő Státusz')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_stop')
      .setLabel('Leállítás')
      .setEmoji('🛑')
      .setStyle(ButtonStyle.Danger),
  );

  // Sor 2: Küldetéskezelés & Jutalmak
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_list')
      .setLabel('Quest Radar')
      .setEmoji('📡')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_accept')
      .setLabel('Összes Elfogadása')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_claim')
      .setLabel('Jutalmak Átvétele')
      .setEmoji('💰')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_refresh')
      .setLabel('Pult Frissítés')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );

  // Sor 3: Kapcsolók
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_toggle_turbo')
      .setLabel('Turbo Ki/Be')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_toggle_claim')
      .setLabel('Auto-Claim Ki/Be')
      .setEmoji('🎁')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_toggle_enroll')
      .setLabel('Auto-Enroll Ki/Be')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_settings_view')
      .setLabel('Beállítások Info')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
  );

  // Sor 4: Fiókkezelés
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_login')
      .setLabel('QR Belépés')
      .setEmoji('📱')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_manual_token')
      .setLabel('Token Megadása')
      .setEmoji('🔑')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_check')
      .setLabel('Fiók Info')
      .setEmoji('🔍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_token_list')
      .setLabel('Fiókjaim Listája')
      .setEmoji('📑')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_token_remove')
      .setLabel('Kijelentkezés')
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2, row3, row4] };
}

export const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Megnyitja a letisztult, modern interaktív grafikus vezérlőpultot'),
];

const OWNER_ID = process.env.OWNER_ID || '1095731086513930260';

export async function handlePanelButton(ix) {
  const id = ix.customId;
  const uid = ix.user.id;

  // --- SOR 1: Küldetés Futtatás ---
  if (id === 'btn_turbo' || id === 'panel_turbo') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    return runMode(ix, { turbo: true });
  }

  if (id === 'btn_all' || id === 'panel_all') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    return runMode(ix, {});
  }

  if (id === 'btn_run') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    return runMode(ix, { sequential: true });
  }

  if (id === 'btn_status' || id === 'panel_status') {
    const state = getRunState(uid);
    if (!state) {
      return ix.reply({ embeds: [ui('Nyugvó Állapot', `${E.clock()} Jelenleg nincs aktív küldetésfutás a fiókodon.`)], flags: MessageFlags.Ephemeral });
    }
    return ix.reply({ embeds: [statusEmbed(state.engine?.tasks, `${E.bolt()} Küldetések folyamatban…`)], flags: MessageFlags.Ephemeral });
  }

  if (id === 'btn_stop' || id === 'panel_stop') {
    const stopped = abortRun(uid);
    return ix.reply({
      embeds: [stopped ? warn('Megállítva', `${E.cross()} A küldetésfutás sikeresen megszakítva a fiókodon.`) : ui('Nincs Futás', `${E.clock()} Nem futott aktív folyamat a fiókodon.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- SOR 2: Kezelés & Jutalmak ---
  if (id === 'btn_list' || id === 'panel_list') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const c = await ctx(ix, 'main');
    if (c.error) {
      return ix.editReply({ embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Még nem csatlakoztattál fiókot! Kattints a **📱 QR Belépés** gombra.`)] });
    }
    try {
      const quests = await fetchParsed(c.token);
      return ix.editReply({ embeds: [questListEmbed(quests)] });
    } catch (e) {
      return ix.editReply({ embeds: [err('Hiba', `Nem sikerült lekérni a küldetéseket: ${e.message}`)] });
    }
  }

  if (id === 'btn_accept') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const c = await ctx(ix, 'main');
    if (c.error) {
      return ix.editReply({ embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Még nem csatlakoztattál fiókot! Kattints a **📱 QR Belépés** gombra.`)] });
    }
    try {
      const engine = new QuestEngine(c.token);
      const quests = filterRunnableQuests(await engine.fetchQuests());
      const pending = quests.filter(q => !q.enrolled);

      if (!pending.length) {
        return ix.editReply({ embeds: [ui('Minden Elfogadva', `${E.check()} Mind a **${quests.length}** elérhető küldetés már el van fogadva a fiókodon.`)] });
      }

      await ix.editReply({ embeds: [ui('Csatlakozás Folyamatban', `${E.key()} Belépés **${pending.length}** küldetésbe…`)] });
      const { accepted, failed } = await engine.enrollAll(quests);

      return ix.editReply({
        embeds: [ok('Küldetések Elfogadva', [
          `${E.check()} Sikeresen elfogadva: **${accepted.length}/${pending.length}** küldetés!`,
          accepted.length ? `\n${accepted.map(q => `• ${q.name}`).join('\n')}` : '',
          failed.length ? `\n\n${E.cross()} ${failed.length} küldetéshez nem sikerült csatlakozni.` : '',
        ].join(''))],
      });
    } catch (e) {
      return ix.editReply({ embeds: [err('Hiba', `Nem sikerült a küldetések elfogadása: ${e.message}`)] });
    }
  }

  if (id === 'btn_claim' || id === 'panel_claim') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const c = await ctx(ix, 'main');
    if (c.error) {
      return ix.editReply({ embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Használd a **📱 QR Belépés** gombot előbb.`)] });
    }

    try {
      const api = new DiscordUserAPI(c.token);
      const raw = await api.fetchAllQuests();
      const claimable = raw.filter(q => {
        const s = q.user_status || q.userStatus || {};
        return (s.completed_at || s.completedAt) && !(s.claimed_at || s.claimedAt);
      });

      if (!claimable.length) {
        return ix.editReply({ embeds: [ui('Nincs Jutalom', `${E.gem()} Jelenleg nincs átvételre váró jutalmad.`)] });
      }

      let n = 0;
      let captcha = false;
      for (const q of claimable) {
        try {
          await api.claimReward(q.id);
          n++;
        } catch (e) {
          if (e.body?.captcha_service) captcha = true;
        }
      }

      const body = captcha
        ? `${E.warn()} A Discord közvetlen captchát kér a beváltáshoz.\n\n${E.loot()} **${claimable.length}** kész küldetésed vár: nyisd meg a Discordban a **Discover → Quests** menüt és kattints a **Claim** gombra.`
        : `${E.loot()} Sikeresen átvéve **${n}/${claimable.length}** küldetés jutalma!`;

      return ix.editReply({ embeds: [captcha ? warn('Kézi Beváltás Szükséges', body) : ok('Jutalmak Átvéve', body)] });
    } catch (e) {
      return ix.editReply({ embeds: [err('Hiba', `Nem sikerült a jutalmak átvétele: ${e.message}`)] });
    }
  }

  if (id === 'btn_refresh' || id === 'panel_refresh') {
    return ix.update(buildPanelMessage());
  }

  // --- SOR 3: Gyors Kapcsolók ---
  if (id === 'btn_toggle_turbo') {
    const s = getSettings(uid);
    const next = s.turbo_mode ? 0 : 1;
    saveSettings(uid, { turbo_mode: next });
    const statusText = next ? `${E.check()} **BEKAPCSOLVA**` : `${E.cross()} **KIKAPCSOLVA**`;
    return ix.reply({
      embeds: [ok('Turbo Mód Váltva', `${E.rocket()} A fiókod alapértelmezett Turbo módja mostantól: ${statusText}`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'btn_toggle_claim') {
    const s = getSettings(uid);
    const next = s.auto_claim ? 0 : 1;
    saveSettings(uid, { auto_claim: next });
    const statusText = next ? `${E.check()} **BEKAPCSOLVA**` : `${E.cross()} **KIKAPCSOLVA**`;
    return ix.reply({
      embeds: [ok('Auto-Claim Váltva', `${E.loot()} Az automatikus jutalomátvétel a fiókodon: ${statusText}`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'btn_toggle_enroll') {
    const s = getSettings(uid);
    const next = s.auto_enroll ? 0 : 1;
    saveSettings(uid, { auto_enroll: next });
    const statusText = next ? `${E.check()} **BEKAPCSOLVA**` : `${E.cross()} **KIKAPCSOLVA**`;
    return ix.reply({
      embeds: [ok('Auto-Enroll Váltva', `${E.spark()} Az automatikus küldetéselfogadás a fiókodon: ${statusText}`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  if (id === 'btn_settings_view' || id === 'panel_settings') {
    const s = getSettings(uid);
    const on = v => v ? `${E.check()} bekapcsolva` : `${E.cross()} kikapcsolva`;
    return ix.reply({
      embeds: [ui('Fiók Beállításaid', [
        `${E.rocket()} Turbo mód: **${on(s.turbo_mode)}**`,
        `${E.loot()} Auto-claim jutalmak: **${on(s.auto_claim)}**`,
        `${E.spark()} Auto-enroll küldetések: **${on(s.auto_enroll)}**`,
      ].join('\n'))],
      flags: MessageFlags.Ephemeral,
    });
  }

  // --- SOR 4: Fiókkezelés ---
  if (id === 'btn_login' || id === 'panel_login') {
    return handleQrLogin(ix, 'main');
  }

  if (id === 'btn_check' || id === 'panel_check') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const token = getDecryptedToken(uid, 'main') || getDecryptedToken(uid, 'default');
    if (!token) {
      return ix.editReply({ embeds: [warn('Nincs Fiók Mentve', `${E.key()} Még nem mentettél el fiókot. Használd a **📱 QR Belépés** gombot.`)] });
    }

    try {
      const api = new DiscordUserAPI(token);
      const user = await api.getCurrentUser();
      const quests = await fetchParsed(token);
      const active = quests.filter(q => !q.completed).length;
      return ix.editReply({
        embeds: [ok('Fiók Információk', [
          `${E.check()} Felhasználó: **${user.global_name || user.username}**`,
          `${E.radar()} Aktív küldetések: **${active}** db elérhető`,
          `${E.key()} Token: \`${maskToken(token)}\``,
        ].join('\n'))],
      });
    } catch {
      return ix.editReply({ embeds: [err('Hiba', `${E.skull()} A mentett token érvénytelen vagy lejárt.`)] });
    }
  }

  if (id === 'btn_manual_token') {
    const modal = new ModalBuilder()
      .setCustomId('modal_token_input')
      .setTitle('Discord Token Megadása');

    const tokenInput = new TextInputBuilder()
      .setCustomId('input_user_token')
      .setLabel('Illeszd be a Discord User Tokenedet:')
      .setPlaceholder('Illeszd be a Discord felhasználói tokenedet...')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const actionRow = new ActionRowBuilder().addComponents(tokenInput);
    modal.addComponents(actionRow);
    return ix.showModal(modal);
  }

  if (id === 'btn_token_list') {
    const tokens = listTokens(uid);
    if (!tokens.length) {
      return ix.reply({ embeds: [warn('Nincs Fiók', `${E.key()} Még nincs elmentett fiókod. Használd a **📱 QR Belépés** vagy **🔑 Token Megadása** gombot.`)], flags: MessageFlags.Ephemeral });
    }
    const lines = tokens.map(t => `${E.key()} \`${t.label}\` — **${t.discord_username || '?'}**`);
    return ix.reply({ embeds: [ok('Elmentett Fiókjaid', lines.join('\n'))], flags: MessageFlags.Ephemeral });
  }

  if (id === 'btn_token_remove') {
    const removed = removeToken(uid, 'main');
    return ix.reply({
      embeds: [removed ? ok('Kijelentkezve', `${E.check()} A fiókod sikeresen törölve lett az adatbázisból.`) : warn('Nincs Fiók', 'Nem volt elmentett fiókod az adatbázisban.')],
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handlePanelModal(ix) {
  if (ix.customId === 'modal_token_input') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const token = ix.fields.getTextInputValue('input_user_token').trim().replace(/["']/g, '');
    const uid = ix.user.id;

    try {
      const api = new DiscordUserAPI(token);
      const user = await api.getCurrentUser();
      saveToken(uid, 'main', token, { id: user.id, username: user.global_name || user.username });

      let questCountText = '';
      try {
        const quests = await fetchParsed(token);
        const active = quests.filter(q => !q.completed).length;
        questCountText = `\n${E.radar()} **${active}** aktív küldetés azonnal elérhető.`;
      } catch {}

      return ix.editReply({
        embeds: [ok('Sikeres Bejelentkezés!', [
          `${E.check()} **${user.global_name || user.username}** fiók elmentve (\`main\`)!`,
          questCountText,
          '',
          `🚀 Most már elindíthatod a **⚡ Turbo Start** vagy **🚀 Minden Quest** gombbal!`,
        ].filter(Boolean).join('\n'))],
      });
    } catch (err) {
      return ix.editReply({
        embeds: [err('Érvénytelen Token', `${E.cross()} Nem sikerült a felhasználói adatokat lekérni a megadott tokenből: ${err.message}`)],
      });
    }
  }
}

export const handlers = {
  panel: async (ix) => {
    if (ix.user.id !== OWNER_ID) {
      return ix.reply({
        embeds: [err('Hozzáférés Megtagadva', `${E.cross()} A vezérlőpult kirakását kizárólag a bot tulajdonosa (<@${OWNER_ID}>) végezheti el.\n\n*A már kirakott panel gombjait viszont bármelyik tag használhatja a saját fiókjának vezérlésére!*`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    return ix.reply(buildPanelMessage());
  },
};
