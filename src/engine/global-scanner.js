import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { DiscordUserAPI } from './discord-api.js';
import { parseAllQuests } from './quest-parser.js';
import { proxyManager } from './proxy-manager.js';
import { getToken } from '../commands/quests.js';
import { E, ui, ok, warn, err } from '../utils/embeds.js';

/**
 * Nemzetközi Multi-Country Quest és Orb Scanner
 * Végigpásztázza a Discord küldetéseket az aktív, működő proxykon keresztül
 * különböző országokból (US, UK, DE, FR, BR, Globális), felderítve a régió-exkluzív orbot és küldetést.
 */
export async function scanGlobalQuests(token, options = {}) {
  const forceRefresh = options.forceRefresh || false;
  const api = new DiscordUserAPI(token);

  // 1. Megkeressük a működő ország-proxykat (autonóm, gyors teszteléssel)
  const activeCountries = await proxyManager.findWorkingCountryProxies(forceRefresh);

  // 2. Lekérjük a küldetéseket az összes működő országból párhuzamosan
  const fetchPromises = activeCountries.map(async (c) => {
    try {
      const raw = await api.fetchAllQuests(c.proxyUrl);
      const parsed = parseAllQuests(raw);
      return { country: c, quests: parsed };
    } catch {
      return { country: c, quests: [] };
    }
  });

  const countryResults = await Promise.all(fetchPromises);

  // 3. Egyesítés és régió-hozzárendelés quest ID alapján
  const questMap = new Map();

  for (const { country, quests } of countryResults) {
    for (const q of quests) {
      if (!questMap.has(q.id)) {
        questMap.set(q.id, {
          ...q,
          regions: [country],
          bestProxyUrl: country.proxyUrl, // ezt a proxyt használjuk majd az elfogadáshoz
        });
      } else {
        const existing = questMap.get(q.id);
        if (!existing.regions.some(r => r.code === country.code)) {
          existing.regions.push(country);
        }
        if (q.enrolled && !existing.enrolled) existing.enrolled = true;
        if (q.completed && !existing.completed) existing.completed = true;
        if (q.progress > existing.progress) existing.progress = q.progress;
      }
    }
  }

  const allQuests = Array.from(questMap.values());
  let totalOrbs = 0;
  let exclusiveCount = 0;

  for (const q of allQuests) {
    if (!q.completed && q.orbReward) {
      totalOrbs += q.orbReward;
    }
    // Ha nem minden országban érhető el, vagy nincs benne a DIRECT / Helyi kapcsolatban:
    const hasDirect = q.regions.some(r => r.code === 'DIRECT');
    q.isExclusive = !hasDirect || q.regions.length < activeCountries.length;
    if (q.isExclusive) exclusiveCount++;
  }

  // Rendezés: Először a legtöbb Orbot adók, majd az exkluzívak
  allQuests.sort((a, b) => {
    if ((b.orbReward || 0) !== (a.orbReward || 0)) {
      return (b.orbReward || 0) - (a.orbReward || 0);
    }
    if (a.isExclusive && !b.isExclusive) return -1;
    if (!a.isExclusive && b.isExclusive) return 1;
    return 0;
  });

  return {
    scannedCountries: activeCountries,
    quests: allQuests,
    totalOrbs,
    exclusiveCount,
  };
}

/**
 * Automatikusan elfogadja az összes elérhető nemzetközi küldetést
 * a saját országának proxyján keresztül, ha régióhoz kötött.
 */
export async function enrollGlobalQuests(token, quests = null) {
  const api = new DiscordUserAPI(token);
  let targetQuests = quests;

  if (!targetQuests) {
    const scan = await scanGlobalQuests(token);
    targetQuests = scan.quests;
  }

  const pending = targetQuests.filter(q => !q.enrolled && !q.completed && !q.isExpired);
  const accepted = [];
  const failed = [];

  for (const q of pending) {
    try {
      // Használjuk a questhez tartozó országos proxyt az elfogadáshoz
      await api.enrollQuest(q.id, q.trafficSealed, q.bestProxyUrl);
      q.enrolled = true;
      accepted.push(q);
    } catch (e) {
      // Ha a proxyn át nem ment, megpróbáljuk közvetlenül is
      try {
        await api.enrollQuest(q.id, q.trafficSealed, null);
        q.enrolled = true;
        accepted.push(q);
      } catch (e2) {
        failed.push({ quest: q, error: e2.message || e.message });
      }
    }
  }

  return { accepted, failed, totalPending: pending.length };
}

/**
 * Discord grafikus felület: Nemzetközi Radar nézet építő
 */
export async function buildGlobalRadarResponse(uid, forceRefresh = false) {
  const token = getToken(uid);
  if (!token) {
    return {
      embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Még nem csatlakoztattál fiókot a rendszerhez. Kattints a **🔑 Fiók Hozzáadása** gombra!`)]
    };
  }

  const scan = await scanGlobalQuests(token, { forceRefresh });
  const { scannedCountries, quests, totalOrbs, exclusiveCount } = scan;

  const countryLines = scannedCountries.map(c => {
    const ms = c.latency > 0 ? ` (\`${c.latency}ms\`)` : '';
    return `${c.flag} **${c.name}**${ms}`;
  }).join(' • ');

  const pendingQuests = quests.filter(q => !q.enrolled && !q.completed);
  const activeQuests = quests.filter(q => q.enrolled && !q.completed);
  const completedQuests = quests.filter(q => q.completed);

  const questListLines = [];
  if (!quests.length) {
    questListLines.push('⚠️ *Nem található aktív küldetés az ellenőrzött országokban.*');
  } else {
    for (const q of quests.slice(0, 15)) {
      const orbText = q.orbReward ? ` 💎 **+${q.orbReward} ORB**` : '';
      const flagText = q.regions.map(r => r.flag || r.code).join(' ');
      const exclBadge = q.isExclusive ? ' 🌟 `[Régió-Exkluzív]`' : ' 🌍 `[Globális]`';

      let stateBadge = '⚪ Nem elfogadott';
      if (q.completed) stateBadge = '✅ Befejezve';
      else if (q.enrolled) stateBadge = '🟢 Folyamatban';

      questListLines.push([
        `**${q.name}**${orbText}${exclBadge}`,
        `└ Állapot: **${stateBadge}** • Elérhető zónák: ${flagText}`,
      ].join('\n'));
    }

    if (quests.length > 15) {
      questListLines.push(`*… és további ${quests.length - 15} küldetés.*`);
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${E.spider()}  ORBHUNTER — NEMZETKÖZI ORB & QUEST RADAR`)
    .setDescription([
      '**Autonóm proxy pásztázás befejezve a működő nemzetközi csomópontokon át:**',
      `🛰️ **Sikeresen vizsgált országok (${scannedCountries.length} db):**\n${countryLines}`,
      '',
      `💎 **Összes megszerezhető Orb:** **${totalOrbs} Orb**`,
      `🎯 **Talált küldetések:** **${quests.length} db** (${pendingQuests.length} új felvehető, ${activeQuests.length} folyamatban, ${completedQuests.length} kész, ${exclusiveCount} régiós)`,
      '',
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
      questListLines.join('\n\n'),
      '▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬',
      '',
      pendingQuests.length > 0
        ? `💡 *Kattints az alábbi **✅ Mind Elfogadása** gombra, és a bot az adott ország proxyján át automatikusan aktiválja az összes küldetést!*`
        : `✨ *Minden elérhető nemzetközi küldetés már el van fogadva a profilodon! Kattints a **⚡ Turbo Start** gombra a daráláshoz.*`,
    ].join('\n'))
    .setFooter({ text: 'OrbHunter • Nemzetközi Radar • Ország-specifikus Orb felderítő' })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('btn_enroll_all_global')
      .setLabel(`Mind Elfogadása (${pendingQuests.length})`)
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success)
      .setDisabled(pendingQuests.length === 0),
    new ButtonBuilder()
      .setCustomId('btn_turbo')
      .setLabel('Turbo Start')
      .setEmoji('⚡')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('btn_open_private_panel')
      .setLabel('Vezérlőpult')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('btn_global_radar_refresh')
      .setLabel('Újraszkennelés')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}
