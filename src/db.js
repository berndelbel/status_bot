import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { log } from './logger.js';

let db;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS samples (
    ts          INTEGER PRIMARY KEY,
    online      INTEGER NOT NULL,
    players     INTEGER NOT NULL DEFAULT 0,
    max_players INTEGER NOT NULL DEFAULT 0,
    queue       INTEGER NOT NULL DEFAULT 0,
    ping        INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples (ts);

  CREATE TABLE IF NOT EXISTS events (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,
    online INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  -- Spieler aus RCon. Schluessel ist die GUID, nicht der Name: so zaehlt ein
  -- Namenswechsel weiter auf dasselbe Konto.
  CREATE TABLE IF NOT EXISTS rcon_players (
    guid       TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  );

  -- Eine Zeile je Spielsitzung. ended = NULL bedeutet "laeuft noch".
  CREATE TABLE IF NOT EXISTS rcon_sessions (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    guid      TEXT NOT NULL,
    started   INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    ended     INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_rcon_sessions_guid ON rcon_sessions (guid);
  CREATE INDEX IF NOT EXISTS idx_rcon_sessions_time ON rcon_sessions (started, ended);
  CREATE INDEX IF NOT EXISTS idx_rcon_sessions_open ON rcon_sessions (ended) WHERE ended IS NULL;
`;

export function initDb() {
  const path = resolve(config.dbPath);
  mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  log.ok(`Datenbank bereit: ${path}`);
  pruneOldData();
  return db;
}

export function closeDb() {
  try {
    db?.close();
  } catch {
    /* schon geschlossen */
  }
}

/** Speichert eine Messung und protokolliert Online/Offline-Wechsel. */
export function recordSample(sample) {
  const ts = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT OR REPLACE INTO samples (ts, online, players, max_players, queue, ping)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    ts,
    sample.online ? 1 : 0,
    sample.players ?? 0,
    sample.maxPlayers ?? 0,
    sample.queue ?? 0,
    sample.ping ?? null
  );

  const last = db.prepare('SELECT online FROM events ORDER BY ts DESC, id DESC LIMIT 1').get();
  const isOnline = sample.online ? 1 : 0;
  if (!last || last.online !== isOnline) {
    db.prepare('INSERT INTO events (ts, online) VALUES (?, ?)').run(ts, isOnline);
    log.info(isOnline ? 'Server ist wieder ONLINE' : 'Server ist OFFLINE gegangen');
  }
  return ts;
}

/** Alle Messungen ab einem Zeitpunkt, aufsteigend sortiert. */
export function getSamplesSince(sinceTs) {
  return db.prepare('SELECT * FROM samples WHERE ts >= ? ORDER BY ts ASC').all(sinceTs);
}

export function getLastSample() {
  return db.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 1').get() ?? null;
}

/** Zeitpunkt, seit dem der aktuelle Online/Offline-Zustand ununterbrochen anhaelt. */
export function getCurrentStreakStart() {
  const row = db.prepare('SELECT ts, online FROM events ORDER BY ts DESC, id DESC LIMIT 1').get();
  return row ? { since: row.ts, online: row.online === 1 } : null;
}

/** Aggregat (Uptime-Quote, Peak, Durchschnitt) ueber ein Zeitfenster. */
export function getWindowAggregate(sinceTs) {
  const row = db
    .prepare(
      `SELECT COUNT(*)                                     AS total,
              SUM(online)                                  AS up,
              MAX(CASE WHEN online = 1 THEN players END)   AS peak,
              AVG(CASE WHEN online = 1 THEN players END)   AS avg,
              MAX(max_players)                             AS slots,
              AVG(CASE WHEN online = 1 THEN ping END)      AS avgPing
       FROM samples WHERE ts >= ?`
    )
    .get(sinceTs);

  const total = row?.total ?? 0;
  return {
    total,
    up: row?.up ?? 0,
    uptimeRatio: total > 0 ? (row.up ?? 0) / total : null,
    peak: row?.peak ?? null,
    avg: row?.avg ?? null,
    slots: row?.slots ?? null,
    avgPing: row?.avgPing ?? null,
  };
}

/** Zeitpunkt und Wert des hoechsten Spielerstands im Fenster. */
export function getPeakSample(sinceTs) {
  return (
    db
      .prepare(
        `SELECT ts, players FROM samples
         WHERE ts >= ? AND online = 1
         ORDER BY players DESC, ts DESC LIMIT 1`
      )
      .get(sinceTs) ?? null
  );
}

/** Alle Ausfaelle im Fenster, inklusive Dauer in Sekunden. */
export function getOutages(sinceTs) {
  const events = db
    .prepare('SELECT ts, online FROM events WHERE ts >= ? ORDER BY ts ASC')
    .all(sinceTs);

  // Zustand direkt vor dem Fenster, damit ein laufender Ausfall nicht verloren geht.
  const before = db
    .prepare('SELECT ts, online FROM events WHERE ts < ? ORDER BY ts DESC LIMIT 1')
    .get(sinceTs);

  const now = Math.floor(Date.now() / 1000);
  const outages = [];
  let downSince = before && before.online === 0 ? sinceTs : null;

  for (const ev of events) {
    if (ev.online === 0 && downSince === null) downSince = ev.ts;
    else if (ev.online === 1 && downSince !== null) {
      outages.push({ from: downSince, to: ev.ts, seconds: ev.ts - downSince });
      downSince = null;
    }
  }
  if (downSince !== null) outages.push({ from: downSince, to: now, seconds: now - downSince, ongoing: true });
  return outages;
}

export function getMeta(key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(key, value) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value));
}

export function deleteMeta(key) {
  db.prepare('DELETE FROM meta WHERE key = ?').run(key);
}

/** Loescht Messungen ausserhalb der Aufbewahrungsfrist. Events bleiben erhalten. */
export function pruneOldData() {
  const cutoff = Math.floor(Date.now() / 1000) - config.retentionDays * 86400;
  const res = db.prepare('DELETE FROM samples WHERE ts < ?').run(cutoff);
  if (res.changes > 0) log.debug(`${res.changes} alte Messungen geloescht (aelter als ${config.retentionDays} Tage)`);
}

// ------------------------------------------------------- Spielzeit (RCon)

/** Legt den Spieler an oder aktualisiert Name und Zeitstempel. */
export function upsertRconPlayer(guid, name, ts) {
  db.prepare(
    `INSERT INTO rcon_players (guid, name, first_seen, last_seen)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(guid) DO UPDATE SET
       name      = excluded.name,
       last_seen = excluded.last_seen`
  ).run(guid, name, ts, ts);
}

/** GUIDs aller Sitzungen, die noch als laufend eingetragen sind. */
export function getOpenSessions() {
  return db.prepare('SELECT id, guid, started, last_seen FROM rcon_sessions WHERE ended IS NULL').all();
}

export function startSession(guid, ts) {
  db.prepare('INSERT INTO rcon_sessions (guid, started, last_seen) VALUES (?, ?, ?)').run(guid, ts, ts);
}

/** Haelt eine laufende Sitzung am Leben. */
export function touchSession(guid, ts) {
  db.prepare('UPDATE rcon_sessions SET last_seen = ? WHERE guid = ? AND ended IS NULL').run(ts, guid);
}

/** Beendet eine laufende Sitzung. Ohne Zeitpunkt zaehlt der letzte Sichtkontakt. */
export function closeSession(guid, ts = null) {
  db.prepare(
    'UPDATE rcon_sessions SET ended = COALESCE(?, last_seen) WHERE guid = ? AND ended IS NULL'
  ).run(ts, guid);
}

/**
 * Schliesst beim Start alle offenen Sitzungen am letzten Sichtkontakt.
 * Waehrend der Bot aus war, ist unbekannt, wer wann ging - offen gelassene
 * Sitzungen wuerden sonst die gesamte Ausfallzeit als Spielzeit anrechnen.
 */
export function closeStaleSessions() {
  const res = db.prepare('UPDATE rcon_sessions SET ended = last_seen WHERE ended IS NULL').run();
  if (res.changes > 0) log.info(`${res.changes} offene Sitzung(en) beim Start abgeschlossen.`);
  return res.changes;
}

/**
 * Spielzeit-Rangliste fuer ein Zeitfenster.
 * Gezaehlt wird nur der Anteil jeder Sitzung, der wirklich im Fenster liegt.
 */
export function getPlaytimeRanking(sinceTs, nowTs, { limit = 10, offset = 0 } = {}) {
  const rows = db
    .prepare(
      `SELECT s.guid                                    AS guid,
              p.name                                    AS name,
              SUM(MAX(0, MIN(COALESCE(s.ended, s.last_seen), ?)
                       - MAX(s.started, ?)))            AS seconds,
              COUNT(*)                                  AS sessions,
              MAX(COALESCE(s.ended, s.last_seen))       AS lastOnline
       FROM rcon_sessions s
       JOIN rcon_players p ON p.guid = s.guid
       WHERE COALESCE(s.ended, s.last_seen) >= ?
       GROUP BY s.guid
       HAVING seconds > 0
       ORDER BY seconds DESC, name ASC
       LIMIT ? OFFSET ?`
    )
    .all(nowTs, sinceTs, sinceTs, limit, offset);

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS players, COALESCE(SUM(seconds), 0) AS seconds FROM (
         SELECT s.guid,
                SUM(MAX(0, MIN(COALESCE(s.ended, s.last_seen), ?)
                         - MAX(s.started, ?))) AS seconds
         FROM rcon_sessions s
         WHERE COALESCE(s.ended, s.last_seen) >= ?
         GROUP BY s.guid
         HAVING seconds > 0
       )`
    )
    .get(nowTs, sinceTs, sinceTs);

  return {
    rows,
    totalPlayers: totals?.players ?? 0,
    totalSeconds: totals?.seconds ?? 0,
  };
}

/** Anzahl aktuell laufender Sitzungen. */
export function countActiveSessions() {
  return db.prepare('SELECT COUNT(*) AS n FROM rcon_sessions WHERE ended IS NULL').get()?.n ?? 0;
}
