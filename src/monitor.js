import { EventEmitter } from 'node:events';
import { queryServer } from './query.js';
import { recordSample, pruneOldData } from './db.js';
import { config } from './config.js';
import { log } from './logger.js';

export const monitor = new EventEmitter();

let lastState = null;
let pollTimer = null;
let pruneTimer = null;
let consecutiveFailures = 0;
let inFlight = null;

export function getLastState() {
  return lastState;
}

/**
 * Fragt den Server einmal ab, speichert das Ergebnis und meldet es an alle Zuhoerer.
 * Laeuft bereits eine Abfrage, wird deren Ergebnis mitbenutzt statt eine zweite
 * zu starten - eine haengende Abfrage kann sich sonst mit dem Timer stapeln.
 */
export function pollOnce() {
  if (inFlight) return inFlight;
  inFlight = doPoll().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doPoll() {
  try {
    const state = await queryServer();
    const wasOnline = lastState?.online;
    lastState = state;

    // Ein Schreibfehler darf die Anzeige nicht blockieren: der Live-Status ist
    // wichtiger als die Historie, deshalb wird er separat abgesichert.
    try {
      recordSample(state);
    } catch (err) {
      log.error('Messung konnte nicht gespeichert werden:', err?.message ?? err);
    }

    if (state.online) {
      if (consecutiveFailures > 0) {
        log.ok(`Server wieder erreichbar nach ${consecutiveFailures} Fehlversuchen`);
      }
      consecutiveFailures = 0;
      log.debug(`${state.players}/${state.maxPlayers} Spieler · ${state.ping ?? '?'} ms`);
    } else {
      consecutiveFailures += 1;
      if (consecutiveFailures === 1) log.warn(`Server nicht erreichbar: ${state.error}`);
    }

    monitor.emit('sample', state, { changed: wasOnline !== state.online });
    return state;
  } catch (err) {
    log.error('Unerwarteter Fehler beim Abfragen:', err);
    return lastState;
  }
}

export function startMonitor() {
  log.info(
    `Starte Ueberwachung von ${config.host}:${config.gamePort} alle ${config.pollInterval} Sekunden`
  );
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), config.pollInterval * 1000);
  // Einmal taeglich aufraeumen, damit die Datenbank nicht endlos waechst.
  pruneTimer = setInterval(() => pruneOldData(), 24 * 3600 * 1000);
}

export function stopMonitor() {
  if (pollTimer) clearInterval(pollTimer);
  if (pruneTimer) clearInterval(pruneTimer);
  pollTimer = null;
  pruneTimer = null;
}
