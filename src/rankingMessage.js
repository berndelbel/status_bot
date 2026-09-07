import { DiscordAPIError } from 'discord.js';
import { config } from './config.js';
import { log, describeError } from './logger.js';
import { getMeta, setMeta, deleteMeta } from './db.js';
import { resolveTextChannel } from './channel.js';
import { buildRankingMessage } from './ranking.js';

export const META_RANK_MESSAGE = 'ranking_message_id';
export const META_RANK_CHANNEL = 'ranking_channel_id';

let updating = false;
let updateTimer = null;

async function getOrCreateMessage(channel, payload) {
  const storedId = getMeta(META_RANK_MESSAGE);
  const storedChannel = getMeta(META_RANK_CHANNEL);

  if (storedId && storedChannel && storedChannel !== channel.id) {
    log.info('Ranglisten-Channel hat sich geändert - lege eine neue Nachricht an.');
    deleteMeta(META_RANK_MESSAGE);
  } else if (storedId) {
    const existing = await channel.messages.fetch(storedId).catch(() => null);
    if (existing) return existing;
    log.warn('Bisherige Ranglisten-Nachricht wurde gelöscht - erstelle eine neue.');
  }

  const message = await channel.send(payload);
  setMeta(META_RANK_MESSAGE, message.id);
  setMeta(META_RANK_CHANNEL, channel.id);
  log.ok(`Ranglisten-Nachricht erstellt: ${message.url}`);
  return message;
}

/** Schreibt die Rangliste (immer Seite 1) in den konfigurierten Channel. */
export async function updateRankingMessage(client) {
  if (!config.rankingChannelId) return;
  if (updating) return;
  updating = true;

  try {
    const channel = await resolveTextChannel(client, config.rankingChannelId, 'Rangliste');
    if (!channel) return;

    // Die dauerhafte Nachricht zeigt immer die erste Seite. Wer weiterblättert,
    // bekommt die Folgeseiten privat - sonst würde die Seite unter anderen
    // Lesern wegspringen.
    const payload = buildRankingMessage(1);
    const message = await getOrCreateMessage(channel, payload);
    await message.edit({ ...payload, attachments: [] });
  } catch (err) {
    if (err instanceof DiscordAPIError && (err.code === 10008 || err.code === 10003)) {
      deleteMeta(META_RANK_MESSAGE);
      log.warn('Ranglisten-Nachricht nicht mehr vorhanden - wird neu erstellt.');
    } else {
      log.error('Rangliste konnte nicht aktualisiert werden:');
      log.error(describeError(err));
    }
  } finally {
    updating = false;
  }
}

export function startRankingUpdater(client) {
  if (!config.rankingChannelId) {
    log.info('RANKING_CHANNEL_ID nicht gesetzt - keine dauerhafte Ranglisten-Nachricht.');
    return;
  }
  log.info(`Rangliste wird alle ${config.rankingUpdateInterval} Sekunden aktualisiert`);
  void updateRankingMessage(client);
  updateTimer = setInterval(
    () => void updateRankingMessage(client),
    config.rankingUpdateInterval * 1000
  );
}

export function stopRankingUpdater() {
  if (updateTimer) clearInterval(updateTimer);
  updateTimer = null;
}
