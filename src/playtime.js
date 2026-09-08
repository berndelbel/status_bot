import { EventEmitter } from 'node:events';
import { BattlEyeRcon, parsePlayers } from './rcon.js';
import { config } from './config.js';
import { log } from './logger.js';
import {
  upsertRconPlayer,
  getOpenSessions,
  startSession,
  touchSession,
  closeSession,
  closeStaleSessions,
} from './db.js';

export const playtime = new EventEmitter();

let rcon = null;
let pollTimer = null;
let reconnectTimer = null;
let watchdogTimer = null;
let stopped = true;
let backoff = 5_000;
let onlinePlayers = [];
let lastSuccess = 0;
let stalled = false;

const MAX_BACKOFF = 5 * 60_000;
const WATCHDOG_INTERVAL = 30_000;

export function getOnlinePlayers() {
  return onlinePlayers;
}

export function isRconConnected() {
  return rcon?.connected === true;
}

export function getLastRconSuccess() {
  return lastSuccess;
}

/**
 * Startet die Spielzeit-Erfassung.
 * Ohne RCON_ENABLED passiert nichts - der Rest des Bots laeuft davon unabhaengig.
 */
export function startPlaytimeTracking() {
  if (!config.rconEnabled) {
    log.info('RCon ist deaktiviert - keine Spielzeit-Erfassung. (RCON_ENABLED=true zum Aktivieren)');
    return;
  }

  stopped = false;
  // Waehrend der Bot aus war, ist unbekannt, wer wann ging. Offene Sitzungen
  // werden deshalb am letzten Sichtkontakt geschlossen, statt die gesamte
  // Ausfallzeit als Spielzeit anzurechnen.
  closeStaleSessions();
  void connect();
  startWatchdog();
}

export function stopPlaytimeTracking() {
  stopped = true;
  if (pollTimer) clearInterval(pollTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  pollTimer = null;
  reconnectTimer = null;
  watchdogTimer = null;
  rcon?.close();
  rcon = null;
}

/**
 * Wachhund gegen stille Aussetzer.
 *
 * Die Spielzeit waechst nur, solange Abfragen durchlaufen. Bleibt die
 * Verbindung haengen, ohne dass ein Fehler auftritt, wuerden die Zahlen
 * einfrieren - sichtbar erst Stunden spaeter. Deshalb wird hier aktiv geprueft,
 * ob ueberhaupt noch Daten ankommen, und im Zweifel neu verbunden.
 */
function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    if (stopped || lastSuccess === 0) return;

    const stillMs = Date.now() - lastSuccess;
    const grenzeMs = Math.max(config.rconPollInterval * 3, 120) * 1000;

    if (stillMs > grenzeMs) {
      log.warn(
        `RCon-Wachhund: seit ${Math.round(stillMs / 1000)} s keine erfolgreiche Abfrage ` +
          `(verbunden laut Client: ${isRconConnected() ? 'ja' : 'nein'}) - baue neu auf.`
      );
      stalled = true;
      forceReconnect();
    }
  }, WATCHDOG_INTERVAL);
}

/** Verbindung hart neu aufbauen, ohne auf den Backoff zu warten. */
function forceReconnect() {
  if (pollTimer) clearInterval(pollTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  pollTimer = null;
  reconnectTimer = null;
  try {
    rcon?.close();
  } catch {
    /* war schon zu */
  }
  rcon = null;
  backoff = 5_000;
  void connect();
}

async function connect() {
  if (stopped) return;

  rcon = new BattlEyeRcon({
    host: config.rconHost,
    port: config.rconPort,
    password: config.rconPassword,
    timeout: 8000,
  });

  rcon.on('error', (err) => log.debug(`RCon-Fehler: ${err?.message ?? err}`));
  rcon.on('message', (text) => log.debug(`RCon-Meldung: ${text.trim()}`));
  rcon.on('disconnected', () => {
    log.warn('RCon-Verbindung verloren - versuche erneut zu verbinden.');
    scheduleReconnect();
  });

  try {
    await rcon.connect();
    log.ok(`RCon verbunden mit ${config.rconHost}:${config.rconPort}`);
    backoff = 5_000;

    await pollPlayers();
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => void pollPlayers(), config.rconPollInterval * 1000);
  } catch (err) {
    log.warn(`RCon nicht verbunden: ${err?.message ?? err}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  rcon?.close();
  rcon = null;

  log.info(`Neuer RCon-Versuch in ${Math.round(backoff / 1000)} s`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, backoff);
  backoff = Math.min(backoff * 2, MAX_BACKOFF);
}

/**
 * Fragt die Spielerliste ab und leitet daraus Sitzungen ab.
 *
 * Bewusst per Abfrage statt ueber die Join/Leave-Meldungen: falls einmal eine
 * Meldung verlorengeht oder die Verbindung kurz abreisst, korrigiert sich der
 * Zustand bei der naechsten Abfrage von selbst.
 */
async function pollPlayers() {
  if (!rcon?.connected) return;

  let players;
  try {
    const raw = await rcon.command('players');
    players = parsePlayers(raw);
  } catch (err) {
    log.warn(`Spielerliste nicht abrufbar: ${err?.message ?? err}`);
    scheduleReconnect();
    return;
  }

  const ts = Math.floor(Date.now() / 1000);
  if (stalled) {
    log.ok('RCon-Abfrage laeuft wieder.');
    stalled = false;
  }
  lastSuccess = Date.now();

  // Spieler ohne gueltige GUID (noch im Verbindungsaufbau) zaehlen nicht mit.
  const valid = players.filter((p) => /^[0-9a-f]{32}$/i.test(p.guid) && p.name !== '');
  const seen = new Set(valid.map((p) => p.guid));
  const open = new Map(getOpenSessions().map((s) => [s.guid, s]));

  for (const p of valid) {
    upsertRconPlayer(p.guid, p.name, ts);
    if (open.has(p.guid)) {
      touchSession(p.guid, ts);
    } else {
      startSession(p.guid, ts);
      log.debug(`Sitzung begonnen: ${p.name}`);
    }
  }

  // Wer nicht mehr in der Liste steht, hat den Server verlassen. Die Sitzung
  // endet am letzten Sichtkontakt, nicht jetzt - dazwischen war er schon weg.
  for (const [guid, session] of open) {
    if (seen.has(guid)) continue;
    closeSession(guid);
    log.debug(`Sitzung beendet: ${guid.slice(0, 8)}… (${ts - session.started} s)`);
  }

  onlinePlayers = valid;
  playtime.emit('players', valid);
}
