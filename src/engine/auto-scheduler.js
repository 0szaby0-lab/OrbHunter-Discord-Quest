import { listAllAccounts, getDecryptedToken, getSettings, logQuest } from '../database/sqlite.js';
import { enrollGlobalQuests } from './global-scanner.js';
import { DiscordUserAPI } from './discord-api.js';
import { parseAllQuests, filterRunnableQuests } from './quest-parser.js';
import { QuestEngine, getRunState } from './quest-engine.js';

let schedulerInterval = null;
let isRunningCycle = false;

/**
 * Végrehajt egy teljes nemzetközi proxy keresést és küldetés-darálást minden fiókon:
 * 1. Proxykon át keres és fogad el minden elérhető nemzetközi/régiós orbot
 * 2. Visszavált a Render stabil, állandó IP címére
 * 3. Render saját IP-jén darálja le a küldetéseket hálózati megszakadások nélkül
 */
export async function runScheduledCycle() {
  if (isRunningCycle) {
    console.log('[AutoScheduler] Egy korábbi ciklus még fut, várakozás...');
    return;
  }
  isRunningCycle = true;

  try {
    const accounts = listAllAccounts();
    if (!accounts.length) {
      console.log('[AutoScheduler] Nincs regisztrált fiók az adatbázisban.');
      return;
    }

    console.log(`[AutoScheduler] 🌍 Nemzetközi proxy-ellenőrzés indítása ${accounts.length} fiókon...`);

    for (const acc of accounts) {
      const token = getDecryptedToken(acc.discordUserId, acc.label);
      if (!token) continue;

      const s = getSettings(acc.discordUserId);
      const name = acc.username || acc.label;

      console.log(`[AutoScheduler] 🔍 [${name}] Nemzetközi Orbok és küldetések felderítése proxykon át...`);
      let enrollResult = { accepted: [], failed: [], rateLimited: false, retryAfterSec: 0 };
      try {
        enrollResult = await enrollGlobalQuests(token);
        if (enrollResult.accepted.length) {
          console.log(`[AutoScheduler] ✅ [${name}] Sikeresen aktiválva ${enrollResult.accepted.length} nemzetközi küldetés!`);
        }
        if (enrollResult.rateLimited && enrollResult.retryAfterSec > 0) {
          const waitMins = Math.ceil(enrollResult.retryAfterSec / 60);
          console.log(`[AutoScheduler] ⏳ [${name}] Discord Rate Limit aktív (${waitMins} perc). Automata újraaktiválás beütemezve a lejáratkor!`);
          setTimeout(() => {
            console.log(`[AutoScheduler] ⏰ [${name}] Rate limit lejárt, hátralévő küldetések automatikus felvétele indul...`);
            runScheduledCycle().catch(err => console.error('[AutoScheduler] Újrapróbálkozási ciklus hiba:', err.message));
          }, (enrollResult.retryAfterSec + 20) * 1000);
        }
      } catch (e) {
        console.warn(`[AutoScheduler] ⚠️ [${name}] Proxy pásztázás figyelmeztetés:`, e.message);
      }

      // Ha nincs futó folyamat, átváltunk a Render stabil, állandó IP-címére és ledaráljuk
      if (!getRunState(acc.discordUserId) && s.auto_enroll) {
        try {
          const directApi = new DiscordUserAPI(token); // Közvetlen Render IP, nincs proxy
          const raw = await directApi.fetchAllQuests();
          const quests = filterRunnableQuests(parseAllQuests(raw));

          if (quests.length) {
            console.log(`[AutoScheduler] 🚀 [${name}] ${quests.length} küldetés darálása elindítva a Render stabil IP-jén...`);
            const engine = new QuestEngine(token, {
              turbo: !!s.turbo_mode,
              autoEnroll: false, // már aktiválva a proxykon át
              autoClaim: !!s.auto_claim,
              mode: 'parallel',
            });

            const result = await engine.run(quests, acc.discordUserId);
            for (const q of result.completed) logQuest(acc.discordUserId, q.id, q.name, 'done', '');
            for (const f of result.failed) logQuest(acc.discordUserId, f.quest.id, f.quest.name, 'fail', f.reason);
            console.log(`[AutoScheduler] ✨ [${name}] Kész: ${result.completed.length} befejezve a Render közvetlen kapcsolatán!`);
          }
        } catch (err) {
          console.warn(`[AutoScheduler] ⚠️ [${name}] Render direkt futtatás hiba:`, err.message);
        }
      }
    }
  } catch (err) {
    console.error('[AutoScheduler] Ciklus hiba:', err.message);
  } finally {
    isRunningCycle = false;
  }
}

/**
 * Elindítja a periodikus háttér-ütemezőt
 */
export function startAutoScheduler(intervalMs = 6 * 60 * 60 * 1000) { // alapértelmezett: 6 óránként
  if (schedulerInterval) return;

  console.log('⏰ [AutoScheduler] Nemzetközi Proxy & Quest ütemező aktív (Periódus: 6 óra)');

  // Első pásztázás az indulás után 45 másodperccel
  setTimeout(() => {
    runScheduledCycle().catch(e => console.error('[AutoScheduler] Első ciklus hiba:', e.message));
  }, 45 * 1000);

  // Folyamatos ismétlés 6 óránként
  schedulerInterval = setInterval(() => {
    runScheduledCycle().catch(e => console.error('[AutoScheduler] Ismétlődő ciklus hiba:', e.message));
  }, intervalMs);
}
