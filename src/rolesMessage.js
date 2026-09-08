import { DiscordAPIError } from 'discord.js';
import { config } from './config.js';
import { log, describeError } from './logger.js';
import { getMeta, setMeta, deleteMeta } from './db.js';
import { resolveTextChannel, fetchMessageOrNull, PERMS } from './channel.js';
import { buildRolesMessage, loadRolesConfig, validateRoles } from './roles.js';

export const META_ROLES_MESSAGE = 'roles_message_id';
export const META_ROLES_CHANNEL = 'roles_channel_id';

let updating = false;

async function getOrCreateMessage(channel, payload) {
  const storedId = getMeta(META_ROLES_MESSAGE);
  const storedChannel = getMeta(META_ROLES_CHANNEL);

  if (storedId && storedChannel && storedChannel !== channel.id) {
    log.info('Rollen-Channel hat sich geändert - lege eine neue Nachricht an.');
    deleteMeta(META_ROLES_MESSAGE);
  } else if (storedId) {
    const existing = await fetchMessageOrNull(channel, storedId);
    if (existing) return existing;
    log.warn('Bisherige Rollen-Nachricht wurde gelöscht - erstelle eine neue.');
  }

  const message = await channel.send(payload);
  setMeta(META_ROLES_MESSAGE, message.id);
  setMeta(META_ROLES_CHANNEL, channel.id);
  log.ok(`Rollen-Nachricht erstellt: ${message.url}`);
  return message;
}

/**
 * Schreibt die Rollen-Nachricht in den konfigurierten Channel.
 * Anders als Status und Rangliste laeuft das nicht auf einem Intervall - der
 * Inhalt aendert sich nur, wenn die Konfiguration angepasst wird.
 */
export async function updateRolesMessage(client) {
  if (!config.rolesChannelId) return;
  if (updating) return;
  updating = true;

  try {
    const cfg = loadRolesConfig();
    if (!cfg) return;

    const channel = await resolveTextChannel(client, config.rolesChannelId, 'Rollen', PERMS.embedPersistent);
    if (!channel) return;

    // Vor dem Posten pruefen, ob die Rollen ueberhaupt vergeben werden koennen -
    // sonst klicken Leute auf Knoepfe, die kommentarlos nichts tun.
    const pruefung = await validateRoles(channel.guild);
    for (const problem of pruefung.problems) log.warn(`Rollen: ${problem}`);
    if (pruefung.ok) log.ok(`Rollen geprüft: alle ${cfg.roles.length} sind vergebbar.`);

    const payload = buildRolesMessage();
    const message = await getOrCreateMessage(channel, payload);
    await message.edit({ ...payload, attachments: [] });
  } catch (err) {
    if (err instanceof DiscordAPIError && (err.code === 10008 || err.code === 10003)) {
      deleteMeta(META_ROLES_MESSAGE);
      log.warn('Rollen-Nachricht nicht mehr vorhanden - wird neu erstellt.');
    } else {
      log.error('Rollen-Nachricht konnte nicht aktualisiert werden:');
      log.error(describeError(err));
    }
  } finally {
    updating = false;
  }
}

export function startRolesMessage(client) {
  if (!config.rolesChannelId) {
    log.info('ROLES_CHANNEL_ID nicht gesetzt - keine Rollen-Nachricht.');
    return;
  }
  if (!loadRolesConfig()) return;
  void updateRolesMessage(client);
}
