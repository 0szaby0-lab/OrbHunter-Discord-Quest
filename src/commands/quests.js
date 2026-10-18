import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getDecryptedToken, getSettings, logQuest, listTokens, getActiveLabel } from '../database/sqlite.js';
import { QuestEngine, getRunState, abortRun } from '../engine/quest-engine.js';
import { parseAllQuests, filterRunnableQuests } from '../engine/quest-parser.js';
import { DiscordUserAPI } from '../engine/discord-api.js';
import { ok, warn, err, questListEmbed, statusEmbed, ui, bar, fmtSec, E } from '../utils/embeds.js';
import { taskIcon } from '../utils/emojis.js';
import { buildGlobalRadarResponse, enrollGlobalQuests } from '../engine/global-scanner.js';

export function getToken(uid, label = null) {
  const activeLabel = label || getActiveLabel(uid) || 'main';
  const token = getDecryptedToken(uid, activeLabel) || getDecryptedToken(uid, 'main') || getDecryptedToken(uid, 'default');
  if (token) return token;
  const all = listTokens(uid);
  if (all && all.length > 0) {
    return getDecryptedToken(uid, all[0].label);
  }
  const ownerId = process.env.OWNER_ID || '1095731086513930260';
  if (uid === ownerId && process.env.USER_TOKEN) {
    return process.env.USER_TOKEN;
  }
  return null;
}

export async function fetchParsed(token) {
  const api = new DiscordUserAPI(token);
  const raw = await api.fetchAllQuests();
  return parseAllQuests(raw);
}

export async function ctx(ix, label = null) {
  const activeLabel = label || getActiveLabel(ix.user.id) || 'main';
  const token = getToken(ix.user.id, activeLabel);
  if (!token) return { error: true, label: activeLabel };
  return { token, settings: getSettings(ix.user.id), userId: ix.user.id, label: activeLabel };
}

export async function runMode(ix, opts = {}) {
  const label = ix.options?.getString?.('label') || null;
  const c = await ctx(ix, label);
  if (c.error) return ix.editReply({ embeds: [warn('Nincs Fiók Csatlakoztatva', `${E.key()} Még nem csatlakoztattál fiókot! Kattints a zöld **🔑 Csatlakozás** gombra a tokened megadásához, vagy a **🌐 Webes Link** gombra!`)] });

  if (getRunState(c.userId)) {
    return ix.editReply({ embeds: [warn('Busy', `${E.clock()} Run active — \`/quests stop\``)] });
  }

  // 1. Fázis: Ha az auto_enroll aktív, először teszteli a nemzetközi proxykat és elfogadja a régiós orbokat
  let globalEnrolled = [];
  if (c.settings.auto_enroll) {
    try {
      await ix.editReply({
        embeds: [ui('Nemzetközi Pásztázás', `${E.radar()} Működő proxyk felderítése és régiós Orbok keresése (US, UK, DE, FR, BR, Helyi IP)…`, 0x5865f2)],
      });
      const enrollResult = await enrollGlobalQuests(c.token);
      globalEnrolled = enrollResult.accepted || [];
    } catch (e) {
      console.warn('[runMode] Proxy pásztázás figyelmeztetés:', e.message);
    }
  }

  // 2. Fázis: Visszatérés a Render saját közvetlen, stabil IP-címére a daráláshoz
  const quests = filterRunnableQuests(await fetchParsed(c.token));
  if (!quests.length) {
    return ix.editReply({
      embeds: [warn('Nincs Futtatható Küldetés', globalEnrolled.length
        ? `${E.check()} Sikeresen aktiválva **${globalEnrolled.length}** nemzetközi küldetés, de jelenleg mindegyik készre van hajtva.`
        : 'Jelenleg nincs aktív vagy elindítható küldetés ezen a fiókon.')],
    });
  }

  const engine = new QuestEngine(c.token, {
    turbo: opts.turbo ?? !!c.settings.turbo_mode,
    autoEnroll: false, // már aktiválva a proxykon át
    autoClaim: !!c.settings.auto_claim,
    mode: opts.sequential ? 'sequential' : 'parallel',
    onProgress: async (tasks) => {
      try { await ix.editReply({ embeds: [statusEmbed(tasks, `${E.bolt()} Darálás folyamatban (Render közvetlen stabil IP-n)…`)] }); } catch { /* */ }
    },
  });

  await ix.editReply({
    embeds: [ui('Darálás Elindítva', `${E.fire()} **${quests.length}** küldetés futtatása Render közvetlen stabil kapcsolatán`
      + `${globalEnrolled.length ? ` · (ebből **${globalEnrolled.length}** nemzetközileg aktiválva)` : ''}…`, 0x5865f2)],
  });

  const result = await engine.run(quests, c.userId);
  for (const q of result.completed) logQuest(c.userId, q.id, q.name, 'done', '');
  for (const f of result.failed) logQuest(c.userId, f.quest.id, f.quest.name, 'fail', f.reason);

  const lines = [
    result.message,
    result.accepted.length ? `\n${E.key()} Auto-accepted **${result.accepted.length}**` : '',
    result.completed.length ? `\n${E.check()} ${result.completed.map(q => q.name).join(', ')}` : '',
    result.failed.length ? `\n${E.cross()} ${result.failed.length} failed` : '',
    result.skipped.length
      ? `\n${E.warn()} Skipped: ${result.skipped.map(s => `${s.quest.name} (${s.reason})`).join(', ')}`
      : '',
    result.needsClaim.some(q => q.claimError === 'captcha')
      ? `\n\n${E.warn()} Discord requires a captcha to claim. Tap **Claim** on the quest in Discord to collect your orbs.`
      : '',
  ].join('');

  return ix.editReply({ embeds: [ok('Complete', lines)] });
}

export const commands = [
  new SlashCommandBuilder()
    .setName('quests')
    .setDescription('Quest automation')
    .addSubcommand(s => s.setName('list').setDescription('Show quests')
      .addStringOption(o => o.setName('label').setDescription('Token label')))
    .addSubcommand(s => s.setName('radar').setDescription('Országos nemzetközi Orb & Quest radar (proxykkal)')
      .addBooleanOption(o => o.setName('refresh').setDescription('Proxyk azonnali újratesztelése')))
    .addSubcommand(s => s.setName('info').setDescription('Quest details')
      .addStringOption(o => o.setName('name').setDescription('Quest name').setRequired(true))
      .addStringOption(o => o.setName('label').setDescription('Token label')))
    .addSubcommand(s => s.setName('accept').setDescription('Auto-accept every available quest')
      .addStringOption(o => o.setName('label').setDescription('Token label')))
    .addSubcommand(s => s.setName('all').setDescription('Complete all at once')
      .addStringOption(o => o.setName('label').setDescription('Token label')))
    .addSubcommand(s => s.setName('run').setDescription('Complete one by one')
      .addStringOption(o => o.setName('label').setDescription('Token label')))
    .addSubcommand(s => s.setName('turbo').setDescription('Fast complete')
      .addStringOption(o => o.setName('label').setDescription('Token label')))
    .addSubcommand(s => s.setName('stop').setDescription('Stop run'))
    .addSubcommand(s => s.setName('status').setDescription('Check progress')),

  new SlashCommandBuilder()
    .setName('radar')
    .setDescription('Nemzetközi Orb & Quest Radar több országon keresztül (proxykkal)')
    .addBooleanOption(o => o.setName('refresh').setDescription('Proxyk azonnali újratesztelése')),
];

export const handlers = {
  radar: async (ix) => {
    await ix.deferReply({ flags: MessageFlags.Ephemeral });
    const refresh = ix.options?.getBoolean?.('refresh') || false;
    const res = await buildGlobalRadarResponse(ix.user.id, refresh);
    return ix.editReply(res);
  },

  quests: async (ix) => {
    const sub = ix.options.getSubcommand();
    const label = ix.options.getString('label') || 'main';

    if (sub === 'radar') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const refresh = ix.options?.getBoolean?.('refresh') || false;
      const res = await buildGlobalRadarResponse(ix.user.id, refresh);
      return ix.editReply(res);
    }

    if (sub === 'list') {
      await ix.deferReply();
      const c = await ctx(ix, label);
      if (c.error) return ix.editReply({ embeds: [warn('Nincs Fiók', `${E.key()} Még nem csatlakoztattál fiókot. Használd a \`/login\` parancsot vagy a \`login.bat\`-ot!`)] });

      const api = new DiscordUserAPI(c.token);
      const [quests, diag] = await Promise.all([
        fetchParsed(c.token),
        api.getDiagnostics(),
      ]);
      const active = quests.filter(q => !q.completed && !q.isExpired);
      return ix.editReply({ embeds: [questListEmbed(active, diag)] });
    }

    if (sub === 'info') {
      await ix.deferReply({ flags: MessageFlags.Ephemeral });
      const c = await ctx(ix, label);
      if (c.error) return ix.editReply({ embeds: [warn('Nincs Fiók', `${E.key()} Még nem csatlakoztattál fiókot. Használd a \`/login\` parancsot vagy a \`login.bat\`-ot!`)] });

      const search = ix.options.getString('name').toLowerCase();
      const q = (await fetchParsed(c.token)).find(x => x.name.toLowerCase().includes(search));
      if (!q) return ix.editReply({ embeds: [warn('Not Found', `"${search}"`)] });

      const pct = q.taskInfo.target ? Math.round((q.progress / q.taskInfo.target) * 100) : 0;
      return ix.editReply({
        embeds: [ui(q.name, [
          `${taskIcon(q.taskInfo.type)} **${q.taskInfo.type}**`,
          `${E.clock()} ${fmtSec(q.progress)} / ${fmtSec(q.taskInfo.target)}`,
          `${bar(pct)} \`${pct}%\``,
          `${E.orb()} ${q.orbReward || 0} orbs`,
          q.enrolled ? `${E.check()} Enrolled` : `${E.spark()} Not enrolled — will auto-enroll on run`,
        ].join('\n'))],
      });
    }

    if (sub === 'accept') {
      await ix.deferReply();
      const c = await ctx(ix, label);
      if (c.error) return ix.editReply({ embeds: [warn('Nincs Fiók', `${E.key()} Még nem csatlakoztattál fiókot. Használd a \`/login\` parancsot vagy a \`login.bat\`-ot!`)] });

      const engine = new QuestEngine(c.token);
      const quests = filterRunnableQuests(await engine.fetchQuests());
      const pending = quests.filter(q => !q.enrolled);

      if (!pending.length) {
        return ix.editReply({ embeds: [ui('All Accepted', `${E.check()} All **${quests.length}** active quest(s) are already accepted.`)] });
      }

      await ix.editReply({ embeds: [ui('Accepting', `${E.key()} Joining **${pending.length}** quest(s)…`)] });
      const { accepted, failed } = await engine.enrollAll(quests);

      return ix.editReply({
        embeds: [ok('Accepted', [
          `${E.check()} Joined **${accepted.length}/${pending.length}** quest(s)`,
          accepted.length ? `\n${accepted.map(q => `• ${q.name}`).join('\n')}` : '',
          failed.length ? `\n\n${E.cross()} ${failed.length} could not be joined` : '',
        ].join(''))],
      });
    }

    if (sub === 'all') { await ix.deferReply(); return runMode(ix, {}); }
    if (sub === 'run') { await ix.deferReply(); return runMode(ix, { sequential: true }); }
    if (sub === 'turbo') { await ix.deferReply(); return runMode(ix, { turbo: true }); }

    if (sub === 'stop') {
      const stopped = abortRun(ix.user.id);
      return ix.reply({
        embeds: [stopped ? warn('Stopped', `${E.cross()} Aborted.`) : ui('Idle', 'Nothing running.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'status') {
      const state = getRunState(ix.user.id);
      if (!state) return ix.reply({ embeds: [ui('Idle', `${E.clock()} No active run.`)], flags: MessageFlags.Ephemeral });
      return ix.reply({ embeds: [statusEmbed(state.engine?.tasks, `${E.bolt()} In progress…`)], flags: MessageFlags.Ephemeral });
    }
  },
};
