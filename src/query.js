import { GameDig } from 'gamedig';
import { config } from './config.js';
import { log } from './logger.js';

/**
 * Fragt den DayZ-Server per A2S ab.
 * Gibt immer ein Objekt zurueck - bei Fehlern mit online:false statt zu werfen.
 */
export async function queryServer() {
  const started = Date.now();
  const options = {
    type: 'dayz',
    host: config.host,
    port: config.gamePort,
    socketTimeout: 3000,
    attemptTimeout: 6000,
    maxRetries: 1,
    requestRules: true,
    requestPlayers: config.showPlayerList,
  };

  // Nur wenn ein Query-Port fest gesetzt ist, uebersteuern wir gamedigs Automatik.
  if (config.queryPort) {
    options.port = config.queryPort;
    options.givenPortOnly = true;
  }

  try {
    const state = await GameDig.query(options);
    return normalize(state, Date.now() - started);
  } catch (err) {
    log.debug(`Abfrage fehlgeschlagen: ${err?.message ?? err}`);
    return {
      online: false,
      error: String(err?.message ?? err),
      players: 0,
      maxPlayers: 0,
      queue: 0,
      ping: null,
      queriedAt: Date.now(),
      durationMs: Date.now() - started,
    };
  }
}

function normalize(state, durationMs) {
  const raw = state.raw ?? {};
  const queue = Number.isFinite(raw.queue) ? raw.queue : 0;
  const total = state.numplayers ?? 0;

  return {
    online: true,
    name: config.serverNameOverride || state.name || 'DayZ Server',
    map: state.map || null,
    // DayZ zaehlt wartende Spieler in numplayers mit - fuer die Anzeige trennen wir das.
    players: Math.max(0, total - queue),
    maxPlayers: state.maxplayers ?? 0,
    queue,
    ping: Number.isFinite(state.ping) ? state.ping : null,
    playerList: (state.players ?? [])
      .map((p) => (typeof p === 'string' ? p : p?.name))
      .filter((n) => typeof n === 'string' && n.trim() !== ''),
    connect: state.connect ?? `${config.host}:${config.gamePort}`,
    password: Boolean(state.password),
    ingameTime: raw.time ?? null,
    firstPerson: Boolean(raw.firstPerson),
    privateHive: Boolean(raw.privateHive),
    official: Boolean(raw.official),
    version: raw.version ?? null,
    mods: Array.isArray(raw.dayzMods) ? raw.dayzMods.map((m) => m?.title).filter(Boolean) : [],
    dayAcceleration: raw.dayAcceleration ?? null,
    nightAcceleration: raw.nightAcceleration ?? null,
    queriedAt: Date.now(),
    durationMs,
  };
}
