import {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} from 'discord.js';
import { ok, warn, err, ui, E, questListEmbed, statusEmbed } from '../utils/embeds.js';
import { QuestEngine, getRunState, abortRun } from '../engine/quest-engine.js';
import { DiscordUserAPI } from '../engine/discord-api.js';
import {
  getSettings,
  saveSettings,
  getDecryptedToken,
  listTokens,
  removeToken,
  saveToken,
  getActiveLabel,
  setActiveLabel,
} from '../database/sqlite.js';
import { filterRunnableQuests } from '../engine/quest-parser.js';
import { runMode, ctx, fetchParsed, getToken } from './quests.js';
import { handleQrLogin } from './token.js';
import { maskToken } from '../utils/crypto.js';

const OWNER_ID = process.env.OWNER_ID || '1095731086513930260';

/**
 * 1. FŐ PUBLIKUS PANEL
 * Ez jelenik meg a szerver csatornájában a /panel parancsra.
 * Letisztult, nyilvános indítófelület minden tagnak.
 */
export function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${E.spider()}  ORBHUNTER — KÖZPONTI VEZÉRLŐPULT`)
    .setDescription([
      '**Üdvözöl az OrbHunter küldetésvezérlőben!**',
      '',
      'Ez a bot teljes mértékben automatizálja a Discord küldetéseket (játékidő és streamelés szimuláció 100%-os befejezésig).',
      '',
      '🔒 **Biztonságos & Privát Vezérlés:**',
      'Minden fiókkezelés és küldetésindítás **privát felületen** zajlik. Senki más nem látja a mentett profiljaidat és küldetéseidet!',
      '',
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
    ].join('\n'))
    .addFields(
      {
        name: '🚀  GYORS HASZNÁLATI ÚTMUTATÓ',
        value: [
          '>>> 1️⃣ **Fiók Hozzáadása:** Kattints a **🔑 Fiók Csatlakoztatása** gombra, és add meg a tokenedet (több fiókot is hozzáadhatsz külön elnevezéssel!).',
          '2️⃣ **Saját Pult:** Nyisd meg a **🚀 Saját Vezérlőpult**-ot, ahol privátban láthatod a profiljaidat és a küldetéseidet.',
          '3️⃣ **Darálás Indítása:** Kattints a **⚡ Turbo Start** gombra a villámgyors befejezéshez!',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'OrbHunter • Teljes Automatizálás • Nyisd meg a saját pultodat alább' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_open_private_panel')
      .setLabel('Saját Vezérlőpult')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_manual_token')
      .setLabel('Fiók Hozzáadása')
      .setEmoji('🔑')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_login')
      .setLabel('Webes Link')
      .setEmoji('🌐')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_panel_help')
      .setLabel('Súgó & Info')
      .setEmoji('ℹ️')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * 2. PRIVÁT SZEMÉLYES VEZÉRLŐPULT
 * Kizárólag a kattintó felhasználónak jelenik meg (Ephemeral), szépen elrendezve.
 * Támogatja a több fiók kezelését, legördülő fiókváltást és egyedi kijelentkezést.
 */
export async function buildPrivatePanel(uid) {
  const tokens = listTokens(uid);
  const s = getSettings(uid);

  // Ha még nincs fiók csatlakoztatva:
  if (!tokens || tokens.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xfaa61a)
      .setTitle(`${E.spider()}  ORBHUNTER — SZEMÉLYES VEZÉRLŐPULT`)
      .setDescription([
        '### ⚠️ Nincs csatlakoztatott fiókod',
        '',
        'Még nem kapcsoltál össze Discord fiókot a rendszerrel.',
        'Kattints az alábbi **🔑 Fiók Hozzáadása** gombra, vagy használd a **🌐 Webes Linket** a csatlakozáshoz!',
        '',
        '💡 *Több fiókot is hozzáadhatsz egyedi elnevezésekkel (pl. `main`, `másodlagos`, `alt`, `farm`)!*',
      ].join('\n'))
      .setFooter({ text: 'OrbHunter • Privát Vezérlőpult' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('btn_manual_token')
        .setLabel('Fiók Hozzáadása')
        .setEmoji('🔑')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('btn_login')
        .setLabel('Webes Link')
        .setEmoji('🌐')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('btn_private_refresh')
        .setLabel('Frissítés')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
    );

    return { embeds: [embed], components: [row] };
  }

  // Van legalább egy csatlakoztatott fiók
  const activeLabel = getActiveLabel(uid);
  let activeTokenMeta = tokens.find(t => t.label === activeLabel) || tokens[0];
  const currentLabel = activeTokenMeta.label;

  let userTitle = activeTokenMeta.discord_username || 'Ismeretlen profil';
  let questSummary = 'Küldetések lekérése…';
  const token = getDecryptedToken(uid, currentLabel);

  if (token) {
    try {
      const quests = await fetchParsed(token);
      const active = quests.filter(q => !q.completed).length;
      const completed = quests.filter(q => q.completed).length;
      questSummary = `**${active}** aktív folyamatban • **${completed}** már kész`;
    } catch {
      questSummary = '⚠️ A megadott token érvénytelen vagy lejárt';
    }
  }

  const runState = getRunState(uid);
  const isRunning = !!runState;
  const on = v => v ? '🟢 BE' : '🔴 KI';

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${E.spider()}  ORBHUNTER — SZEMÉLYES VEZÉRLŐPULT`)
    .setDescription([
      `👤 **Aktív Profil:** **${userTitle}** (Címke: \`${currentLabel}\`)`,
      `📊 **Küldetés állapot:** ${questSummary}`,
      `⚙️ **Beállítások:** Turbo mód: **${on(s.turbo_mode)}** • Auto-Enroll: **${on(s.auto_enroll)}**`,
      `📡 **Futási állapot:** ${isRunning ? '⚡ **FOLYAMATBAN VAN**' : '💤 **Nyugvó (Inaktív)**'}`,
      '',
      `📑 **Összesen ${tokens.length} fiókod van összekapcsolva.**`,
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
    ].join('\n'))
    .setFooter({ text: 'OrbHunter • Személyes Vezérlőpult • Csak te látod' })
    .setTimestamp();

  const components = [];

  // Ha több fiókja van: Legördülő fiókválasztó menü (Select Menu)
  if (tokens.length > 1) {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('select_active_account')
      .setPlaceholder(`Válts aktív fiókot (Jelenlegi: ${currentLabel})`)
      .addOptions(
        tokens.map(t =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${t.discord_username || t.label} [${t.label}]`)
            .setValue(t.label)
            .setDescription(`Fiók: ${t.discord_username || '?'} • Címke: ${t.label}`)
            .setDefault(t.label === currentLabel)
            .setEmoji('👤')
        )
      );

    components.push(new ActionRowBuilder().addComponents(selectMenu));
  }

  // Sor 1: Küldetés Futtatás az aktív fiókon
  const rowRun = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_turbo')
      .setLabel('Turbo Start')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Success)
      .setDisabled(isRunning),
    new ButtonBuilder()
      .setCustomId('btn_all')
      .setLabel('Minden Quest')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(isRunning),
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
      .setCustomId('btn_stop')
      .setLabel('Leállítás')
      .setEmoji('🛑')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!isRunning),
  );
  components.push(rowRun);

  // Sor 2: Fiókkezelés és Beállítások
  const rowAccount = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_manual_token')
      .setLabel('Új Fiók (+)')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('btn_remove_active_account')
      .setLabel(`Kijelentkezés (${currentLabel})`)
      .setEmoji('🗑️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId('btn_toggle_turbo')
      .setLabel('Turbo Ki/Be')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_toggle_enroll')
      .setLabel('Auto-Enroll')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_private_refresh')
      .setLabel('Frissítés')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );
  components.push(rowAccount);

  return { embeds: [embed], components };
}

export const commands = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Megnyitja a letisztult, modern interaktív grafikus vezérlőpultot'),
];

export async function handlePanelButton(ix) {
  const id = ix.customId;
  const uid = ix.user.id;

  // 1. Privát Pult Megnyitása a publikus panelről
  if (id === 'btn_open_private_panel') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const panel = await buildPrivatePanel(uid);
    return ix.editReply(panel);
  }

  // 2. Fiókválasztás a legördülő menüből (Select Menu)
  if (id === 'select_active_account') {
    const selectedLabel = ix.values?.[0];
    if (selectedLabel) {
      setActiveLabel(uid, selectedLabel);
    }
    const panel = await buildPrivatePanel(uid);
    return ix.update(panel);
  }

  // 3. Privát Pult Frissítése
  if (id === 'btn_private_refresh') {
    const panel = await buildPrivatePanel(uid);
    return ix.update(panel);
  }

  // 4. Kijelentkezés kizárólag az épp aktív fiókból
  if (id === 'btn_remove_active_account') {
    const currentLabel = getActiveLabel(uid);
    removeToken(uid, currentLabel);

    const remaining = listTokens(uid);
    if (remaining.length > 0) {
      setActiveLabel(uid, remaining[0].label);
    }

    const panel = await buildPrivatePanel(uid);
    return ix.update(panel);
  }

  // 5. Kapcsolók (Turbo Ki/Be, Auto-Enroll Ki/Be)
  if (id === 'btn_toggle_turbo') {
    const s = getSettings(uid);
    const next = s.turbo_mode ? 0 : 1;
    saveSettings(uid, { turbo_mode: next });
    const panel = await buildPrivatePanel(uid);
    return ix.update(panel);
  }

  if (id === 'btn_toggle_enroll') {
    const s = getSettings(uid);
    const next = s.auto_enroll ? 0 : 1;
    saveSettings(uid, { auto_enroll: next });
    const panel = await buildPrivatePanel(uid);
    return ix.update(panel);
  }

  // 6. Futtatás gombok
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

  if (id === 'btn_stop' || id === 'panel_stop') {
    const stopped = abortRun(uid);
    return ix.reply({
      embeds: [stopped ? warn('Megállítva', `${E.cross()} A küldetésfutás sikeresen megszakítva a fiókodon.`) : ui('Nincs Futás', `${E.clock()} Nem futott aktív folyamat a fiókodon.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // 7. Quest Radar az aktív fiókon
  if (id === 'btn_list' || id === 'panel_list') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const c = await ctx(ix);
    if (c.error) {
      return ix.editReply({ embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Még nem csatlakoztattál fiókot! Kattints a zöld **🔑 Fiók Hozzáadása** gombra.`)] });
    }
    try {
      const quests = await fetchParsed(c.token);
      return ix.editReply({ embeds: [questListEmbed(quests)] });
    } catch (e) {
      return ix.editReply({ embeds: [err('Hiba', `Nem sikerült lekérni a küldetéseket: ${e.message}`)] });
    }
  }

  // 8. Összes Elfogadása az aktív fiókon
  if (id === 'btn_accept') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const c = await ctx(ix);
    if (c.error) {
      return ix.editReply({ embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Még nem csatlakoztattál fiókot! Kattints a zöld **🔑 Fiók Hozzáadása** gombra.`)] });
    }
    try {
      const engine = new QuestEngine(c.token);
      const quests = filterRunnableQuests(await engine.fetchQuests());
      const pending = quests.filter(q => !q.enrolled);

      if (!pending.length) {
        return ix.editReply({ embeds: [ui('Minden Elfogadva', `${E.check()} Mind a **${quests.length}** elérhető küldetés már el van fogadva ezen a fiókon (\`${c.label}\`).`)] });
      }

      await ix.editReply({ embeds: [ui('Csatlakozás Folyamatban', `${E.key()} Belépés **${pending.length}** küldetésbe…`)] });
      const { accepted, failed } = await engine.enrollAll(quests);

      return ix.editReply({
        embeds: [ok('Küldetések Elfogadva', [
          `${E.check()} Sikeresen elfogadva: **${accepted.length}/${pending.length}** küldetés a(z) \`${c.label}\` fiókon!`,
          accepted.length ? `\n${accepted.map(q => `• ${q.name}`).join('\n')}` : '',
          failed.length ? `\n\n${E.cross()} ${failed.length} küldetéshez nem sikerült csatlakozni.` : '',
        ].join(''))],
      });
    } catch (e) {
      return ix.editReply({ embeds: [err('Hiba', `Nem sikerült a küldetések elfogadása: ${e.message}`)] });
    }
  }

  // 9. Fiók Hozzáadása Modal megnyitása
  if (id === 'btn_manual_token') {
    const modal = new ModalBuilder()
      .setCustomId('modal_token_input')
      .setTitle('OrbHunter — Fiók Hozzáadása');

    const tokenInput = new TextInputBuilder()
      .setCustomId('input_user_token')
      .setLabel('Discord fiók-kulcsod (Token):')
      .setPlaceholder('Illeszd be a Discord tokenedet ide...')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    const labelInput = new TextInputBuilder()
      .setCustomId('input_account_label')
      .setLabel('Fiók Címke / Elnevezés (pl. main, alt):')
      .setPlaceholder('pl. main, masodlagos, alt (alapértelmezett: main)')
      .setStyle(TextInputStyle.Short)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(tokenInput),
      new ActionRowBuilder().addComponents(labelInput),
    );
    return ix.showModal(modal);
  }

  // 10. Webes Link és Súgó
  if (id === 'btn_login' || id === 'panel_login') {
    return handleQrLogin(ix, getActiveLabel(uid) || 'main');
  }

  if (id === 'btn_panel_help') {
    return ix.reply({
      embeds: [ui('Hogyan Működik az OrbHunter?', [
        '🎮 **1. Küldetés Darálás:**',
        'A bot szimulálja a szükséges játékidőt vagy streamelést a háttérben, emberi beavatkozás nélkül.',
        '',
        '⚡ **2. Turbo vs Normál Mód:**',
        '• **Turbo Start:** Párhuzamosan darálja le a küldetéseket rekordidő alatt.',
        '• **Minden Quest:** Normál tempójú, stabil végrehajtás.',
        '',
        '👥 **3. Több Fiók Kezelése:**',
        'Tetszőleges számú fiókot felvehetsz (pl. `main`, `másodlagos`, `alt1`). A saját privát vezérlőpultodon a legördülő menüvel bármikor válthatsz köztük!',
        '',
        '🎁 **4. Jutalmak Átvétele:**',
        'Amikor a bot végez (100% zöld pipa), a Discordban a **Discover ➔ Quests** menüpontban egy kattintással átveheted az Orbokat vagy Nitrót!',
      ].join('\n'))],
      flags: MessageFlags.Ephemeral,
    });
  }
}

/**
 * Modal beküldés feldolgozása (Új fiók mentése egyedi elnevezéssel)
 */
export async function handlePanelModal(ix) {
  if (ix.customId === 'modal_token_input') {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const token = ix.fields.getTextInputValue('input_user_token').trim().replace(/["']/g, '');
    let label = ix.fields.getTextInputValue('input_account_label')?.trim() || '';
    const uid = ix.user.id;

    const existingTokens = listTokens(uid);
    if (!label) {
      label = existingTokens.length === 0 ? 'main' : `alt${existingTokens.length + 1}`;
    }

    // Tisztítsuk a címkét biztonságos karakterekre
    const cleanLabel = label.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20) || 'main';

    try {
      const api = new DiscordUserAPI(token);
      const user = await api.getCurrentUser();
      saveToken(uid, cleanLabel, token, { id: user.id, username: user.global_name || user.username });
      setActiveLabel(uid, cleanLabel);

      let questCountText = '';
      try {
        const quests = await fetchParsed(token);
        const active = quests.filter(q => !q.completed).length;
        questCountText = `\n${E.radar()} **${active}** aktív küldetés azonnal elérhető.`;
      } catch {}

      return ix.editReply({
        embeds: [ok('Fiók Sikeresen Hozzáadva!', [
          `${E.check()} **${user.global_name || user.username}** fiók elmentve (\`${cleanLabel}\`)!`,
          questCountText,
          '',
          `🚀 Most már elindíthatod a **Saját Vezérlőpult**-on a **⚡ Turbo Start** vagy **🚀 Minden Quest** gombbal!`,
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
