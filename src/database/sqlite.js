import 'dotenv/config';
import { MongoClient } from 'mongodb';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { encrypt, decrypt } from '../utils/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../../data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

// Local SQLite fallback/backup
let sqliteDb = null;
try {
  sqliteDb = new Database(join(dataDir, 'orbweaver.db'));
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('synchronous = NORMAL');
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS user_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'default',
      token_enc TEXT NOT NULL,
      discord_account_id TEXT,
      discord_username TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(discord_user_id, label)
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      discord_user_id TEXT PRIMARY KEY,
      turbo_mode INTEGER DEFAULT 0,
      auto_claim INTEGER DEFAULT 0,
      auto_enroll INTEGER DEFAULT 1,
      default_mode TEXT DEFAULT 'blaze',
      active_label TEXT DEFAULT 'main'
    );
    CREATE TABLE IF NOT EXISTS quest_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      quest_id TEXT NOT NULL,
      quest_name TEXT,
      status TEXT,
      message TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  try {
    sqliteDb.exec("ALTER TABLE user_settings ADD COLUMN active_label TEXT DEFAULT 'main'");
  } catch {}
} catch (e) {
  console.warn('⚠️ SQLite local backup init note:', e.message);
}

// In-Memory Real-Time Caches (Guarantees 0ms synchronous reads across the bot)
const tokensCache = new Map(); // key: `${uid}:${label}`
const settingsCache = new Map(); // key: `${uid}`

// MongoDB Atlas Client & Collections
let mongoClient = null;
let mongoDb = null;
let tokensCol = null;
let settingsCol = null;
let logsCol = null;
let isMongoReady = false;

const MONGODB_URI = process.env.MONGODB_URI;

let connectingPromise = null;

/**
 * Initialize MongoDB Atlas and warm up the in-memory cache
 */
export async function initDatabase() {
  if (isMongoReady) return;
  if (!MONGODB_URI) {
    console.warn('⚠️ MONGODB_URI nincs beállítva a környezeti változókban (.env). Felhős MongoDB kapcsolat kihagyva.');
    return;
  }
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    try {
    console.log('🍃 Csatlakozás a MongoDB Atlas felhőhöz…');
    mongoClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
    });
    await mongoClient.connect();
    mongoDb = mongoClient.db('orbhunter');

    tokensCol = mongoDb.collection('user_tokens');
    settingsCol = mongoDb.collection('user_settings');
    logsCol = mongoDb.collection('quest_logs');

    // Create unique indexes
    await tokensCol.createIndex({ discord_user_id: 1, label: 1 }, { unique: true });
    await settingsCol.createIndex({ discord_user_id: 1 }, { unique: true });

    // Migrate any data from local SQLite to MongoDB if not already present
    if (sqliteDb) {
      try {
        const localTokens = sqliteDb.prepare('SELECT * FROM user_tokens').all();
        for (const t of localTokens) {
          await tokensCol.updateOne(
            { discord_user_id: t.discord_user_id, label: t.label },
            {
              $set: {
                discord_user_id: t.discord_user_id,
                label: t.label,
                token_enc: t.token_enc,
                discord_account_id: t.discord_account_id,
                discord_username: t.discord_username,
                updated_at: new Date(),
              },
              $setOnInsert: { created_at: new Date() },
            },
            { upsert: true }
          );
        }

        const localSettings = sqliteDb.prepare('SELECT * FROM user_settings').all();
        for (const s of localSettings) {
          await settingsCol.updateOne(
            { discord_user_id: s.discord_user_id },
            {
              $set: {
                discord_user_id: s.discord_user_id,
                turbo_mode: s.turbo_mode,
                auto_claim: s.auto_claim,
                auto_enroll: s.auto_enroll,
                default_mode: s.default_mode,
                active_label: s.active_label || 'main',
                updated_at: new Date(),
              },
              $setOnInsert: { created_at: new Date() },
            },
            { upsert: true }
          );
        }
      } catch (e) {
        console.warn('⚠️ SQLite migration note:', e.message);
      }
    }

    // Populate in-memory caches from MongoDB Atlas
    const allTokens = await tokensCol.find({}).toArray();
    for (const t of allTokens) {
      tokensCache.set(`${t.discord_user_id}:${t.label}`, {
        discord_user_id: t.discord_user_id,
        label: t.label,
        token_enc: t.token_enc,
        discord_account_id: t.discord_account_id,
        discord_username: t.discord_username,
      });
    }

    const allSettings = await settingsCol.find({}).toArray();
    for (const s of allSettings) {
      settingsCache.set(s.discord_user_id, {
        turbo_mode: s.turbo_mode ?? 0,
        auto_claim: s.auto_claim ?? 0,
        auto_enroll: s.auto_enroll ?? 1,
        default_mode: s.default_mode || 'blaze',
        active_label: s.active_label || 'main',
      });
    }

    isMongoReady = true;
    console.log(`✅ MongoDB Atlas csatlakoztatva: ${allTokens.length} fiók betöltve a felhőből!`);
  } catch (err) {
    console.error('⚠️ MongoDB Atlas hiba, helyi gyorsítótár/SQLite aktív:', err.message);
    // Populate cache from SQLite if Mongo failed
    if (sqliteDb) {
      try {
        const localTokens = sqliteDb.prepare('SELECT * FROM user_tokens').all();
        for (const t of localTokens) {
          tokensCache.set(`${t.discord_user_id}:${t.label}`, t);
        }
        const localSettings = sqliteDb.prepare('SELECT * FROM user_settings').all();
        for (const s of localSettings) {
          settingsCache.set(s.discord_user_id, s);
        }
      } catch {}
    }
  }
  })();

  return connectingPromise;
}

/**
 * Ment egy Discord fiók tokent az adatbázisba
 */
export function saveToken(discordUserId, label, token, accountInfo = {}) {
  const enc = encrypt(token);
  const data = {
    discord_user_id: discordUserId,
    label,
    token_enc: enc,
    discord_account_id: accountInfo.id || null,
    discord_username: accountInfo.username || null,
  };

  // 1. Azonnali in-memory cache frissítés
  tokensCache.set(`${discordUserId}:${label}`, data);

  // 2. Mentés a MongoDB Atlas felhőbe
  if (tokensCol) {
    tokensCol.updateOne(
      { discord_user_id: discordUserId, label },
      {
        $set: {
          ...data,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    ).catch(e => console.error('[MongoDB] saveToken hiba:', e.message));
  }

  // 3. Helyi SQLite másolat
  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO user_tokens (discord_user_id, label, token_enc, discord_account_id, discord_username)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(discord_user_id, label) DO UPDATE SET
          token_enc = excluded.token_enc,
          discord_account_id = excluded.discord_account_id,
          discord_username = excluded.discord_username
      `).run(discordUserId, label, enc, accountInfo.id || null, accountInfo.username || null);
    } catch {}
  }
}

/**
 * Lekéri és visszafejti az adott címkéjű fiók tokent
 */
export function getDecryptedToken(discordUserId, label = 'default') {
  const item = tokensCache.get(`${discordUserId}:${label}`);
  if (!item) return null;
  return decrypt(item.token_enc);
}

/**
 * Töröl egy fiókot a megadott címke alapján
 */
export function removeToken(discordUserId, label) {
  const key = `${discordUserId}:${label}`;
  const had = tokensCache.has(key);
  tokensCache.delete(key);

  if (tokensCol) {
    tokensCol.deleteOne({ discord_user_id: discordUserId, label })
      .catch(e => console.error('[MongoDB] removeToken hiba:', e.message));
  }

  if (sqliteDb) {
    try {
      sqliteDb.prepare('DELETE FROM user_tokens WHERE discord_user_id = ? AND label = ?').run(discordUserId, label);
    } catch {}
  }

  return had;
}

/**
 * Kilistázza a felhasználó összes csatlakoztatott fiókját
 */
export function listTokens(discordUserId) {
  const list = [];
  for (const [key, val] of tokensCache.entries()) {
    if (val.discord_user_id === discordUserId) {
      list.push({
        label: val.label,
        discord_account_id: val.discord_account_id,
        discord_username: val.discord_username,
      });
    }
  }
  return list;
}

/**
 * Kilistázza az összes mentett fiókot az adatbázisból (ütemezett ellenőrzésekhez)
 */
export function listAllAccounts() {
  const accounts = [];
  for (const [key, val] of tokensCache.entries()) {
    accounts.push({
      discordUserId: val.discord_user_id,
      label: val.label,
      username: val.discord_username,
      accountId: val.discord_account_id,
    });
  }
  return accounts;
}

/**
 * Lekéri a felhasználó beállításait
 */
export function getSettings(discordUserId) {
  const s = settingsCache.get(discordUserId);
  return s || {
    turbo_mode: 0,
    auto_claim: 0,
    auto_enroll: 1,
    default_mode: 'blaze',
    active_label: 'main',
  };
}

/**
 * Elmenti a felhasználó beállításait
 */
export function saveSettings(discordUserId, settings) {
  const current = getSettings(discordUserId);
  const updated = {
    turbo_mode: settings.turbo_mode ?? current.turbo_mode,
    auto_claim: settings.auto_claim ?? current.auto_claim,
    auto_enroll: settings.auto_enroll ?? current.auto_enroll,
    default_mode: settings.default_mode ?? current.default_mode,
    active_label: settings.active_label ?? current.active_label ?? 'main',
  };

  settingsCache.set(discordUserId, updated);

  if (settingsCol) {
    settingsCol.updateOne(
      { discord_user_id: discordUserId },
      {
        $set: {
          ...updated,
          discord_user_id: discordUserId,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    ).catch(e => console.error('[MongoDB] saveSettings hiba:', e.message));
  }

  if (sqliteDb) {
    try {
      sqliteDb.prepare(`
        INSERT INTO user_settings (discord_user_id, turbo_mode, auto_claim, auto_enroll, default_mode, active_label)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(discord_user_id) DO UPDATE SET
          turbo_mode = excluded.turbo_mode,
          auto_claim = excluded.auto_claim,
          auto_enroll = excluded.auto_enroll,
          default_mode = excluded.default_mode,
          active_label = excluded.active_label
      `).run(
        discordUserId,
        updated.turbo_mode,
        updated.auto_claim,
        updated.auto_enroll,
        updated.default_mode,
        updated.active_label
      );
    } catch {}
  }
}

/**
 * Lekéri a jelenleg aktív fiók címkéjét
 */
export function getActiveLabel(discordUserId) {
  return getSettings(discordUserId).active_label || 'main';
}

/**
 * Beállítja a jelenleg aktív fiók címkéjét
 */
export function setActiveLabel(discordUserId, label) {
  saveSettings(discordUserId, { active_label: label });
}

/**
 * Küldetésnaplózás
 */
export function logQuest(discordUserId, questId, questName, status, message) {
  if (logsCol) {
    logsCol.insertOne({
      discord_user_id: discordUserId,
      quest_id: questId,
      quest_name: questName,
      status,
      message,
      created_at: new Date(),
    }).catch(e => console.error('[MongoDB] logQuest hiba:', e.message));
  }

  if (sqliteDb) {
    try {
      sqliteDb.prepare('INSERT INTO quest_logs (discord_user_id, quest_id, quest_name, status, message) VALUES (?, ?, ?, ?, ?)')
        .run(discordUserId, questId, questName, status, message);
    } catch {}
  }
}
