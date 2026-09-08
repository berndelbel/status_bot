import { ChannelType, PermissionsBitField } from 'discord.js';
import { log } from './logger.js';

/**
 * Rechte je nach Verwendungszweck - nicht jede Nachricht braucht alles.
 * Zu viel zu verlangen laesst eine Funktion scheitern, obwohl sie laufen koennte.
 */
export const PERMS = {
  // Status-Nachricht: haengt den Verlaufsgraphen an und sucht ihre alte Nachricht.
  full: [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.ReadMessageHistory,
  ],
  // Rangliste und Rollen: nur Embeds, aber sie pflegen eine bestehende Nachricht.
  embedPersistent: [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
    PermissionsBitField.Flags.ReadMessageHistory,
  ],
  // Willkommensnachricht: postet nur, liest nie etwas.
  postOnly: [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
  ],
};

/**
 * Holt einen Textkanal und prueft, ob der Bot dort alles darf, was er braucht.
 * Gibt null zurueck und meldet die Ursache, statt spaeter unklar zu scheitern.
 */
export async function resolveTextChannel(client, channelId, label, required = PERMS.full) {
  if (!channelId) return null;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) {
    log.error(`${label}: Channel ${channelId} nicht gefunden. Stimmt die ID?`);
    return null;
  }
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    log.error(`${label}: Der konfigurierte Channel ist kein Textkanal.`);
    return null;
  }

  const me = channel.guild.members.me ?? (await channel.guild.members.fetchMe().catch(() => null));
  if (!me) {
    log.error(`${label}: Eigenes Mitgliedsobjekt nicht abrufbar - Rechte nicht prüfbar.`);
    return null;
  }

  const missing = channel.permissionsFor(me)?.missing(required) ?? required;
  if (missing.length > 0) {
    log.error(`${label}: Dem Bot fehlen Rechte in #${channel.name}: ${missing.join(', ')}`);
    return null;
  }
  return channel;
}

/**
 * Holt eine Nachricht und unterscheidet "geloescht" von "gerade nicht abrufbar".
 *
 * Ein pauschales catch wuerde jeden Aussetzer - Rate-Limit, kurze Stoerung - als
 * geloescht deuten und eine zweite Nachricht posten. Nur die Discord-Codes
 * 10008 (Unbekannte Nachricht) und 10003 (Unbekannter Kanal) bedeuten wirklich,
 * dass sie weg ist. Alles andere wird weitergereicht.
 *
 * @returns {Promise<import('discord.js').Message|null>} null = wirklich geloescht
 */
export async function fetchMessageOrNull(channel, messageId) {
  try {
    return await channel.messages.fetch(messageId);
  } catch (err) {
    if (err?.code === 10008 || err?.code === 10003) return null;
    throw err;
  }
}
