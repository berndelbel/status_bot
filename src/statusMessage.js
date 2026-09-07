import { DiscordAPIError } from 'discord.js';
import { config } from './config.js';
import { log, describeError } from './logger.js';
import { getMeta, setMeta, deleteMeta } from './db.js';
import { resolveTextChannel } from './channel.js';
import { buildStatusMessage } from './embed.js';
import { getLastState } from './monitor.js';

export const META_MESSAGE = 'status_message_id';
export const META_CHANNEL = 'status_channel_id';

let updating = false;
let updateTimer = null;

/** Holt die bestehende Status-Nachricht oder legt eine neue an. */
async function getOrCreateMessage(channel, payload) {
  const storedId = getMeta(META_MESSAGE);
  const storedChannel = getMeta(META_CHANNEL);

  // Channel gewechselt? Dann alte Nachricht vergessen.
  if (storedId && storedChannel && storedChannel !== channel.id) {
    log.info('Status-Channel hat sich geaendert - lege eine neue Nachricht an.');
    deleteMeta(META_MESSAGE);
  } else if (storedId) {
    const existing = await channel.messages.fetch(storedId).catch(() => null);
    if (existing) return existing;
    log.warn('Bisherige Status-Nachricht wurde geloescht - erstelle eine neue.');
  }

  const message = await channel.send(payload);
  setMeta(META_MESSAGE, message.id);
  setMeta(META_CHANNEL, channel.id);
  log.ok(`Status-Nachricht erstellt: ${message.url}`);
  return message;
}

/** Baut die Nachricht neu und schreibt sie in den Channel. */
export async function updateStatusMessage(client) {
  if (updating) return; // Ueberschneidende Updates vermeiden
  updating = true;

  try {
    const state = getLastState();
    if (!state) return;

    const channel = await resolveTextChannel(client, config.statusChannelId, 'Status');
    if (!channel) return;

    const payload = buildStatusMessage(state);
    const message = await getOrCreateMessage(channel, payload);

    // Beim Bearbeiten muessen Anhaenge explizit ersetzt werden, sonst bleibt
    // der alte Graph stehen.
    await message.edit({ ...payload, attachments: [] });
  } catch (err) {
    if (err instanceof DiscordAPIError && (err.code === 10008 || err.code === 10003)) {
      // Unbekannte Nachricht / unbekannter Channel - beim naechsten Lauf neu anlegen.
      deleteMeta(META_MESSAGE);
      log.warn('Status-Nachricht nicht mehr vorhanden - wird neu erstellt.');
    } else {
      log.error('Status-Nachricht konnte nicht aktualisiert werden:');
      log.error(describeError(err));
    }
  } finally {
    updating = false;
  }
}

export function startStatusUpdater(client) {
  log.info(`Status-Nachricht wird alle ${config.updateInterval} Sekunden aktualisiert`);
  void updateStatusMessage(client);
  updateTimer = setInterval(() => void updateStatusMessage(client), config.updateInterval * 1000);
}

export function stopStatusUpdater() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = null;
}
